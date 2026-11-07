import { Injectable } from '@nestjs/common';
import {
  PasswordRecoveryChallengeStatus,
  PasswordRecoveryVerifyState,
  Prisma,
} from '@salon/database';
import {
  ConflictError,
  NotFoundError,
  PasswordRecoveryChallengeExpiredError,
  PasswordRecoveryChallengeSupersededError,
  PasswordRecoveryProofAlreadyIssuedError,
  PasswordRecoveryProofExpiredError,
  PasswordRecoveryResendCooldownError,
  PasswordRecoverySendLimitError,
  PasswordRecoverySendUnconfirmedError,
  PasswordRecoveryVerificationFailedError,
  PasswordRecoveryVerificationLimitError,
  PasswordRecoveryVerificationUnconfirmedError,
  ValidationError,
  createId,
} from '@salon/shared';
import * as argon2 from 'argon2';
import type { OtpSendReceipt } from './otp-provider';
import { OtpyProvider } from './otp-provider';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { assertSameIdempotentRequest, requireIdempotencyKey } from '../infrastructure/http/idempotency';
import {
  issueRecoveryProof,
  recoveryCompletionHash,
  recoveryPendingResponse,
  recoveryPhoneHash,
  recoveryProofHash,
  recoveryStartHash,
  recoveryVerifyHash,
  resolveRecoveryEligibility,
  type RecoveryEligibility,
} from './password-recovery';
import { normalizeIranianMobile } from './signup-phone';

type ChallengeRow = {
  id: string;
  status: PasswordRecoveryChallengeStatus;
  requestHash: string;
  phoneHash: string;
};

type ClockCount = { value: number | bigint };

const OPEN_STATUSES: PasswordRecoveryChallengeStatus[] = [
  PasswordRecoveryChallengeStatus.DISPATCHING,
  PasswordRecoveryChallengeStatus.SENT,
  PasswordRecoveryChallengeStatus.AMBIGUOUS,
  PasswordRecoveryChallengeStatus.SUPPRESSED,
];

@Injectable()
export class StartPasswordRecoveryUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly otp: OtpyProvider,
  ) {}

  async execute(input: { phone: string; idempotencyKey: string | string[] | undefined }) {
    const phone = requirePhone(input.phone);
    const key = requireIdempotencyKey(input.idempotencyKey);
    const secret = requireRecoverySecret(this.config);
    const limits = this.config.values;
    const decision = await this.prepareCommitted({
      phone,
      key,
      secret,
      cooldownSeconds: limits.PASSWORD_RECOVERY_RESEND_COOLDOWN_SECONDS,
      maxSends: limits.PASSWORD_RECOVERY_MAX_SENDS,
      windowSeconds: limits.PASSWORD_RECOVERY_SEND_WINDOW_SECONDS,
      maxTtlSeconds: limits.PASSWORD_RECOVERY_MAX_TTL_SECONDS,
    });
    if (decision.kind === 'pending') {
      return decision.body;
    }
    if (decision.kind === 'error') {
      throw decision.error;
    }

    // Provider HTTP is outside the DB transaction. Recheck eligibility immediately
    // before send. A disable during the provider round-trip can still deliver an
    // OTP; verify and complete refuse a reset unless the identity is still eligible.
    const stillEligible = await this.prisma.client.$transaction(async (tx) => {
      const identity = await tx.passwordRecoveryChallenge.findUnique({
        where: { id: decision.challengeId },
        select: { phoneHash: true, status: true },
      });
      if (!identity || identity.status !== PasswordRecoveryChallengeStatus.DISPATCHING) {
        return false;
      }
      await lockRecoveryPhone(tx, identity.phoneHash);
      return eligibilityOf(await loadRecoveryAccounts(tx, phone)).eligible;
    });
    if (!stillEligible) {
      return this.markSuppressed(
        decision.challengeId,
        limits.PASSWORD_RECOVERY_RESEND_COOLDOWN_SECONDS,
      );
    }

    let receipt: OtpSendReceipt;
    try {
      receipt = await this.otp.send(phone);
    } catch {
      await this.markAmbiguous(decision.challengeId);
      throw new PasswordRecoverySendUnconfirmedError();
    }

    try {
      return await this.markSent(
        decision.challengeId,
        receipt,
        limits.PASSWORD_RECOVERY_MAX_TTL_SECONDS,
      );
    } catch (error) {
      if (error instanceof PasswordRecoveryChallengeExpiredError) {
        throw error;
      }
      await this.markAmbiguous(decision.challengeId);
      throw new PasswordRecoverySendUnconfirmedError();
    }
  }

  private async prepareCommitted(
    input: {
      phone: string;
      key: string;
      secret: string;
      cooldownSeconds: number;
      maxSends: number;
      windowSeconds: number;
      maxTtlSeconds: number;
    },
  ) {
    try {
      return await this.prisma.client.$transaction((tx) => this.prepare(tx, input), {
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.client.$transaction((tx) => this.prepare(tx, input), {
          maxWait: 5_000,
          timeout: 15_000,
        });
      }
      throw error;
    }
  }

  private async prepare(
    tx: Prisma.TransactionClient,
    input: {
      phone: string;
      key: string;
      secret: string;
      cooldownSeconds: number;
      maxSends: number;
      windowSeconds: number;
      maxTtlSeconds: number;
    },
  ): Promise<
    | { kind: 'dispatch'; challengeId: string }
    | {
        kind: 'pending';
        body: { outcome: 'pending'; expiresInSeconds: number; resendAvailableInSeconds: number };
      }
    | { kind: 'error'; error: Error }
  > {
    const phoneHash = recoveryPhoneHash(input.secret, input.phone);
    const requestHash = recoveryStartHash(input.secret, input.phone);
    await lockRecoveryPhone(tx, phoneHash);
    await closeExpiredProofs(tx, phoneHash);
    await expireOpenChallenges(tx, phoneHash);

    const existing = await tx.passwordRecoveryChallenge.findUnique({
      where: { idempotencyKey: input.key },
    });
    if (existing) {
      assertSameIdempotentRequest(existing.requestHash, requestHash);
      if (existing.phoneHash !== phoneHash) {
        throw new ConflictError('Idempotency-Key was already used with a different request');
      }
      return replayStart(tx, existing, input.cooldownSeconds);
    }

    const openRows = await tx.$queryRaw<
      Array<{ id: string; status: PasswordRecoveryChallengeStatus; wait_seconds: number | bigint }>
    >`
      SELECT id, status,
        GREATEST(0, ceil(extract(epoch FROM (
          created_at + (${input.cooldownSeconds}::int * interval '1 second') - clock_timestamp()
        ))))::int AS wait_seconds
      FROM password_recovery_challenges
      WHERE phone_hash = ${phoneHash}
        AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS', 'SUPPRESSED')
        AND expires_at > clock_timestamp()
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const open = openRows[0];
    if (open) {
      const wait = asInt(open.wait_seconds);
      if (wait > 0) {
        if (
          open.status === PasswordRecoveryChallengeStatus.SENT ||
          open.status === PasswordRecoveryChallengeStatus.SUPPRESSED
        ) {
          return { kind: 'error', error: new PasswordRecoveryResendCooldownError(wait) };
        }
        return { kind: 'error', error: new PasswordRecoverySendUnconfirmedError() };
      }
    }

    const openProof = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM password_recovery_challenges
      WHERE phone_hash = ${phoneHash}
        AND status = 'VERIFIED'
        AND proof_closed_at IS NULL
        AND proof_expires_at > clock_timestamp()
      LIMIT 1
    `;
    if (openProof.length > 0) {
      return { kind: 'error', error: new PasswordRecoverySendLimitError() };
    }

    const sentRows = await tx.$queryRaw<
      Array<{ value: number | bigint; retry_after_seconds: number | bigint }>
    >`
      SELECT
        count(*)::int AS value,
        COALESCE(
          GREATEST(0, ceil(extract(epoch FROM (
            min(created_at) + (${input.windowSeconds}::int * interval '1 second') - clock_timestamp()
          ))))::int,
          0
        ) AS retry_after_seconds
      FROM password_recovery_challenges
      WHERE phone_hash = ${phoneHash}
        AND created_at >= clock_timestamp() - (${input.windowSeconds}::int * interval '1 second')
    `;
    if (asInt(sentRows[0]?.value ?? 0) >= input.maxSends) {
      return {
        kind: 'error',
        error: new PasswordRecoverySendLimitError(asInt(sentRows[0]?.retry_after_seconds ?? 0)),
      };
    }

    if (open) {
      const invalidated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE password_recovery_challenges
        SET status = 'INVALIDATED',
            invalidated_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = ${open.id}::uuid
          AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS', 'SUPPRESSED')
          AND expires_at > clock_timestamp()
        RETURNING id
      `;
      if (invalidated.length === 1) {
        await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_INVALIDATED', open.id);
      } else {
        await expireOpenChallenges(tx, phoneHash);
      }
    }

    const challengeId = createId();
    const eligible = eligibilityOf(await loadRecoveryAccounts(tx, input.phone)).eligible;
    if (!eligible) {
      const suppressed = await tx.$queryRaw<
        Array<{ expires_in_seconds: number | bigint; resend_in_seconds: number | bigint }>
      >`
        INSERT INTO password_recovery_challenges (
          id, phone_hash, status, idempotency_key, request_hash,
          expires_at, verify_attempts, created_at, updated_at
        ) VALUES (
          ${challengeId}::uuid,
          ${phoneHash},
          'SUPPRESSED',
          ${input.key},
          ${requestHash},
          clock_timestamp() + (${input.maxTtlSeconds}::int * interval '1 second'),
          0,
          clock_timestamp(),
          clock_timestamp()
        )
        RETURNING
          GREATEST(0, ceil(extract(epoch FROM (expires_at - clock_timestamp()))))::int
            AS expires_in_seconds,
          GREATEST(0, ceil(extract(epoch FROM (
            created_at + (${input.cooldownSeconds}::int * interval '1 second') - clock_timestamp()
          ))))::int AS resend_in_seconds
      `;
      const confirmed = suppressed[0];
      if (!confirmed) {
        throw new PasswordRecoverySendUnconfirmedError();
      }
      await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_SUPPRESSED', challengeId);
      return {
        kind: 'pending',
        body: recoveryPendingResponse(
          asInt(confirmed.expires_in_seconds),
          asInt(confirmed.resend_in_seconds),
        ),
      };
    }

    await tx.$executeRaw`
      INSERT INTO password_recovery_challenges (
        id, phone_hash, status, idempotency_key, request_hash,
        expires_at, verify_attempts, created_at, updated_at
      ) VALUES (
        ${challengeId}::uuid,
        ${phoneHash},
        'DISPATCHING',
        ${input.key},
        ${requestHash},
        clock_timestamp() + (${input.maxTtlSeconds}::int * interval '1 second'),
        0,
        clock_timestamp(),
        clock_timestamp()
      )
    `;
    await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_DISPATCHING', challengeId);
    return { kind: 'dispatch', challengeId };
  }

  private async markAmbiguous(challengeId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.passwordRecoveryChallenge.updateMany({
        where: { id: challengeId, status: PasswordRecoveryChallengeStatus.DISPATCHING },
        data: { status: PasswordRecoveryChallengeStatus.AMBIGUOUS },
      });
      if (updated.count === 1) {
        await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_AMBIGUOUS', challengeId);
      }
    });
  }

  private async markSuppressed(challengeId: string, cooldownSeconds: number) {
    const outcome = await this.prisma.client.$transaction(async (tx) => {
      const identity = await tx.passwordRecoveryChallenge.findUnique({
        where: { id: challengeId },
        select: { phoneHash: true },
      });
      if (!identity) {
        return { kind: 'unconfirmed' as const };
      }
      await lockRecoveryPhone(tx, identity.phoneHash);
      await expireOpenChallenges(tx, identity.phoneHash);
      const suppressed = await tx.$queryRaw<
        Array<{ expires_in_seconds: number | bigint; resend_in_seconds: number | bigint }>
      >`
        UPDATE password_recovery_challenges
        SET status = 'SUPPRESSED',
            updated_at = clock_timestamp()
        WHERE id = ${challengeId}::uuid
          AND status = 'DISPATCHING'
          AND expires_at > clock_timestamp()
        RETURNING
          GREATEST(0, ceil(extract(epoch FROM (expires_at - clock_timestamp()))))::int
            AS expires_in_seconds,
          GREATEST(0, ceil(extract(epoch FROM (
            created_at + (${cooldownSeconds}::int * interval '1 second') - clock_timestamp()
          ))))::int AS resend_in_seconds
      `;
      const confirmed = suppressed[0];
      if (confirmed) {
        await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_SUPPRESSED', challengeId);
        return {
          kind: 'pending' as const,
          body: recoveryPendingResponse(
            asInt(confirmed.expires_in_seconds),
            asInt(confirmed.resend_in_seconds),
          ),
        };
      }
      await markExpiredIfDue(tx, challengeId);
      const current = await tx.passwordRecoveryChallenge.findUnique({
        where: { id: challengeId },
        select: { status: true },
      });
      if (current?.status === PasswordRecoveryChallengeStatus.EXPIRED) {
        return { kind: 'expired' as const };
      }
      if (current?.status === PasswordRecoveryChallengeStatus.SUPPRESSED) {
        return replayStart(tx, {
          id: challengeId,
          status: current.status,
          requestHash: '',
          phoneHash: identity.phoneHash,
        }, cooldownSeconds);
      }
      return { kind: 'unconfirmed' as const };
    }, { maxWait: 5_000, timeout: 15_000 });
    if (outcome.kind === 'expired') {
      throw new PasswordRecoveryChallengeExpiredError();
    }
    if (outcome.kind === 'error') {
      throw outcome.error;
    }
    if (outcome.kind === 'unconfirmed') {
      throw new PasswordRecoverySendUnconfirmedError();
    }
    return outcome.body;
  }

  private async markSent(challengeId: string, receipt: OtpSendReceipt, maxTtlSeconds: number) {
    const boundedTtl = Math.max(0, Math.min(maxTtlSeconds, Math.floor(receipt.ttlSeconds)));
    const providerRequestId = receipt.requestId.slice(0, 128);
    const outcome = await this.prisma.client.$transaction(async (tx) => {
      const identity = await tx.passwordRecoveryChallenge.findUnique({
        where: { id: challengeId },
        select: { phoneHash: true },
      });
      if (!identity) {
        return { kind: 'unconfirmed' as const };
      }
      await lockRecoveryPhone(tx, identity.phoneHash);
      await expireOpenChallenges(tx, identity.phoneHash);
      const cooldown = this.config.values.PASSWORD_RECOVERY_RESEND_COOLDOWN_SECONDS;
      const sent = await tx.$queryRaw<
        Array<{ expires_in_seconds: number | bigint; resend_in_seconds: number | bigint }>
      >`
        UPDATE password_recovery_challenges
        SET status = 'SENT',
            provider_request_id = ${providerRequestId},
            expires_at = LEAST(
              expires_at,
              clock_timestamp() + (${boundedTtl}::int * interval '1 second')
            ),
            updated_at = clock_timestamp()
        WHERE id = ${challengeId}::uuid
          AND status = 'DISPATCHING'
          AND expires_at > clock_timestamp()
          AND (${boundedTtl}::int * interval '1 second') > interval '0'
        RETURNING
          GREATEST(0, ceil(extract(epoch FROM (expires_at - clock_timestamp()))))::int
            AS expires_in_seconds,
          GREATEST(0, ceil(extract(epoch FROM (
            created_at + (${cooldown}::int * interval '1 second') - clock_timestamp()
          ))))::int AS resend_in_seconds
      `;
      const confirmed = sent[0];
      if (confirmed) {
        await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_SENT', challengeId);
        return {
          kind: 'pending' as const,
          body: recoveryPendingResponse(
            asInt(confirmed.expires_in_seconds),
            asInt(confirmed.resend_in_seconds),
          ),
        };
      }
      const expired = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE password_recovery_challenges
        SET status = 'EXPIRED',
            updated_at = clock_timestamp()
        WHERE id = ${challengeId}::uuid
          AND status = 'DISPATCHING'
          AND NOT (
            expires_at > clock_timestamp()
            AND (${boundedTtl}::int * interval '1 second') > interval '0'
          )
        RETURNING id
      `;
      if (expired.length === 1) {
        await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_EXPIRED', challengeId);
        return { kind: 'expired' as const };
      }
      const current = await tx.passwordRecoveryChallenge.findUnique({
        where: { id: challengeId },
        select: { status: true },
      });
      if (current?.status === PasswordRecoveryChallengeStatus.EXPIRED) {
        return { kind: 'expired' as const };
      }
      return { kind: 'unconfirmed' as const };
    }, { maxWait: 5_000, timeout: 15_000 });
    if (outcome.kind === 'expired') {
      throw new PasswordRecoveryChallengeExpiredError();
    }
    if (outcome.kind === 'unconfirmed') {
      throw new PasswordRecoverySendUnconfirmedError();
    }
    return outcome.body;
  }
}

@Injectable()
export class VerifyPasswordRecoveryUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly otp: OtpyProvider,
  ) {}

  async execute(input: {
    phone: string;
    otpCode: string;
    idempotencyKey: string | string[] | undefined;
  }) {
    const phone = requirePhone(input.phone);
    if (!/^\d{4,8}$/.test(input.otpCode)) {
      throw new ValidationError('Enter the recovery code.');
    }
    const key = requireIdempotencyKey(input.idempotencyKey);
    const secret = requireRecoverySecret(this.config);
    const maxAttempts = this.config.values.PASSWORD_RECOVERY_MAX_VERIFY_ATTEMPTS;
    const cooldownSeconds = this.config.values.PASSWORD_RECOVERY_RESEND_COOLDOWN_SECONDS;
    const opened = await this.prisma.client.$transaction(
      (tx) =>
        this.openAttempt(tx, {
          phone,
          otpCode: input.otpCode,
          key,
          secret,
          maxAttempts,
          cooldownSeconds,
        }),
      { maxWait: 5_000, timeout: 15_000 },
    );
    if (opened.kind === 'already_issued') {
      throw new PasswordRecoveryProofAlreadyIssuedError();
    }
    if (opened.kind === 'unconfirmed') {
      throw new PasswordRecoveryVerificationUnconfirmedError();
    }
    if (opened.kind === 'superseded') {
      throw new PasswordRecoveryChallengeSupersededError();
    }
    if (opened.kind === 'expired') {
      throw new PasswordRecoveryChallengeExpiredError();
    }
    if (opened.kind === 'limit') {
      throw new PasswordRecoveryVerificationLimitError(opened.retryAfterSeconds);
    }
    if (opened.kind === 'failed') {
      throw new PasswordRecoveryVerificationFailedError();
    }
    if (opened.kind === 'deny') {
      throw new PasswordRecoveryVerificationFailedError();
    }

    let verified: boolean;
    try {
      verified = await this.otp.verify(phone, input.otpCode);
    } catch {
      await this.finishAttempt(opened.attemptId, PasswordRecoveryVerifyState.UNCONFIRMED);
      throw new PasswordRecoveryVerificationUnconfirmedError();
    }
    if (!verified) {
      await this.finishAttempt(opened.attemptId, PasswordRecoveryVerifyState.REJECTED);
      throw new PasswordRecoveryVerificationFailedError();
    }

    const proof = issueRecoveryProof();
    const saved = await this.prisma.client.$transaction(
      (tx) =>
        this.saveProof(tx, {
          challengeId: opened.challengeId,
          attemptId: opened.attemptId,
          phone,
          proofHash: recoveryProofHash(secret, proof),
          proofTtlSeconds: this.config.values.PASSWORD_RECOVERY_PROOF_TTL_SECONDS,
        }),
      { maxWait: 5_000, timeout: 15_000 },
    );
    if (!saved) {
      throw new PasswordRecoveryVerificationFailedError();
    }
    return {
      recoveryProof: proof,
      expiresInSeconds: this.config.values.PASSWORD_RECOVERY_PROOF_TTL_SECONDS,
    };
  }

  private async openAttempt(
    tx: Prisma.TransactionClient,
    input: {
      phone: string;
      otpCode: string;
      key: string;
      secret: string;
      maxAttempts: number;
      cooldownSeconds: number;
    },
  ): Promise<
    | { kind: 'call'; challengeId: string; attemptId: string }
    | { kind: 'deny' }
    | { kind: 'already_issued' }
    | { kind: 'unconfirmed' }
    | { kind: 'superseded' }
    | { kind: 'expired' }
    | { kind: 'limit'; retryAfterSeconds?: number }
    | { kind: 'failed' }
  > {
    const phoneHash = recoveryPhoneHash(input.secret, input.phone);
    const requestHash = recoveryVerifyHash(input.secret, input.phone, input.otpCode);
    await lockRecoveryPhone(tx, phoneHash);
    await closeExpiredProofs(tx, phoneHash);
    await expireOpenChallenges(tx, phoneHash);

    const prior = await tx.passwordRecoveryVerifyAttempt.findUnique({
      where: { idempotencyKey: input.key },
    });
    if (prior) {
      assertSameIdempotentRequest(prior.requestHash, requestHash);
      if (prior.state === PasswordRecoveryVerifyState.SUCCEEDED) {
        return { kind: 'already_issued' };
      }
      if (prior.state === PasswordRecoveryVerifyState.REJECTED) {
        return { kind: 'failed' };
      }
      return { kind: 'unconfirmed' };
    }

    const challenge = await tx.passwordRecoveryChallenge.findFirst({
      where: { phoneHash, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) {
      return classifyClosedChallenge(tx, phoneHash);
    }
    if (challenge.verifyAttempts >= input.maxAttempts) {
      return {
        kind: 'limit',
        retryAfterSeconds: await resendWaitSeconds(tx, challenge.id, input.cooldownSeconds),
      };
    }

    const reserved = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE password_recovery_challenges
      SET verify_attempts = verify_attempts + 1,
          updated_at = clock_timestamp()
      WHERE id = ${challenge.id}::uuid
        AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS', 'SUPPRESSED')
        AND verify_attempts < ${input.maxAttempts}
        AND expires_at > clock_timestamp()
      RETURNING id
    `;
    if (reserved.length !== 1) {
      await markExpiredIfDue(tx, challenge.id);
      const current = await tx.passwordRecoveryChallenge.findUnique({
        where: { id: challenge.id },
        select: { status: true, verifyAttempts: true },
      });
      if (current?.status === PasswordRecoveryChallengeStatus.INVALIDATED) {
        return { kind: 'superseded' };
      }
      if (current?.status === PasswordRecoveryChallengeStatus.EXPIRED) {
        return { kind: 'expired' };
      }
      if (current && current.verifyAttempts >= input.maxAttempts) {
        return {
          kind: 'limit',
          retryAfterSeconds: await resendWaitSeconds(tx, challenge.id, input.cooldownSeconds),
        };
      }
      return { kind: 'failed' };
    }

    const attemptId = createId();
    const eligible = eligibilityOf(await loadRecoveryAccounts(tx, input.phone)).eligible;
    if (!eligible || challenge.status === PasswordRecoveryChallengeStatus.SUPPRESSED) {
      await tx.passwordRecoveryVerifyAttempt.create({
        data: {
          id: attemptId,
          challengeId: challenge.id,
          idempotencyKey: input.key,
          requestHash,
          state: PasswordRecoveryVerifyState.REJECTED,
          updatedAt: new Date(),
        },
      });
      return { kind: 'deny' };
    }

    await tx.passwordRecoveryVerifyAttempt.create({
      data: {
        id: attemptId,
        challengeId: challenge.id,
        idempotencyKey: input.key,
        requestHash,
        state: PasswordRecoveryVerifyState.IN_PROGRESS,
        updatedAt: new Date(),
      },
    });
    return { kind: 'call', challengeId: challenge.id, attemptId };
  }

  private async finishAttempt(
    attemptId: string,
    state: PasswordRecoveryVerifyState,
  ): Promise<void> {
    await this.prisma.client.passwordRecoveryVerifyAttempt.updateMany({
      where: { id: attemptId, state: PasswordRecoveryVerifyState.IN_PROGRESS },
      data: { state },
    });
  }

  private async saveProof(
    tx: Prisma.TransactionClient,
    input: {
      challengeId: string;
      attemptId: string;
      phone: string;
      proofHash: string;
      proofTtlSeconds: number;
    },
  ): Promise<boolean> {
    const identity = await tx.passwordRecoveryChallenge.findUnique({
      where: { id: input.challengeId },
      select: { phoneHash: true },
    });
    if (!identity) {
      await tx.passwordRecoveryVerifyAttempt.updateMany({
        where: { id: input.attemptId, state: PasswordRecoveryVerifyState.IN_PROGRESS },
        data: { state: PasswordRecoveryVerifyState.REJECTED },
      });
      return false;
    }
    await lockRecoveryPhone(tx, identity.phoneHash);
    const challenge = await tx.passwordRecoveryChallenge.findUnique({
      where: { id: input.challengeId },
      select: { status: true },
    });
    if (
      !challenge ||
      challenge.status === PasswordRecoveryChallengeStatus.SUPPRESSED ||
      !eligibilityOf(await loadRecoveryAccounts(tx, input.phone)).eligible
    ) {
      await tx.passwordRecoveryVerifyAttempt.updateMany({
        where: { id: input.attemptId, state: PasswordRecoveryVerifyState.IN_PROGRESS },
        data: { state: PasswordRecoveryVerifyState.REJECTED },
      });
      return false;
    }
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE password_recovery_challenges
      SET status = 'VERIFIED',
          proof_hash = ${input.proofHash},
          proof_expires_at = clock_timestamp() + (${input.proofTtlSeconds}::int * interval '1 second'),
          verified_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE id = ${input.challengeId}::uuid
        AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS')
        AND proof_hash IS NULL
        AND expires_at > clock_timestamp()
      RETURNING id
    `;
    if (updated.length !== 1) {
      await markExpiredIfDue(tx, input.challengeId);
      await tx.passwordRecoveryVerifyAttempt.updateMany({
        where: { id: input.attemptId, state: PasswordRecoveryVerifyState.IN_PROGRESS },
        data: { state: PasswordRecoveryVerifyState.REJECTED },
      });
      return false;
    }
    await tx.passwordRecoveryVerifyAttempt.updateMany({
      where: { id: input.attemptId, state: PasswordRecoveryVerifyState.IN_PROGRESS },
      data: { state: PasswordRecoveryVerifyState.SUCCEEDED },
    });
    await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_VERIFIED', input.challengeId);
    return true;
  }
}

@Injectable()
export class CompletePasswordRecoveryUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(input: {
    phone: string;
    recoveryProof: string;
    password: string;
    passwordConfirmation: string;
    idempotencyKey: string | string[] | undefined;
  }) {
    const secret = requireRecoverySecret(this.config);
    const phone = requirePhone(input.phone);
    if (input.password !== input.passwordConfirmation) {
      throw new ValidationError('Enter the same password in both fields.');
    }
    if (input.recoveryProof.length < 20) {
      throw new PasswordRecoveryVerificationFailedError('Recovery proof is not valid.');
    }
    const key = requireIdempotencyKey(input.idempotencyKey);
    const requestHash = recoveryCompletionHash(secret, {
      phone,
      password: input.password,
      proof: input.recoveryProof,
    });
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      return await this.prisma.client.$transaction(
        (tx) =>
          this.complete(tx, {
            phone,
            proof: input.recoveryProof,
            passwordHash,
            key,
            requestHash,
            secret,
          }),
        { maxWait: 5_000, timeout: 15_000 },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.client.$transaction(
          (tx) =>
            this.complete(tx, {
              phone,
              proof: input.recoveryProof,
              passwordHash,
              key,
              requestHash,
              secret,
            }),
          { maxWait: 5_000, timeout: 15_000 },
        );
      }
      throw error;
    }
  }

  private async complete(
    tx: Prisma.TransactionClient,
    input: {
      phone: string;
      proof: string;
      passwordHash: string;
      key: string;
      requestHash: string;
      secret: string;
    },
  ) {
    const phoneHash = recoveryPhoneHash(input.secret, input.phone);
    await lockRecoveryPhone(tx, phoneHash);

    const existing = await tx.passwordRecoveryCompletion.findUnique({
      where: { idempotencyKey: input.key },
    });
    if (existing) {
      assertSameIdempotentRequest(existing.requestHash, input.requestHash);
      return { outcome: 'reset' as const };
    }

    const consumed = await consumeProof(tx, recoveryProofHash(input.secret, input.proof), phoneHash);
    const accounts = await loadRecoveryAccounts(tx, input.phone);
    const eligibility = eligibilityOf(accounts);
    if (eligibility.eligible && eligibility.kind === 'salon' && accounts.user) {
      await tx.user.update({
        where: { id: accounts.user.id },
        data: {
          passwordHash: input.passwordHash,
          credentialsVersion: { increment: 1 },
        },
      });
      await writeAudit(tx, 'PASSWORD_RECOVERY_PASSWORD_RESET', consumed.challengeId, {
        accountKind: 'SALON_USER',
        accountId: accounts.user.id,
        tenantId: accounts.user.salonId,
      });
    } else if (eligibility.eligible && eligibility.kind === 'admin' && accounts.admin) {
      await tx.platformAdmin.update({
        where: { id: accounts.admin.id },
        data: {
          passwordHash: input.passwordHash,
          credentialsVersion: { increment: 1 },
        },
      });
      await writeAudit(tx, 'PASSWORD_RECOVERY_PASSWORD_RESET', consumed.challengeId, {
        accountKind: 'PLATFORM_ADMIN',
        accountId: accounts.admin.id,
      });
    }

    await tx.passwordRecoveryCompletion.create({
      data: {
        id: createId(),
        idempotencyKey: input.key,
        requestHash: input.requestHash,
        challengeId: consumed.challengeId,
      },
    });
    return { outcome: 'reset' as const };
  }
}

async function consumeProof(
  tx: Prisma.TransactionClient,
  proofHash: string,
  phoneHash: string,
): Promise<{ challengeId: string }> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE password_recovery_challenges
    SET proof_consumed_at = clock_timestamp(),
        proof_closed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE proof_hash = ${proofHash}
      AND phone_hash = ${phoneHash}
      AND status = 'VERIFIED'
      AND proof_consumed_at IS NULL
      AND proof_closed_at IS NULL
      AND proof_expires_at > clock_timestamp()
    RETURNING id
  `;
  const consumed = rows[0];
  if (rows.length !== 1 || !consumed) {
    const expired = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM password_recovery_challenges
      WHERE proof_hash = ${proofHash}
        AND phone_hash = ${phoneHash}
        AND status = 'VERIFIED'
        AND proof_expires_at <= clock_timestamp()
      LIMIT 1
    `;
    if (expired.length === 1) {
      throw new PasswordRecoveryProofExpiredError();
    }
    throw new PasswordRecoveryVerificationFailedError('Recovery proof is not valid.');
  }
  await writeAudit(tx, 'PASSWORD_RECOVERY_PROOF_CONSUMED', consumed.id);
  return { challengeId: consumed.id };
}

async function replayStart(
  tx: Prisma.TransactionClient,
  existing: ChallengeRow,
  cooldownSeconds: number,
): Promise<
  | {
      kind: 'pending';
      body: { outcome: 'pending'; expiresInSeconds: number; resendAvailableInSeconds: number };
    }
  | { kind: 'error'; error: Error }
> {
  if (
    existing.status === PasswordRecoveryChallengeStatus.SENT ||
    existing.status === PasswordRecoveryChallengeStatus.SUPPRESSED
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        still_open: boolean;
        expires_in_seconds: number | bigint;
        resend_in_seconds: number | bigint;
      }>
    >`
      SELECT
        expires_at > clock_timestamp() AS still_open,
        GREATEST(0, ceil(extract(epoch FROM (expires_at - clock_timestamp()))))::int
          AS expires_in_seconds,
        GREATEST(0, ceil(extract(epoch FROM (
          created_at + (${cooldownSeconds}::int * interval '1 second') - clock_timestamp()
        ))))::int AS resend_in_seconds
      FROM password_recovery_challenges
      WHERE id = ${existing.id}::uuid
        AND status IN ('SENT', 'SUPPRESSED')
    `;
    const row = rows[0];
    if (!row?.still_open) {
      await markExpiredIfDue(tx, existing.id);
      return { kind: 'error', error: new PasswordRecoveryChallengeExpiredError() };
    }
    return {
      kind: 'pending',
      body: {
        outcome: 'pending',
        expiresInSeconds: asInt(row.expires_in_seconds),
        resendAvailableInSeconds: asInt(row.resend_in_seconds),
      },
    };
  }
  if (
    existing.status === PasswordRecoveryChallengeStatus.DISPATCHING ||
    existing.status === PasswordRecoveryChallengeStatus.AMBIGUOUS
  ) {
    return { kind: 'error', error: new PasswordRecoverySendUnconfirmedError() };
  }
  if (existing.status === PasswordRecoveryChallengeStatus.INVALIDATED) {
    return { kind: 'error', error: new PasswordRecoveryChallengeSupersededError() };
  }
  if (existing.status === PasswordRecoveryChallengeStatus.EXPIRED) {
    return { kind: 'error', error: new PasswordRecoveryChallengeExpiredError() };
  }
  const resend = await tx.$queryRaw<Array<ClockCount>>`
    SELECT GREATEST(0, ceil(extract(epoch FROM (
      created_at + (${cooldownSeconds}::int * interval '1 second') - clock_timestamp()
    ))))::int AS value
    FROM password_recovery_challenges
    WHERE id = ${existing.id}::uuid
  `;
  return {
    kind: 'pending',
    body: {
      outcome: 'pending',
      expiresInSeconds: 0,
      resendAvailableInSeconds: asInt(resend[0]?.value ?? 0),
    },
  };
}

export async function lockRecoveryPhone(
  tx: Prisma.TransactionClient,
  phoneHash: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recovery:${phoneHash}`})::bigint)`;
}

async function closeExpiredProofs(
  tx: Prisma.TransactionClient,
  phoneHash: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE password_recovery_challenges
    SET proof_closed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE phone_hash = ${phoneHash}
      AND status = 'VERIFIED'
      AND proof_closed_at IS NULL
      AND proof_expires_at <= clock_timestamp()
  `;
}

async function expireOpenChallenges(
  tx: Prisma.TransactionClient,
  phoneHash: string,
): Promise<void> {
  const expired = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE password_recovery_challenges
    SET status = 'EXPIRED',
        updated_at = clock_timestamp()
    WHERE phone_hash = ${phoneHash}
      AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS', 'SUPPRESSED')
      AND expires_at <= clock_timestamp()
    RETURNING id
  `;
  for (const row of expired) {
    await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_EXPIRED', row.id);
  }
}

async function classifyClosedChallenge(
  tx: Prisma.TransactionClient,
  phoneHash: string,
): Promise<{ kind: 'superseded' } | { kind: 'expired' } | { kind: 'failed' }> {
  const latest = await tx.passwordRecoveryChallenge.findFirst({
    where: { phoneHash },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });
  if (latest?.status === PasswordRecoveryChallengeStatus.INVALIDATED) {
    return { kind: 'superseded' };
  }
  if (latest?.status === PasswordRecoveryChallengeStatus.EXPIRED) {
    return { kind: 'expired' };
  }
  return { kind: 'failed' };
}

async function resendWaitSeconds(
  tx: Prisma.TransactionClient,
  challengeId: string,
  cooldownSeconds: number,
): Promise<number | undefined> {
  const rows = await tx.$queryRaw<Array<ClockCount>>`
    SELECT GREATEST(0, ceil(extract(epoch FROM (
      created_at + (${cooldownSeconds}::int * interval '1 second') - clock_timestamp()
    ))))::int AS value
    FROM password_recovery_challenges
    WHERE id = ${challengeId}::uuid
  `;
  const value = rows[0]?.value;
  return value === undefined ? undefined : asInt(value);
}

async function markExpiredIfDue(
  tx: Prisma.TransactionClient,
  challengeId: string,
): Promise<void> {
  const expired = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE password_recovery_challenges
    SET status = 'EXPIRED',
        updated_at = clock_timestamp()
    WHERE id = ${challengeId}::uuid
      AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS', 'SUPPRESSED')
      AND expires_at <= clock_timestamp()
    RETURNING id
  `;
  if (expired.length === 1) {
    await writeAudit(tx, 'PASSWORD_RECOVERY_CHALLENGE_EXPIRED', challengeId);
  }
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  action: string,
  challengeId: string,
  extra: Record<string, string> = {},
): Promise<void> {
  await tx.auditLog.create({
    data: {
      id: createId(),
      tenantId: extra.tenantId,
      actorId: extra.accountId,
      action,
      resource: 'password_recovery_challenge',
      resourceId: challengeId,
      result: 'SUCCESS',
      metadata: { challengeId, ...omitUndefined(extra) },
    },
  });
}

function omitUndefined(value: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      next[key] = item;
    }
  }
  return next;
}

function requirePhone(raw: string): string {
  const phone = normalizeIranianMobile(raw);
  if (!phone) {
    throw new ValidationError('Enter an Iranian mobile number.');
  }
  return phone;
}

type RecoveryAccounts = {
  user: {
    id: string;
    salonId: string;
    status: string;
    salon: { status: string };
  } | null;
  admin: { id: string; status: string } | null;
};

async function loadRecoveryAccounts(
  tx: Prisma.TransactionClient,
  phone: string,
): Promise<RecoveryAccounts> {
  const [user, admin] = await Promise.all([
    tx.user.findUnique({
      where: { phone },
      select: {
        id: true,
        salonId: true,
        status: true,
        salon: { select: { status: true } },
      },
    }),
    tx.platformAdmin.findUnique({
      where: { phone },
      select: { id: true, status: true },
    }),
  ]);
  return { user, admin };
}

function eligibilityOf(accounts: RecoveryAccounts): RecoveryEligibility {
  return resolveRecoveryEligibility({
    user: accounts.user
      ? { status: accounts.user.status, salonStatus: accounts.user.salon.status }
      : null,
    admin: accounts.admin ? { status: accounts.admin.status } : null,
  });
}

function requireRecoverySecret(config: AppConfigService): string {
  const secret = config.values.PASSWORD_RECOVERY_HASH_SECRET;
  if (!secret) {
    throw new NotFoundError();
  }
  return secret;
}

function asInt(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

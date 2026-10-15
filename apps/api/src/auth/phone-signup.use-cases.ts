import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SignupPhoneChallengeStatus,
  SignupPhoneVerifyState,
} from '@salon/database';
import {
  ConflictError,
  NotFoundError,
  SignupChallengeExpiredError,
  SignupChallengeSupersededError,
  SignupProofAlreadyIssuedError,
  SignupResendCooldownError,
  SignupSendLimitError,
  SignupSendUnconfirmedError,
  SignupVerificationFailedError,
  SignupVerificationUnconfirmedError,
  ValidationError,
  createId,
} from '@salon/shared';
import type { OtpSendReceipt } from './otp-provider';
import { OtpyProvider } from './otp-provider';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { assertSameIdempotentRequest, requireIdempotencyKey } from '../infrastructure/http/idempotency';
import {
  issueSignupProof,
  normalizeIranianMobile,
  signupPhoneHash,
  signupProofHash,
  signupStartHash,
  signupVerifyHash,
} from './signup-phone';

/**
 * User-initiated proof that a future salon owner possesses a mobile number.
 * Not an ordinary or VIP marketing send. The marketing-stop module is not consulted.
 * OTPy has no send idempotency, so an unconfirmed dispatch is never retried silently.
 */

type ChallengeRow = {
  id: string;
  status: SignupPhoneChallengeStatus;
  requestHash: string;
  phoneHash: string;
};

type ClockCount = { value: number | bigint };

const OPEN_STATUSES: SignupPhoneChallengeStatus[] = [
  SignupPhoneChallengeStatus.DISPATCHING,
  SignupPhoneChallengeStatus.SENT,
  SignupPhoneChallengeStatus.AMBIGUOUS,
];

@Injectable()
export class StartPhoneSignupUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly otp: OtpyProvider,
  ) {}

  async execute(input: { phone: string; idempotencyKey: string | string[] | undefined }) {
    const phone = this.phone(input.phone);
    const key = requireIdempotencyKey(input.idempotencyKey);
    const secret = this.secret();
    const limits = this.config.values;
    const decision = await this.prepareCommitted({
      phone,
      key,
      secret,
      cooldownSeconds: limits.PHONE_SIGNUP_RESEND_COOLDOWN_SECONDS,
      maxSends: limits.PHONE_SIGNUP_MAX_SENDS,
      windowSeconds: limits.PHONE_SIGNUP_SEND_WINDOW_SECONDS,
      maxTtlSeconds: limits.PHONE_SIGNUP_MAX_TTL_SECONDS,
    });
    if (decision.kind === 'pending') {
      return decision.body;
    }
    if (decision.kind === 'error') {
      throw decision.error;
    }

    let receipt: OtpSendReceipt;
    try {
      receipt = await this.otp.send(phone);
    } catch {
      await this.markAmbiguous(decision.challengeId);
      throw new SignupSendUnconfirmedError();
    }

    try {
      return await this.markSent(decision.challengeId, receipt, limits.PHONE_SIGNUP_MAX_TTL_SECONDS);
    } catch (error) {
      if (error instanceof SignupChallengeExpiredError) {
        throw error;
      }
      await this.markAmbiguous(decision.challengeId);
      throw new SignupSendUnconfirmedError();
    }
  }

  private phone(raw: string): string {
    const phone = normalizeIranianMobile(raw);
    if (!phone) {
      throw new ValidationError('Enter an Iranian mobile number.');
    }
    return phone;
  }

  private secret(): string {
    const secret = this.config.values.PHONE_SIGNUP_HASH_SECRET;
    if (!this.config.values.PHONE_SIGNUP_ENABLED || !secret) {
      throw new NotFoundError();
    }
    return secret;
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
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
    const phoneHash = signupPhoneHash(input.secret, input.phone);
    const requestHash = signupStartHash(input.secret, input.phone);
    await lockPhone(tx, phoneHash);
    await closeExpiredProofs(tx, phoneHash);
    await expireOpenChallenges(tx, phoneHash);

    const existing = await tx.signupPhoneChallenge.findUnique({
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
      Array<{ id: string; status: SignupPhoneChallengeStatus; wait_seconds: number | bigint }>
    >`
      SELECT id, status,
        GREATEST(0, ceil(extract(epoch FROM (
          created_at + (${input.cooldownSeconds}::int * interval '1 second') - clock_timestamp()
        ))))::int AS wait_seconds
      FROM signup_phone_challenges
      WHERE phone_hash = ${phoneHash}
        AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS')
        AND expires_at > clock_timestamp()
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const open = openRows[0];
    if (open) {
      const wait = asInt(open.wait_seconds);
      if (wait > 0) {
        if (open.status === SignupPhoneChallengeStatus.SENT) {
          return { kind: 'error', error: new SignupResendCooldownError(wait) };
        }
        return { kind: 'error', error: new SignupSendUnconfirmedError() };
      }
    }

    const openProof = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM signup_phone_challenges
      WHERE phone_hash = ${phoneHash}
        AND status = 'VERIFIED'
        AND proof_closed_at IS NULL
        AND proof_expires_at > clock_timestamp()
      LIMIT 1
    `;
    if (openProof.length > 0) {
      return { kind: 'error', error: new SignupSendLimitError() };
    }

    const sentRows = await tx.$queryRaw<Array<ClockCount>>`
      SELECT count(*)::int AS value
      FROM signup_phone_challenges
      WHERE phone_hash = ${phoneHash}
        AND created_at >= clock_timestamp() - (${input.windowSeconds}::int * interval '1 second')
    `;
    if (asInt(sentRows[0]?.value ?? 0) >= input.maxSends) {
      return { kind: 'error', error: new SignupSendLimitError() };
    }

    if (open) {
      const invalidated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE signup_phone_challenges
        SET status = 'INVALIDATED',
            invalidated_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = ${open.id}::uuid
          AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS')
          AND expires_at > clock_timestamp()
        RETURNING id
      `;
      if (invalidated.length === 1) {
        await writeAudit(tx, 'SIGNUP_PHONE_CHALLENGE_INVALIDATED', open.id);
      } else {
        await expireOpenChallenges(tx, phoneHash);
      }
    }

    const challengeId = createId();
    await tx.$executeRaw`
      INSERT INTO signup_phone_challenges (
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
    await writeAudit(tx, 'SIGNUP_PHONE_CHALLENGE_DISPATCHING', challengeId);
    return { kind: 'dispatch', challengeId };
  }

  private async markAmbiguous(challengeId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.signupPhoneChallenge.updateMany({
        where: { id: challengeId, status: SignupPhoneChallengeStatus.DISPATCHING },
        data: { status: SignupPhoneChallengeStatus.AMBIGUOUS },
      });
      if (updated.count === 1) {
        await writeAudit(tx, 'SIGNUP_PHONE_CHALLENGE_AMBIGUOUS', challengeId);
      }
    });
  }

  private async markSent(challengeId: string, receipt: OtpSendReceipt, maxTtlSeconds: number) {
    const boundedTtl = Math.max(0, Math.min(maxTtlSeconds, Math.floor(receipt.ttlSeconds)));
    const providerRequestId = receipt.requestId.slice(0, 128);
    const outcome = await this.prisma.client.$transaction(async (tx) => {
      const identity = await tx.signupPhoneChallenge.findUnique({
        where: { id: challengeId },
        select: { phoneHash: true },
      });
      if (!identity) {
        return { kind: 'unconfirmed' as const };
      }
      await lockPhone(tx, identity.phoneHash);
      await expireOpenChallenges(tx, identity.phoneHash);
      const cooldown = this.config.values.PHONE_SIGNUP_RESEND_COOLDOWN_SECONDS;
      const sent = await tx.$queryRaw<
        Array<{ expires_in_seconds: number | bigint; resend_in_seconds: number | bigint }>
      >`
        UPDATE signup_phone_challenges
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
        await writeAudit(tx, 'SIGNUP_PHONE_CHALLENGE_SENT', challengeId);
        const resendIn = asInt(confirmed.resend_in_seconds);
        return {
          kind: 'pending' as const,
          body: {
            outcome: 'pending' as const,
            expiresInSeconds: asInt(confirmed.expires_in_seconds),
            resendAvailableInSeconds: resendIn || cooldown,
          },
        };
      }
      const expired = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE signup_phone_challenges
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
        await writeAudit(tx, 'SIGNUP_PHONE_CHALLENGE_EXPIRED', challengeId);
        return { kind: 'expired' as const };
      }
      const current = await tx.signupPhoneChallenge.findUnique({
        where: { id: challengeId },
        select: { status: true },
      });
      if (current?.status === SignupPhoneChallengeStatus.EXPIRED) {
        return { kind: 'expired' as const };
      }
      return { kind: 'unconfirmed' as const };
    }, { maxWait: 5_000, timeout: 15_000 });
    if (outcome.kind === 'expired') {
      throw new SignupChallengeExpiredError();
    }
    if (outcome.kind === 'unconfirmed') {
      throw new SignupSendUnconfirmedError();
    }
    return outcome.body;
  }
}

@Injectable()
export class VerifyPhoneSignupUseCase {
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
    const phone = normalizeIranianMobile(input.phone);
    if (!phone) {
      throw new ValidationError('Enter an Iranian mobile number.');
    }
    if (!/^\d{4,8}$/.test(input.otpCode)) {
      throw new ValidationError('Enter the signup code.');
    }
    const key = requireIdempotencyKey(input.idempotencyKey);
    const secret = this.config.values.PHONE_SIGNUP_HASH_SECRET;
    if (!this.config.values.PHONE_SIGNUP_ENABLED || !secret) {
      throw new NotFoundError();
    }
    const maxAttempts = this.config.values.PHONE_SIGNUP_MAX_VERIFY_ATTEMPTS;
    const opened = await this.prisma.client.$transaction(
      (tx) => this.openAttempt(tx, { phone, otpCode: input.otpCode, key, secret, maxAttempts }),
      { maxWait: 5_000, timeout: 15_000 },
    );
    if (opened.kind === 'already_issued') {
      throw new SignupProofAlreadyIssuedError();
    }
    if (opened.kind === 'unconfirmed') {
      throw new SignupVerificationUnconfirmedError();
    }
    if (opened.kind === 'failed') {
      throw new SignupVerificationFailedError();
    }

    let verified: boolean;
    try {
      verified = await this.otp.verify(phone, input.otpCode);
    } catch {
      await this.finishAttempt(opened.attemptId, SignupPhoneVerifyState.UNCONFIRMED);
      throw new SignupVerificationUnconfirmedError();
    }
    if (!verified) {
      await this.finishAttempt(opened.attemptId, SignupPhoneVerifyState.REJECTED);
      throw new SignupVerificationFailedError();
    }

    const proof = issueSignupProof();
    const saved = await this.prisma.client.$transaction(
      (tx) =>
        this.saveProof(tx, {
          challengeId: opened.challengeId,
          attemptId: opened.attemptId,
          proofHash: signupProofHash(secret, proof),
          proofTtlSeconds: this.config.values.PHONE_SIGNUP_PROOF_TTL_SECONDS,
        }),
      { maxWait: 5_000, timeout: 15_000 },
    );
    if (!saved) {
      throw new SignupVerificationFailedError();
    }
    return {
      signupProof: proof,
      expiresInSeconds: this.config.values.PHONE_SIGNUP_PROOF_TTL_SECONDS,
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
    },
  ): Promise<
    | { kind: 'call'; challengeId: string; attemptId: string }
    | { kind: 'already_issued' }
    | { kind: 'unconfirmed' }
    | { kind: 'failed' }
  > {
    const phoneHash = signupPhoneHash(input.secret, input.phone);
    const requestHash = signupVerifyHash(input.secret, input.phone, input.otpCode);
    await lockPhone(tx, phoneHash);
    await closeExpiredProofs(tx, phoneHash);
    await expireOpenChallenges(tx, phoneHash);

    const prior = await tx.signupPhoneVerifyAttempt.findUnique({
      where: { idempotencyKey: input.key },
    });
    if (prior) {
      assertSameIdempotentRequest(prior.requestHash, requestHash);
      if (prior.state === SignupPhoneVerifyState.SUCCEEDED) {
        return { kind: 'already_issued' };
      }
      if (prior.state === SignupPhoneVerifyState.REJECTED) {
        return { kind: 'failed' };
      }
      return { kind: 'unconfirmed' };
    }

    const challenge = await tx.signupPhoneChallenge.findFirst({
      where: { phoneHash, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.verifyAttempts >= input.maxAttempts) {
      return { kind: 'failed' };
    }

    const reserved = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE signup_phone_challenges
      SET verify_attempts = verify_attempts + 1,
          updated_at = clock_timestamp()
      WHERE id = ${challenge.id}::uuid
        AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS')
        AND verify_attempts < ${input.maxAttempts}
        AND expires_at > clock_timestamp()
      RETURNING id
    `;
    if (reserved.length !== 1) {
      await markExpiredIfDue(tx, challenge.id);
      return { kind: 'failed' };
    }

    const attemptId = createId();
    await tx.signupPhoneVerifyAttempt.create({
      data: {
        id: attemptId,
        challengeId: challenge.id,
        idempotencyKey: input.key,
        requestHash,
        state: SignupPhoneVerifyState.IN_PROGRESS,
        updatedAt: new Date(),
      },
    });
    return { kind: 'call', challengeId: challenge.id, attemptId };
  }

  private async finishAttempt(attemptId: string, state: SignupPhoneVerifyState): Promise<void> {
    await this.prisma.client.signupPhoneVerifyAttempt.updateMany({
      where: { id: attemptId, state: SignupPhoneVerifyState.IN_PROGRESS },
      data: { state },
    });
  }

  private async saveProof(
    tx: Prisma.TransactionClient,
    input: { challengeId: string; attemptId: string; proofHash: string; proofTtlSeconds: number },
  ): Promise<boolean> {
    const identity = await tx.signupPhoneChallenge.findUnique({
      where: { id: input.challengeId },
      select: { phoneHash: true },
    });
    if (!identity) {
      await tx.signupPhoneVerifyAttempt.updateMany({
        where: { id: input.attemptId, state: SignupPhoneVerifyState.IN_PROGRESS },
        data: { state: SignupPhoneVerifyState.REJECTED },
      });
      return false;
    }
    await lockPhone(tx, identity.phoneHash);
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE signup_phone_challenges
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
      await tx.signupPhoneVerifyAttempt.updateMany({
        where: { id: input.attemptId, state: SignupPhoneVerifyState.IN_PROGRESS },
        data: { state: SignupPhoneVerifyState.REJECTED },
      });
      return false;
    }
    await tx.signupPhoneVerifyAttempt.updateMany({
      where: { id: input.attemptId, state: SignupPhoneVerifyState.IN_PROGRESS },
      data: { state: SignupPhoneVerifyState.SUCCEEDED },
    });
    await writeAudit(tx, 'SIGNUP_PHONE_CHALLENGE_VERIFIED', input.challengeId);
    return true;
  }
}

@Injectable()
export class ConsumeSignupProofUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Atomically consumes a proof for the expected phone inside the caller's
   * transaction, or its own. Not an HTTP route.
   */
  async execute(
    proof: string,
    expectedPhone: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ challengeId: string }> {
    const secret = this.config.values.PHONE_SIGNUP_HASH_SECRET;
    if (!this.config.values.PHONE_SIGNUP_ENABLED || !secret) {
      throw new NotFoundError();
    }
    const phone = normalizeIranianMobile(expectedPhone);
    if (!phone || proof.length < 20) {
      throw new SignupVerificationFailedError('Signup proof is not valid.');
    }
    const proofHash = signupProofHash(secret, proof);
    const phoneHash = signupPhoneHash(secret, phone);
    const run = (client: Prisma.TransactionClient) => this.consume(client, proofHash, phoneHash);
    if (tx) {
      return run(tx);
    }
    return this.prisma.client.$transaction(run, { maxWait: 5_000, timeout: 15_000 });
  }

  private async consume(
    tx: Prisma.TransactionClient,
    proofHash: string,
    phoneHash: string,
  ): Promise<{ challengeId: string }> {
    await lockPhone(tx, phoneHash);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE signup_phone_challenges
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
      throw new SignupVerificationFailedError('Signup proof is not valid.');
    }
    await writeAudit(tx, 'SIGNUP_PHONE_PROOF_CONSUMED', consumed.id);
    return { challengeId: consumed.id };
  }
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
  if (existing.status === SignupPhoneChallengeStatus.SENT) {
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
      FROM signup_phone_challenges
      WHERE id = ${existing.id}::uuid
        AND status = 'SENT'
    `;
    const row = rows[0];
    if (!row?.still_open) {
      await markExpiredIfDue(tx, existing.id);
      return { kind: 'error', error: new SignupChallengeExpiredError() };
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
    existing.status === SignupPhoneChallengeStatus.DISPATCHING ||
    existing.status === SignupPhoneChallengeStatus.AMBIGUOUS
  ) {
    return { kind: 'error', error: new SignupSendUnconfirmedError() };
  }
  if (existing.status === SignupPhoneChallengeStatus.INVALIDATED) {
    return { kind: 'error', error: new SignupChallengeSupersededError() };
  }
  if (existing.status === SignupPhoneChallengeStatus.EXPIRED) {
    return { kind: 'error', error: new SignupChallengeExpiredError() };
  }
  const resend = await tx.$queryRaw<Array<ClockCount>>`
    SELECT GREATEST(0, ceil(extract(epoch FROM (
      created_at + (${cooldownSeconds}::int * interval '1 second') - clock_timestamp()
    ))))::int AS value
    FROM signup_phone_challenges
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

async function lockPhone(tx: Prisma.TransactionClient, phoneHash: string): Promise<void> {
  // Transaction-scoped. now()/CURRENT_TIMESTAMP stay at transaction start and
  // would still show the pre-wait time after this returns. Deadline predicates
  // below use clock_timestamp() in the write that accepts or rejects the row.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phoneHash})::bigint)`;
}

async function closeExpiredProofs(
  tx: Prisma.TransactionClient,
  phoneHash: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE signup_phone_challenges
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
    UPDATE signup_phone_challenges
    SET status = 'EXPIRED',
        updated_at = clock_timestamp()
    WHERE phone_hash = ${phoneHash}
      AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS')
      AND expires_at <= clock_timestamp()
    RETURNING id
  `;
  for (const row of expired) {
    await writeAudit(tx, 'SIGNUP_PHONE_CHALLENGE_EXPIRED', row.id);
  }
}

async function markExpiredIfDue(
  tx: Prisma.TransactionClient,
  challengeId: string,
): Promise<void> {
  const expired = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE signup_phone_challenges
    SET status = 'EXPIRED',
        updated_at = clock_timestamp()
    WHERE id = ${challengeId}::uuid
      AND status IN ('DISPATCHING', 'SENT', 'AMBIGUOUS')
      AND expires_at <= clock_timestamp()
    RETURNING id
  `;
  if (expired.length === 1) {
    await writeAudit(tx, 'SIGNUP_PHONE_CHALLENGE_EXPIRED', challengeId);
  }
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  action: string,
  challengeId: string,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      id: createId(),
      action,
      resource: 'signup_phone_challenge',
      resourceId: challengeId,
      result: 'SUCCESS',
      metadata: { challengeId },
    },
  });
}

function asInt(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

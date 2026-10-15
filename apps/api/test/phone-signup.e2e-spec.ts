import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { SignupPhoneChallengeStatus } from '@salon/database';
import { InfrastructureError } from '@salon/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpyProvider, type OtpSendReceipt } from '../src/auth/otp-provider';
import { ConsumeSignupProofUseCase } from '../src/auth/phone-signup.use-cases';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const databaseUrl = process.env.PHONE_SIGNUP_DISPOSABLE_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, '') : '';
const disposable =
  Boolean(databaseUrl) &&
  process.env.DATABASE_URL === databaseUrl &&
  databaseName.startsWith('salon_phone_signup_') &&
  databaseName !== 'salon' &&
  databaseName !== 'salon_preview';

const describeIfDisposable = disposable ? describe : describe.skip;

class FakeOtpy {
  sends: string[] = [];
  verifyCalls = 0;
  mode: 'match' | 'always' | 'timeout' | 'failure' | 'hang' = 'match';
  acceptedCode = '222222';
  duringVerify: (() => Promise<void>) | null = null;
  private hang: {
    resolve: (value: OtpSendReceipt) => void;
    reject: (error: Error) => void;
  } | null = null;

  async send(phone: string): Promise<OtpSendReceipt> {
    this.sends.push(phone);
    if (this.mode === 'timeout') {
      throw new InfrastructureError('Outbound request timed out');
    }
    if (this.mode === 'failure') {
      throw new InfrastructureError();
    }
    if (this.mode === 'hang') {
      return new Promise<OtpSendReceipt>((resolve, reject) => {
        this.hang = { resolve, reject };
      });
    }
    return { requestId: 'receipt-test', ttlSeconds: 299 };
  }

  rejectHang(error: Error): void {
    this.hang?.reject(error);
    this.hang = null;
  }

  resolveHang(receipt: OtpSendReceipt): void {
    this.hang?.resolve(receipt);
    this.hang = null;
  }

  async verify(_phone: string, otpCode: string): Promise<boolean> {
    this.verifyCalls += 1;
    if (this.duringVerify) {
      await this.duringVerify();
    }
    if (this.mode === 'timeout') {
      throw new InfrastructureError('Outbound request timed out');
    }
    if (this.mode === 'always') {
      return true;
    }
    return otpCode === this.acceptedCode;
  }
}

describeIfDisposable('phone signup challenge on a disposable database', () => {
  jest.setTimeout(120_000);
  const otp = new FakeOtpy();
  let app: INestApplication;
  let disabled: INestApplication;
  let prisma: PrismaService;
  let consume: ConsumeSignupProofUseCase;

  beforeAll(async () => {
    if (!disposable) return;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpyProvider)
      .useValue(otp)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    consume = app.get(ConsumeSignupProofUseCase);
    const target = new URL(databaseUrl as string);
    if (
      (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') ||
      target.port === '5432' ||
      databaseName === 'salon' ||
      databaseName === 'salon_preview'
    ) {
      throw new Error('Phone signup tests refused a non-disposable database target');
    }
    const rows = await prisma.client.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    const connected = rows[0];
    if (
      !connected ||
      connected.current_database !== databaseName ||
      connected.current_database === 'salon' ||
      connected.current_database === 'salon_preview'
    ) {
      throw new Error('Phone signup tests refused a database other than the disposable target');
    }
    await prisma.client.signupPhoneVerifyAttempt.deleteMany();
    await prisma.client.signupPhoneChallenge.deleteMany();
    await prisma.client.platformMessageStopEvent.deleteMany();
    await prisma.client.platformMessageStop.deleteMany();

    const config = app.get(AppConfigService);
    const disabledRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfigService)
      .useValue({ values: { ...config.values, PHONE_SIGNUP_ENABLED: false } })
      .overrideProvider(OtpyProvider)
      .useValue(otp)
      .compile();
    disabled = disabledRef.createNestApplication();
    disabled.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    disabled.useGlobalFilters(new HttpExceptionFilter());
    await disabled.init();
  });

  afterAll(async () => {
    if (disabled) await disabled.close();
    if (app) await app.close();
  });

  beforeEach(() => {
    otp.sends = [];
    otp.verifyCalls = 0;
    otp.mode = 'match';
    otp.acceptedCode = '222222';
    otp.duringVerify = null;
    // The route limit is 30/minute in one process. Reset the counter between
    // cases so the disposable suite can cover every phone without tripping it.
    const storage = app?.get(ThrottlerStorage) as
      | { storage: Map<string, { totalHits: Map<string, number>; isBlocked: boolean }> }
      | undefined;
    if (!storage) {
      return;
    }
    for (const record of storage.storage.values()) {
      record.isBlocked = false;
      for (const name of record.totalHits.keys()) {
        record.totalHits.set(name, 0);
      }
    }
  });

  function key(): string {
    return `signup-${randomUUID()}`;
  }

  function start(phone: string, idempotencyKey = key()) {
    return request(app.getHttpServer())
      .post('/auth/signup/phone/start')
      .set('Idempotency-Key', idempotencyKey)
      .send({ phone });
  }

  function verify(phone: string, otpCode: string, idempotencyKey = key()) {
    return request(app.getHttpServer())
      .post('/auth/signup/phone/verify')
      .set('Idempotency-Key', idempotencyKey)
      .send({ phone, otpCode });
  }

  async function age(phoneHashHint: string, seconds: number): Promise<void> {
    const createdAt = new Date(Date.now() - seconds * 1000);
    await prisma.client.signupPhoneChallenge.updateMany({
      where: { phoneHash: phoneHashHint },
      data: { createdAt },
    });
  }

  it('stays hidden when the flag is off, including invalid bodies', async () => {
    await request(disabled.getHttpServer())
      .post('/auth/signup/phone/start')
      .set('Idempotency-Key', key())
      .send({})
      .expect(404);
    await request(disabled.getHttpServer())
      .post('/auth/signup/phone/verify')
      .send({ phone: '09121110001', otpCode: '222222' })
      .expect(404);
    expect(otp.sends).toHaveLength(0);
  });

  it('starts, replays, and canonicalizes without creating a tenant or user', async () => {
    const usersBefore = await prisma.client.user.count();
    const salonsBefore = await prisma.client.salon.count();
    const idempotencyKey = key();
    const first = await start('+98 912 111 0002', idempotencyKey).expect(201);
    expect(first.body.outcome).toBe('pending');
    expect(first.body.expiresInSeconds).toBeLessThanOrEqual(180);
    expect(first.body.expiresInSeconds).toBeGreaterThan(0);
    expect(first.body).not.toHaveProperty('signupProof');
    const replay = await start('09121110002', idempotencyKey).expect(201);
    expect(replay.body.outcome).toBe('pending');
    expect(otp.sends).toEqual(['09121110002']);
    expect(await prisma.client.user.count()).toBe(usersBefore);
    expect(await prisma.client.salon.count()).toBe(salonsBefore);

    const columns = await prisma.client.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name IN ('signup_phone_challenges', 'signup_phone_verify_attempts')
    `;
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain('phone');
    expect(names).not.toContain('phone_number');
    expect(names).not.toContain('otp_code');
    expect(names).not.toContain('signup_proof');
  });

  it('rejects a second start during cooldown and a different phone on the same key', async () => {
    const phone = '09121110003';
    const idempotencyKey = key();
    await start(phone, idempotencyKey).expect(201);
    const cooled = await start(phone, key());
    expect(cooled.status).toBe(429);
    expect(cooled.body.error).toBe('SIGNUP_RESEND_COOLDOWN');
    expect(otp.sends).toHaveLength(1);
    const conflict = await start('09121110004', idempotencyKey);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('CONFLICT');
    expect(otp.sends).toHaveLength(1);
  });

  it('invalidates the earlier challenge on resend and enforces the send limit', async () => {
    const phone = '09121110005';
    const first = await start(phone).expect(201);
    expect(first.body.expiresInSeconds).toBeLessThanOrEqual(180);
    const row = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { status: SignupPhoneChallengeStatus.SENT },
      orderBy: { createdAt: 'desc' },
    });
    await age(row.phoneHash, 61);
    const second = await start(phone).expect(201);
    expect(second.body.outcome).toBe('pending');
    const challenges = await prisma.client.signupPhoneChallenge.findMany({
      where: { phoneHash: row.phoneHash },
      orderBy: { createdAt: 'asc' },
    });
    expect(challenges.map((item) => item.status)).toEqual([
      SignupPhoneChallengeStatus.INVALIDATED,
      SignupPhoneChallengeStatus.SENT,
    ]);
    await age(row.phoneHash, 61);
    await start(phone).expect(201);
    await age(row.phoneHash, 61);
    const limited = await start(phone);
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('SIGNUP_SEND_LIMIT');
    expect(otp.sends).toHaveLength(3);
  });

  it('uses one failure response for a wrong code and for an expired challenge', async () => {
    const wrongPhone = '09121110006';
    await start(wrongPhone).expect(201);
    const wrong = await verify(wrongPhone, '111111');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('SIGNUP_VERIFICATION_FAILED');
    expect(wrong.body.message).toBe('The code could not be verified.');

    const expiredPhone = '09121110007';
    await start(expiredPhone).expect(201);
    const callsBefore = otp.verifyCalls;
    const expiredRow = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { status: SignupPhoneChallengeStatus.SENT },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.client.signupPhoneChallenge.update({
      where: { id: expiredRow.id },
      data: {
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expired = await verify(expiredPhone, '222222');
    expect(expired.status).toBe(400);
    expect(expired.body.error).toBe(wrong.body.error);
    expect(expired.body.message).toBe(wrong.body.message);
    expect(otp.verifyCalls).toBe(callsBefore);
  });

  it('issues one proof, does not issue it again, and consumes it once', async () => {
    const phone = '09121110008';
    const usersBefore = await prisma.client.user.count();
    await start(phone).expect(201);
    otp.mode = 'always';
    const verifyKey = key();
    const ok = await verify(phone, '222222', verifyKey).expect(201);
    expect(typeof ok.body.signupProof).toBe('string');
    expect(ok.body.expiresInSeconds).toBe(600);
    const again = await verify(phone, '222222', verifyKey);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('SIGNUP_PROOF_ALREADY_ISSUED');
    expect(again.body).not.toHaveProperty('signupProof');
    const secondProof = await verify(phone, '222222');
    expect(secondProof.status).toBe(400);
    expect(secondProof.body.error).toBe('SIGNUP_VERIFICATION_FAILED');
    expect(otp.verifyCalls).toBe(1);
    const proofs = await prisma.client.signupPhoneChallenge.count({
      where: { status: SignupPhoneChallengeStatus.VERIFIED, proofHash: { not: null } },
    });
    expect(proofs).toBeGreaterThanOrEqual(1);
    const stored = JSON.stringify(
      await prisma.client.signupPhoneChallenge.findMany({
        where: { proofHash: { not: null } },
      }),
    );
    expect(stored).not.toContain(ok.body.signupProof as string);

    const proof = ok.body.signupProof as string;
    await expect(consume.execute(proof, '09121110999')).rejects.toMatchObject({
      code: 'SIGNUP_VERIFICATION_FAILED',
    });
    const stillOpen = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { status: SignupPhoneChallengeStatus.VERIFIED, proofConsumedAt: null },
      orderBy: { verifiedAt: 'desc' },
    });
    expect(stillOpen.proofClosedAt).toBeNull();
    const consumed = await consume.execute(proof, phone);
    expect(consumed.challengeId).toBe(stillOpen.id);
    await expect(consume.execute(proof, `+98${phone.slice(1)}`)).rejects.toMatchObject({
      code: 'SIGNUP_VERIFICATION_FAILED',
    });
    expect(await prisma.client.user.count()).toBe(usersBefore);
    expect(await prisma.client.salon.count()).toBeGreaterThanOrEqual(0);
  });

  it('does not issue a proof when the challenge expires while verification is in flight', async () => {
    const phone = '09121110016';
    await start(phone).expect(201);
    const row = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { status: SignupPhoneChallengeStatus.SENT },
      orderBy: { createdAt: 'desc' },
    });
    otp.mode = 'always';
    otp.duringVerify = async () => {
      await prisma.client.signupPhoneChallenge.update({
        where: { id: row.id },
        data: {
          createdAt: new Date(Date.now() - 120_000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
    };
    const late = await verify(phone, '222222');
    expect(late.status).toBe(400);
    expect(late.body.error).toBe('SIGNUP_VERIFICATION_FAILED');
    expect(late.body).not.toHaveProperty('signupProof');
    expect(otp.verifyCalls).toBe(1);
    const saved = await prisma.client.signupPhoneChallenge.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(saved.status).not.toBe(SignupPhoneChallengeStatus.VERIFIED);
    expect(saved.proofHash).toBeNull();
    const attempt = await prisma.client.signupPhoneVerifyAttempt.findFirstOrThrow({
      where: { challengeId: row.id },
    });
    expect(attempt.state).not.toBe('SUCCEEDED');
  });

  it('commits expiry when the provider receipt arrives after the local deadline', async () => {
    const phone = '09121110017';
    const idempotencyKey = key();
    otp.mode = 'hang';
    const pending = new Promise<request.Response>((resolve, reject) => {
      start(phone, idempotencyKey).end((error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      });
    });
    await waitFor(async () =>
      (await prisma.client.signupPhoneChallenge.count({
        where: { idempotencyKey, status: SignupPhoneChallengeStatus.DISPATCHING },
      })) === 1,
    );
    const row = await prisma.client.signupPhoneChallenge.findUniqueOrThrow({
      where: { idempotencyKey },
    });
    await prisma.client.signupPhoneChallenge.update({
      where: { id: row.id },
      data: {
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    otp.resolveHang({ requestId: 'receipt-late', ttlSeconds: 299 });
    const late = await pending;
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('SIGNUP_CHALLENGE_EXPIRED');
    const saved = await prisma.client.signupPhoneChallenge.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(saved.status).toBe(SignupPhoneChallengeStatus.EXPIRED);
    const audit = await prisma.client.auditLog.findFirst({
      where: {
        resource: 'signup_phone_challenge',
        resourceId: row.id,
        action: 'SIGNUP_PHONE_CHALLENGE_EXPIRED',
      },
    });
    expect(audit).not.toBeNull();
    const replay = await start(phone, idempotencyKey);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe('SIGNUP_CHALLENGE_EXPIRED');
    const afterReplay = await prisma.client.signupPhoneChallenge.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(afterReplay.status).toBe(SignupPhoneChallengeStatus.EXPIRED);
  });

  it('does not call OTPy when the challenge expires while verification waits on the phone lock', async () => {
    const phone = '09121110018';
    await start(phone).expect(201);
    const row = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { status: SignupPhoneChallengeStatus.SENT },
      orderBy: { createdAt: 'desc' },
    });
    const held = holdPhoneLock(prisma, row.phoneHash);
    let pending: Promise<request.Response> | undefined;
    try {
      await held.acquired;
      const calls = otp.verifyCalls;
      pending = responseOf(verify(phone, '222222'));
      await waitForAdvisoryWaiter(prisma);
      await moveDeadline(prisma, row.id, 'expires_at');
      await sleep(1_200);
      await held.release();
      const late = await pending;
      pending = undefined;
      expect(late.status).toBe(400);
      expect(late.body.error).toBe('SIGNUP_VERIFICATION_FAILED');
      expect(otp.verifyCalls).toBe(calls);
      const saved = await prisma.client.signupPhoneChallenge.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(saved.status).toBe(SignupPhoneChallengeStatus.EXPIRED);
      expect(
        await prisma.client.signupPhoneVerifyAttempt.count({ where: { challengeId: row.id } }),
      ).toBe(0);
    } finally {
      await held.release();
      await pending?.catch(() => undefined);
    }
  });

  it('does not issue a proof when verification waits on the phone lock past the deadline', async () => {
    const phone = '09121110019';
    await start(phone).expect(201);
    const row = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { status: SignupPhoneChallengeStatus.SENT },
      orderBy: { createdAt: 'desc' },
    });
    let held: PhoneLock | undefined;
    otp.mode = 'always';
    otp.duringVerify = async () => {
      held = holdPhoneLock(prisma, row.phoneHash);
      await held.acquired;
    };
    let pending: Promise<request.Response> | undefined;
    try {
      pending = responseOf(verify(phone, '222222'));
      await waitForAdvisoryWaiter(prisma);
      await moveDeadline(prisma, row.id, 'expires_at');
      await sleep(1_200);
      await held?.release();
      const late = await pending;
      pending = undefined;
      expect(late.status).toBe(400);
      expect(late.body.error).toBe('SIGNUP_VERIFICATION_FAILED');
      expect(late.body).not.toHaveProperty('signupProof');
      expect(otp.verifyCalls).toBe(1);
      const saved = await prisma.client.signupPhoneChallenge.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(saved.status).not.toBe(SignupPhoneChallengeStatus.VERIFIED);
      expect(saved.proofHash).toBeNull();
      const attempt = await prisma.client.signupPhoneVerifyAttempt.findFirstOrThrow({
        where: { challengeId: row.id },
      });
      expect(attempt.state).not.toBe('SUCCEEDED');
    } finally {
      await held?.release();
      await pending?.catch(() => undefined);
    }
  });

  it('does not consume a proof that expires while the consume statement waits on the phone lock', async () => {
    const phone = '09121110020';
    await start(phone).expect(201);
    otp.mode = 'always';
    const verified = await verify(phone, '222222').expect(201);
    const proof = verified.body.signupProof as string;
    const row = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { status: SignupPhoneChallengeStatus.VERIFIED, proofConsumedAt: null },
      orderBy: { verifiedAt: 'desc' },
    });
    const held = holdPhoneLock(prisma, row.phoneHash);
    let pending: Promise<{ challengeId: string }> | undefined;
    try {
      await held.acquired;
      pending = consume.execute(proof, phone);
      await waitForAdvisoryWaiter(prisma);
      await moveDeadline(prisma, row.id, 'proof_expires_at');
      await sleep(1_200);
      await held.release();
      await expect(pending).rejects.toMatchObject({ code: 'SIGNUP_VERIFICATION_FAILED' });
      pending = undefined;
      const saved = await prisma.client.signupPhoneChallenge.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(saved.proofConsumedAt).toBeNull();
      expect(saved.proofClosedAt).toBeNull();
    } finally {
      await held.release();
      await pending?.catch(() => undefined);
    }
  });

  it('commits expiry when send confirmation waits on the phone lock past the deadline', async () => {
    const phone = '09121110021';
    const idempotencyKey = key();
    otp.mode = 'hang';
    const pending = responseOf(start(phone, idempotencyKey));
    await waitFor(async () =>
      (await prisma.client.signupPhoneChallenge.count({
        where: { idempotencyKey, status: SignupPhoneChallengeStatus.DISPATCHING },
      })) === 1,
    );
    const row = await prisma.client.signupPhoneChallenge.findUniqueOrThrow({
      where: { idempotencyKey },
    });
    const held = holdPhoneLock(prisma, row.phoneHash);
    try {
      await held.acquired;
      otp.resolveHang({ requestId: 'receipt-lock', ttlSeconds: 299 });
      await waitForAdvisoryWaiter(prisma);
      await moveDeadline(prisma, row.id, 'expires_at');
      await sleep(1_200);
      await held.release();
      const late = await pending;
      expect(late.status).toBe(409);
      expect(late.body.error).toBe('SIGNUP_CHALLENGE_EXPIRED');
      const saved = await prisma.client.signupPhoneChallenge.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(saved.status).toBe(SignupPhoneChallengeStatus.EXPIRED);
      const audit = await prisma.client.auditLog.findFirst({
        where: {
          resource: 'signup_phone_challenge',
          resourceId: row.id,
          action: 'SIGNUP_PHONE_CHALLENGE_EXPIRED',
        },
      });
      expect(audit).not.toBeNull();
      const replay = await start(phone, idempotencyKey);
      expect(replay.status).toBe(409);
      expect(replay.body.error).toBe('SIGNUP_CHALLENGE_EXPIRED');
    } finally {
      await held.release();
      await pending.catch(() => undefined);
    }
  });

  it('does not send again after a timeout, a provider failure, or a crash before confirmation', async () => {
    const timeoutPhone = '09121110009';
    otp.mode = 'timeout';
    const timeoutKey = key();
    const timedOut = await start(timeoutPhone, timeoutKey);
    expect(timedOut.status).toBe(409);
    expect(timedOut.body.error).toBe('SIGNUP_SEND_UNCONFIRMED');
    const timeoutRetry = await start(timeoutPhone, timeoutKey);
    expect(timeoutRetry.status).toBe(409);
    expect(timeoutRetry.body.error).toBe('SIGNUP_SEND_UNCONFIRMED');
    expect(otp.sends).toHaveLength(1);
    const ambiguous = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { idempotencyKey: timeoutKey },
    });
    expect(ambiguous.status).toBe(SignupPhoneChallengeStatus.AMBIGUOUS);

    otp.mode = 'failure';
    const failedKey = key();
    const failed = await start('09121110010', failedKey);
    expect(failed.body.error).toBe('SIGNUP_SEND_UNCONFIRMED');
    await start('09121110010', failedKey);
    expect(otp.sends).toHaveLength(2);

    otp.mode = 'hang';
    const hangKey = key();
    const sendsBeforeHang = otp.sends.length;
    const hanging = new Promise<request.Response>((resolve, reject) => {
      start('09121110011', hangKey).end((error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      });
    });
    await waitFor(async () => otp.sends.length === sendsBeforeHang + 1);
    const crashed = await start('09121110011', hangKey);
    expect(crashed.body.error).toBe('SIGNUP_SEND_UNCONFIRMED');
    expect(otp.sends).toHaveLength(sendsBeforeHang + 1);
    otp.rejectHang(new InfrastructureError('Outbound request timed out'));
    const finished = await hanging;
    expect(finished.body.error).toBe('SIGNUP_SEND_UNCONFIRMED');
    expect(otp.sends).toHaveLength(sendsBeforeHang + 1);
  });

  it('serializes concurrent starts and allows only one proof under concurrent verifies', async () => {
    const phone = '09121110012';
    otp.mode = 'match';
    const [first, second] = await Promise.all([start(phone), start(phone)]);
    expect([first, second].filter((response) => response.status === 201)).toHaveLength(1);
    expect(otp.sends).toHaveLength(1);
    const blocked = [first, second].find((response) => response.status !== 201);
    expect(['SIGNUP_SEND_UNCONFIRMED', 'SIGNUP_RESEND_COOLDOWN']).toContain(blocked?.body.error);
    const started = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });

    otp.mode = 'always';
    const [verified, duplicate] = await Promise.all([
      verify(phone, '222222'),
      verify(phone, '333333'),
    ]);
    const verifyStatuses = [verified.status, duplicate.status].sort();
    expect(verifyStatuses).toEqual([201, 400]);
    const proofResponse = [verified, duplicate].find((response) => response.status === 201);
    expect(proofResponse?.body.signupProof).toEqual(expect.any(String));
    const openProofs = await prisma.client.signupPhoneChallenge.count({
      where: {
        phoneHash: started.phoneHash,
        status: SignupPhoneChallengeStatus.VERIFIED,
        proofClosedAt: null,
      },
    });
    expect(openProofs).toBe(1);
  });

  it('stops calling the provider after the verification attempt limit', async () => {
    const phone = '09121110013';
    await start(phone).expect(201);
    otp.mode = 'match';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await verify(phone, '111111');
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('SIGNUP_VERIFICATION_FAILED');
    }
    const calls = otp.verifyCalls;
    const blocked = await verify(phone, '222222');
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe('SIGNUP_VERIFICATION_FAILED');
    expect(otp.verifyCalls).toBe(calls);
  });

  it('rejects a second open challenge for the same phone hash', async () => {
    const phoneHash = 'ab'.repeat(32);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    await prisma.client.signupPhoneChallenge.create({
      data: {
        id: randomUUID(),
        phoneHash,
        status: SignupPhoneChallengeStatus.DISPATCHING,
        idempotencyKey: key(),
        requestHash: 'cd'.repeat(32),
        expiresAt,
        updatedAt: now,
      },
    });
    await expect(
      prisma.client.signupPhoneChallenge.create({
        data: {
          id: randomUUID(),
          phoneHash,
          status: SignupPhoneChallengeStatus.SENT,
          idempotencyKey: key(),
          requestHash: 'ef'.repeat(32),
          providerRequestId: 'provider-request',
          expiresAt,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow();
  });

  it('still sends when a marketing stop exists for the same phone', async () => {
    const phone = '09121110014';
    const adminId = randomUUID();
    const now = new Date();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email: `phone-signup-${randomUUID()}@example.test`,
        name: 'operator',
        passwordHash: 'not-a-password-hash',
        updatedAt: now,
      },
    });
    await prisma.client.platformMessageStop.create({
      data: {
        id: randomUUID(),
        phoneNumber: phone,
        active: true,
        reasonCode: 'RECIPIENT_REQUEST',
        registeredByAdminId: adminId,
        registeredAt: now,
        updatedAt: now,
      },
    });
    await start(phone).expect(201);
    expect(otp.sends).toEqual([phone]);
  });

  it('keeps email registration closed in phone-only mode when OTP signup is disabled', async () => {
    const email = `owner-${randomUUID()}@example.test`;
    const password = 'salon-owner-password';
    const before = await prisma.client.user.count({ where: { email } });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: 'Phone signup neighbor',
        ownerName: 'Owner',
        email,
        password,
      })
      .expect(404);
    expect(await prisma.client.user.count({ where: { email } })).toBe(before);

    await request(disabled.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: 'Phone signup neighbor',
        ownerName: 'Owner',
        email,
        password,
      })
      .expect(404);
    expect(await prisma.client.user.count({ where: { email } })).toBe(before);
    expect(app.get(AppConfigService).values.PUBLIC_REGISTRATION_MODE).toBe('phone');
  });

  it('keeps phones, codes, proofs, and the hash secret out of stored rows and audit metadata', async () => {
    const phone = '09121110015';
    const code = '222222';
    await start(phone).expect(201);
    otp.mode = 'always';
    const verified = await verify(phone, code).expect(201);
    const proof = verified.body.signupProof as string;
    const blob = JSON.stringify({
      challenges: await prisma.client.signupPhoneChallenge.findMany(),
      attempts: await prisma.client.signupPhoneVerifyAttempt.findMany(),
      audits: await prisma.client.auditLog.findMany({
        where: { resource: 'signup_phone_challenge' },
      }),
    });
    expect(blob).not.toContain(phone);
    expect(blob).not.toContain(code);
    expect(blob).not.toContain(proof);
    expect(blob).not.toContain(process.env.PHONE_SIGNUP_HASH_SECRET ?? 'missing-secret');
  });
});

type PhoneLock = {
  acquired: Promise<void>;
  release: () => Promise<void>;
};

function holdPhoneLock(
  prisma: PrismaService,
  phoneHash: string,
): PhoneLock {
  let resolveAcquired: () => void = () => undefined;
  const acquired = new Promise<void>((resolve) => {
    resolveAcquired = resolve;
  });
  let releaseWait: () => void = () => undefined;
  const releaseSignal = new Promise<void>((resolve) => {
    releaseWait = resolve;
  });
  let settled = false;
  const done = prisma.client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phoneHash})::bigint)`;
      resolveAcquired();
      await releaseSignal;
    },
    { timeout: 20_000, maxWait: 5_000 },
  );
  return {
    acquired,
    release: async () => {
      if (settled) {
        return;
      }
      settled = true;
      releaseWait();
      await done;
    },
  };
}

function responseOf(builder: request.Test): Promise<request.Response> {
  return new Promise((resolve, reject) => {
    builder.end((error, response) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

async function waitForAdvisoryWaiter(prisma: PrismaService): Promise<void> {
  await waitFor(async () => {
    const rows = await prisma.client.$queryRaw<Array<{ waiting: number | bigint }>>`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND wait_event = 'advisory'
    `;
    return Number(rows[0]?.waiting ?? 0) > 0;
  });
}

async function moveDeadline(
  prisma: PrismaService,
  id: string,
  column: 'expires_at' | 'proof_expires_at',
): Promise<void> {
  if (column === 'expires_at') {
    await prisma.client.$executeRaw`
      UPDATE signup_phone_challenges
      SET expires_at = clock_timestamp() + interval '300 milliseconds',
          updated_at = clock_timestamp()
      WHERE id = ${id}::uuid
    `;
    return;
  }
  await prisma.client.$executeRaw`
    UPDATE signup_phone_challenges
    SET proof_expires_at = clock_timestamp() + interval '300 milliseconds',
        updated_at = clock_timestamp()
    WHERE id = ${id}::uuid
  `;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the signup challenge state');
}

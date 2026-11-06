import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PasswordRecoveryChallengeStatus } from '@salon/database';
import { InfrastructureError } from '@salon/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpyProvider, type OtpSendReceipt } from '../src/auth/otp-provider';
import { recoveryPhoneHash } from '../src/auth/password-recovery';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import {
  createPlatformAdminSession,
  createProductOwnerSession,
} from './support/phone-account';

const databaseUrl = process.env.PASSWORD_RECOVERY_DISPOSABLE_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, '') : '';
const disposable =
  Boolean(databaseUrl) &&
  process.env.DATABASE_URL === databaseUrl &&
  databaseName.startsWith('salon_password_recovery_') &&
  databaseName !== 'salon' &&
  databaseName !== 'salon_preview' &&
  databaseName !== 'salon-db' &&
  databaseName !== 'phone_first_product';

const describeIfDisposable = disposable ? describe : describe.skip;

class FakeOtpy {
  sends: string[] = [];
  verifyCalls = 0;
  mode: 'match' | 'always' | 'timeout' | 'failure' = 'match';
  acceptedCode = '222222';
  ttlSeconds = 299;

  async send(phone: string): Promise<OtpSendReceipt> {
    this.sends.push(phone);
    if (this.mode === 'timeout') {
      throw new InfrastructureError('Outbound request timed out');
    }
    if (this.mode === 'failure') {
      throw new InfrastructureError();
    }
    return { requestId: 'receipt-test', ttlSeconds: this.ttlSeconds };
  }

  async verify(_phone: string, otpCode: string): Promise<boolean> {
    this.verifyCalls += 1;
    if (this.mode === 'timeout') {
      throw new InfrastructureError('Outbound request timed out');
    }
    if (this.mode === 'always') {
      return true;
    }
    return otpCode === this.acceptedCode;
  }
}

describeIfDisposable('password recovery on a disposable database', () => {
  jest.setTimeout(120_000);
  const otp = new FakeOtpy();
  let app: INestApplication;
  let hidden: INestApplication;
  let prisma: PrismaService;
  let secret: string;

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
    const config = app.get(AppConfigService);
    secret = config.values.PASSWORD_RECOVERY_HASH_SECRET as string;
    if (!secret) {
      throw new Error('Password recovery tests require PASSWORD_RECOVERY_HASH_SECRET');
    }
    const target = new URL(databaseUrl as string);
    if (
      (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') ||
      target.port === '5432' ||
      databaseName === 'salon' ||
      databaseName === 'salon_preview'
    ) {
      throw new Error('Password recovery tests refused a non-disposable database target');
    }
    const rows = await prisma.client.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    if (rows[0]?.current_database !== databaseName) {
      throw new Error('Password recovery tests refused a database other than the disposable target');
    }

    const hiddenRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfigService)
      .useValue({ values: { ...config.values, PASSWORD_RECOVERY_HASH_SECRET: undefined } })
      .overrideProvider(OtpyProvider)
      .useValue(otp)
      .compile();
    hidden = hiddenRef.createNestApplication();
    hidden.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    hidden.useGlobalFilters(new HttpExceptionFilter());
    await hidden.init();
  });

  afterAll(async () => {
    if (hidden) await hidden.close();
    if (app) await app.close();
  });

  beforeEach(() => {
    otp.sends = [];
    otp.verifyCalls = 0;
    otp.mode = 'match';
    otp.acceptedCode = '222222';
    otp.ttlSeconds = 299;
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
    return `recovery-${randomUUID()}`;
  }

  function start(phone: string, idempotencyKey = key()) {
    return request(app.getHttpServer())
      .post('/auth/password-recovery/start')
      .set('Idempotency-Key', idempotencyKey)
      .send({ phone });
  }

  function verify(phone: string, otpCode: string, idempotencyKey = key()) {
    return request(app.getHttpServer())
      .post('/auth/password-recovery/verify')
      .set('Idempotency-Key', idempotencyKey)
      .send({ phone, otpCode });
  }

  function complete(
    body: {
      phone: string;
      recoveryProof: string;
      password: string;
      passwordConfirmation: string;
    },
    idempotencyKey = key(),
  ) {
    return request(app.getHttpServer())
      .post('/auth/password-recovery/complete')
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
  }

  it('stays hidden when the recovery secret is unset', async () => {
    const availability = await request(hidden.getHttpServer())
      .get('/auth/password-recovery/availability')
      .expect(200);
    expect(availability.body).toEqual({ available: false });
    await request(hidden.getHttpServer())
      .post('/auth/password-recovery/start')
      .set('Idempotency-Key', key())
      .send({ phone: '09121110001' })
      .expect(404);
    expect(otp.sends).toHaveLength(0);
  });

  it('reports recovery as available without naming accounts', async () => {
    const availability = await request(app.getHttpServer())
      .get('/auth/password-recovery/availability')
      .expect(200);
    expect(availability.body).toEqual({ available: true });
  });

  it('resets a salon password, refuses replay of the proof, and invalidates the old session', async () => {
    const account = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      password: 'old-password-value',
    });
    const meBefore = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    expect(meBefore.body.userId).toBe(account.userId);

    const startKey = key();
    const started = await start(account.phone, startKey).expect(201);
    expect(started.body.outcome).toBe('pending');
    expect(started.body).not.toHaveProperty('recoveryProof');
    const replayStart = await start(account.phone, startKey).expect(201);
    expect(replayStart.body.outcome).toBe('pending');
    expect(otp.sends).toEqual([account.phone]);

    otp.mode = 'always';
    const verified = await verify(account.phone, '222222').expect(201);
    expect(typeof verified.body.recoveryProof).toBe('string');
    const proof = verified.body.recoveryProof as string;
    const stored = JSON.stringify(await prisma.client.passwordRecoveryChallenge.findMany());
    expect(stored).not.toContain(proof);
    expect(stored).not.toContain(account.phone);

    const completeKey = key();
    const reset = await complete(
      {
        phone: account.phone,
        recoveryProof: proof,
        password: 'new-password-value',
        passwordConfirmation: 'new-password-value',
      },
      completeKey,
    ).expect(201);
    expect(reset.body).toEqual({ outcome: 'reset' });
    expect(reset.body).not.toHaveProperty('accessToken');

    const replayComplete = await complete(
      {
        phone: account.phone,
        recoveryProof: proof,
        password: 'new-password-value',
        passwordConfirmation: 'new-password-value',
      },
      completeKey,
    ).expect(201);
    expect(replayComplete.body).toEqual({ outcome: 'reset' });

    const reusedProof = await complete({
      phone: account.phone,
      recoveryProof: proof,
      password: 'newer-password-value',
      passwordConfirmation: 'newer-password-value',
    });
    expect(reusedProof.status).toBe(400);
    expect(reusedProof.body.error).toBe('PASSWORD_RECOVERY_VERIFICATION_FAILED');

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone: account.phone, password: 'old-password-value' })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone: account.phone, password: 'new-password-value' })
      .expect(201);
    expect(login.body.accessToken).toBeDefined();
    expect(login.body.accessToken).not.toBe(account.accessToken);
  });

  it('resets a platform-admin password and invalidates that session', async () => {
    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), {
      password: 'old-admin-password',
    });
    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    await start(admin.phone).expect(201);
    otp.mode = 'always';
    const verified = await verify(admin.phone, '222222').expect(201);
    await complete({
      phone: admin.phone,
      recoveryProof: verified.body.recoveryProof as string,
      password: 'new-admin-password',
      passwordConfirmation: 'new-admin-password',
    }).expect(201);

    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone: admin.phone, password: 'new-admin-password' })
      .expect(201);
  });

  it('invalidates an onboarding token and refuses product-session exchange after reset', async () => {
    const account = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      password: 'old-onboarding-password',
      accessState: 'AWAITING_AGREEMENT',
    });
    expect(account.body.sessionScope).toBe('onboarding');
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    await start(account.phone).expect(201);
    otp.mode = 'always';
    const verified = await verify(account.phone, '222222').expect(201);
    await complete({
      phone: account.phone,
      recoveryProof: verified.body.recoveryProof as string,
      password: 'new-onboarding-password',
      passwordConfirmation: 'new-onboarding-password',
    }).expect(201);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/session/product')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(401);
  });

  it('lets concurrent completions consume the proof only once', async () => {
    const account = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      password: 'old-race-password',
    });
    await start(account.phone).expect(201);
    otp.mode = 'always';
    const verified = await verify(account.phone, '222222').expect(201);
    const proof = verified.body.recoveryProof as string;
    const first = complete(
      {
        phone: account.phone,
        recoveryProof: proof,
        password: 'first-race-password',
        passwordConfirmation: 'first-race-password',
      },
      key(),
    );
    const second = complete(
      {
        phone: account.phone,
        recoveryProof: proof,
        password: 'second-race-password',
        passwordConfirmation: 'second-race-password',
      },
      key(),
    );
    const results = await Promise.all([first, second]);
    const statuses = results.map((item) => item.status).sort();
    expect(statuses).toEqual([201, 400]);
    const winner = results.find((item) => item.status === 201);
    expect(winner?.body).toEqual({ outcome: 'reset' });
    const user = await prisma.client.user.findUniqueOrThrow({
      where: { id: account.userId },
      select: { credentialsVersion: true },
    });
    expect(user.credentialsVersion).toBe(1);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(401);
  });

  it('does not reveal whether a phone has an account', async () => {
    const unknown = '09129990001';
    const known = await createProductOwnerSession(prisma.client, app.getHttpServer());
    const unknownStart = await start(unknown).expect(201);
    const knownStart = await start(known.phone).expect(201);
    expect(unknownStart.body.outcome).toBe('pending');
    expect(knownStart.body.outcome).toBe('pending');
    expect(Object.keys(unknownStart.body).sort()).toEqual(Object.keys(knownStart.body).sort());

    const unknownWrong = await verify(unknown, '111111');
    const knownWrong = await verify(known.phone, '111111');
    expect(unknownWrong.status).toBe(400);
    expect(knownWrong.status).toBe(400);
    expect(unknownWrong.body.error).toBe('PASSWORD_RECOVERY_VERIFICATION_FAILED');
    expect(knownWrong.body.error).toBe('PASSWORD_RECOVERY_VERIFICATION_FAILED');

    otp.mode = 'always';
    const unknownProof = await verify(unknown, '222222').expect(201);
    const completed = await complete({
      phone: unknown,
      recoveryProof: unknownProof.body.recoveryProof as string,
      password: 'new-password-value',
      passwordConfirmation: 'new-password-value',
    }).expect(201);
    expect(completed.body).toEqual({ outcome: 'reset' });
    expect(await prisma.client.user.count({ where: { phone: unknown } })).toBe(0);
    expect(await prisma.client.platformAdmin.count({ where: { phone: unknown } })).toBe(0);
  });

  it('rejects a signup proof and an expired recovery challenge', async () => {
    const account = await createProductOwnerSession(prisma.client, app.getHttpServer());
    await start(account.phone).expect(201);
    const expiredRow = await prisma.client.passwordRecoveryChallenge.findFirstOrThrow({
      where: { status: PasswordRecoveryChallengeStatus.SENT },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.client.passwordRecoveryChallenge.update({
      where: { id: expiredRow.id },
      data: {
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expired = await verify(account.phone, '222222');
    expect(expired.status).toBe(409);
    expect(expired.body.error).toBe('PASSWORD_RECOVERY_CHALLENGE_EXPIRED');

    const forged = await complete({
      phone: account.phone,
      recoveryProof: 'signup-proof-must-not-reset-password-value',
      password: 'new-password-value',
      passwordConfirmation: 'new-password-value',
    });
    expect(forged.status).toBe(400);
    expect(forged.body.error).toBe('PASSWORD_RECOVERY_VERIFICATION_FAILED');
  });

  it('enforces resend cooldown and the send window', async () => {
    const phone = '09129990002';
    await start(phone).expect(201);
    const cooled = await start(phone, key());
    expect(cooled.status).toBe(429);
    expect(cooled.body.error).toBe('PASSWORD_RECOVERY_RESEND_COOLDOWN');

    const row = await prisma.client.passwordRecoveryChallenge.findFirstOrThrow({
      where: { phoneHash: recoveryPhoneHash(secret, phone) },
    });
    await prisma.client.passwordRecoveryChallenge.updateMany({
      where: { phoneHash: row.phoneHash },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await start(phone).expect(201);
    await prisma.client.passwordRecoveryChallenge.updateMany({
      where: { phoneHash: row.phoneHash },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await start(phone).expect(201);
    await prisma.client.passwordRecoveryChallenge.updateMany({
      where: { phoneHash: row.phoneHash },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    const limited = await start(phone);
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('PASSWORD_RECOVERY_SEND_LIMIT');
  });

  it('returns an unconfirmed send when the provider fails', async () => {
    otp.mode = 'failure';
    const failed = await start('09129990003');
    expect(failed.status).toBe(409);
    expect(failed.body.error).toBe('PASSWORD_RECOVERY_SEND_UNCONFIRMED');
  });
});

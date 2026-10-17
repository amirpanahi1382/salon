import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { SignupPhoneChallengeStatus, createPrismaClient } from '@salon/database';
import { createId } from '@salon/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpyProvider, type OtpSendReceipt } from '../src/auth/otp-provider';
import { provisionSalonOwner } from '../src/auth/provision-salon-owner';
import { ConsumeSignupProofUseCase } from '../src/auth/phone-signup.use-cases';
import { signupPhoneHash, signupProofHash } from '../src/auth/signup-phone';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const databaseUrl = process.env.PHONE_SIGNUP_DISPOSABLE_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, '') : '';
const container = process.env.DISPOSABLE_POSTGRES_CONTAINER ?? '';
const disposable =
  Boolean(databaseUrl) &&
  process.env.DATABASE_URL === databaseUrl &&
  databaseName.startsWith('salon_phone_owner_') &&
  databaseName !== 'salon' &&
  databaseName !== 'salon_preview';

const describeIfDisposable = disposable ? describe : describe.skip;

class FakeOtpy {
  sends: string[] = [];
  async send(phone: string): Promise<OtpSendReceipt> {
    this.sends.push(phone);
    return { requestId: 'receipt-test', ttlSeconds: 299 };
  }
  async verify(): Promise<boolean> {
    return true;
  }
}

describeIfDisposable('phone-owned salon account on a disposable database', () => {
  jest.setTimeout(180_000);
  const otp = new FakeOtpy();
  let app: INestApplication;
  let disabled: INestApplication;
  let prisma: PrismaService;
  let consume: ConsumeSignupProofUseCase;

  beforeAll(async () => {
    if (!disposable || !databaseUrl) return;
    const target = new URL(databaseUrl);
    if (
      (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') ||
      databaseName === 'salon' ||
      databaseName === 'salon_preview'
    ) {
      throw new Error('Phone owner tests refused a non-disposable database target');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpyProvider)
      .useValue(otp)
      .compile();
    app = moduleRef.createNestApplication();
    configure(app);
    await app.init();
    prisma = app.get(PrismaService);
    consume = app.get(ConsumeSignupProofUseCase);
    const rows = await prisma.client.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    if (rows[0]?.current_database !== databaseName) {
      throw new Error('Phone owner tests refused a database other than the disposable target');
    }
    if (
      !app.get(AppConfigService).values.PHONE_SIGNUP_ENABLED ||
      app.get(AppConfigService).values.PUBLIC_REGISTRATION_MODE !== 'phone'
    ) {
      throw new Error('Phone owner tests require phone-only registration and PHONE_SIGNUP_ENABLED');
    }

    const config = app.get(AppConfigService);
    const disabledRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfigService)
      .useValue({ values: { ...config.values, PHONE_SIGNUP_ENABLED: false } })
      .overrideProvider(OtpyProvider)
      .useValue(otp)
      .compile();
    disabled = disabledRef.createNestApplication();
    configure(disabled);
    await disabled.init();
  });

  afterAll(async () => {
    if (disabled) await disabled.close();
    if (app) await app.close();
  });

  beforeEach(() => {
    otp.sends = [];
    resetThrottle(app);
    resetThrottle(disabled);
  });

  function key(): string {
    return `owner-${randomUUID()}`;
  }

  function start(phone: string, idempotencyKey = key()) {
    return request(app.getHttpServer())
      .post('/auth/signup/phone/start')
      .set('Idempotency-Key', idempotencyKey)
      .send({ phone });
  }

  function verify(phone: string, idempotencyKey = key()) {
    return request(app.getHttpServer())
      .post('/auth/signup/phone/verify')
      .set('Idempotency-Key', idempotencyKey)
      .send({ phone, otpCode: '222222' });
  }

  async function proofFor(phone: string): Promise<string> {
    await start(phone).expect(201);
    const verified = await verify(phone).expect(201);
    return verified.body.signupProof as string;
  }

  function complete(
    phone: string,
    proof: string,
    idempotencyKey: string,
    body: { salonName?: string; ownerName?: string; password?: string } = {},
  ) {
    return request(app.getHttpServer())
      .post('/auth/signup/phone/complete')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        phone,
        signupProof: proof,
        salonName: body.salonName ?? 'Niloofar',
        ownerName: body.ownerName ?? 'Niloofar Owner',
        password: body.password ?? 'phone-owner-password',
      });
  }

  function phoneLogin(phone: string, password: string, server = app.getHttpServer()) {
    return request(server).post('/auth/login/phone').send({ phone, password });
  }

  async function counts() {
    return {
      users: await prisma.client.user.count(),
      salons: await prisma.client.salon.count(),
      audits: await prisma.client.auditLog.count(),
      outbox: await prisma.client.outboxEvent.count(),
      challenges: await prisma.client.signupPhoneChallenge.count(),
    };
  }

  it('creates one awaiting-agreement owner and replays a lost response', async () => {
    const phone = '09126660001';
    const proof = await proofFor(phone);
    const idempotencyKey = key();
    const created = await complete(phone, proof, idempotencyKey).expect(201);
    expect(created.body).toEqual({
      userId: expect.any(String),
      salonId: expect.any(String),
      role: 'OWNER',
      accessState: 'AWAITING_AGREEMENT',
    });
    expect(created.body.accessToken).toBeUndefined();

    const replay = await complete(phone, proof, idempotencyKey).expect(201);
    expect(replay.body).toEqual(created.body);

    const conflict = await complete(phone, proof, idempotencyKey, { salonName: 'Other' }).expect(409);
    expect(conflict.body.error).toBe('CONFLICT');

    const users = await prisma.client.user.findMany({ where: { phone } });
    expect(users).toHaveLength(1);
    expect(users[0]).toEqual(
      expect.objectContaining({
        email: null,
        phone,
        role: 'OWNER',
        status: 'ACTIVE',
      }),
    );
    const salon = await prisma.client.salon.findUniqueOrThrow({ where: { id: created.body.salonId } });
    expect(salon.status).toBe('ACTIVE');
    expect(salon.accessState).toBe('AWAITING_AGREEMENT');
    expect(salon.additionalUsersAllowed).toBe(false);
    const services = await prisma.client.service.findMany({
      where: { salonId: salon.id },
      orderBy: { name: 'asc' },
    });
    expect(services.map((service) => service.name)).toEqual(['Hair Service', 'Nail Service']);
    const events = await prisma.client.outboxEvent.findMany({
      where: { tenantId: salon.id },
      select: { eventType: true },
    });
    expect(events.map((event) => event.eventType).sort()).toEqual(
      ['SalonCreated', 'ServiceCreated', 'ServiceCreated', 'UserCreated'].sort(),
    );

    const blob = JSON.stringify({
      audits: await prisma.client.auditLog.findMany({ where: { tenantId: salon.id } }),
      completions: await prisma.client.phoneOwnerCompletion.findMany({ where: { salonId: salon.id } }),
    });
    expect(blob).not.toContain(phone);
    expect(blob).not.toContain('phone-owner-password');
    expect(blob).not.toContain(proof);
  });

  it('rolls back a consumed proof when account creation does not commit', async () => {
    const phone = '09126660002';
    const proof = await proofFor(phone);
    const secret = app.get(AppConfigService).values.PHONE_SIGNUP_HASH_SECRET as string;
    await expect(
      prisma.client.$transaction(async (tx) => {
        await consume.execute(proof, phone, tx);
        await provisionSalonOwner(tx, {
          salonId: createId(),
          userId: createId(),
          salonName: 'Rollback',
          ownerName: 'Owner',
          passwordHash: 'not-used',
          email: null,
          phone,
          accessState: 'AWAITING_AGREEMENT',
          additionalUsersAllowed: false,
          now: new Date(),
        });
        throw new Error('forced-rollback');
      }),
    ).rejects.toThrow('forced-rollback');

    expect(await prisma.client.user.count({ where: { phone } })).toBe(0);
    const challenge = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { phoneHash: signupPhoneHash(secret, phone), proofHash: signupProofHash(secret, proof) },
    });
    expect(challenge.proofConsumedAt).toBeNull();
    expect(challenge.proofClosedAt).toBeNull();
  });

  it('rejects a proof for a different phone, an expired proof, and a used proof', async () => {
    const phone = '09126660003';
    const other = '09126660004';
    const proof = await proofFor(phone);
    const mismatch = await complete(other, proof, key()).expect(400);
    expect(mismatch.body.error).toBe('SIGNUP_VERIFICATION_FAILED');
    expect(await prisma.client.user.count({ where: { phone: other } })).toBe(0);
    const secret = app.get(AppConfigService).values.PHONE_SIGNUP_HASH_SECRET as string;
    const open = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { proofHash: signupProofHash(secret, proof) },
    });
    expect(open.proofConsumedAt).toBeNull();

    const expiredPhone = '09126660005';
    const expiredProof = await proofFor(expiredPhone);
    await prisma.client.$executeRaw`
      UPDATE signup_phone_challenges
      SET proof_expires_at = clock_timestamp() - interval '1 second'
      WHERE proof_hash = ${signupProofHash(secret, expiredProof)}
    `;
    await complete(expiredPhone, expiredProof, key()).expect(400);
    expect(await prisma.client.user.count({ where: { phone: expiredPhone } })).toBe(0);

    const usedPhone = '09126660006';
    const usedProof = await proofFor(usedPhone);
    await complete(usedPhone, usedProof, key()).expect(201);
    await complete(usedPhone, usedProof, key()).expect(400);
    expect(await prisma.client.user.count({ where: { phone: usedPhone } })).toBe(1);
  });

  it('allows one salon when two completions race for the same proof or phone', async () => {
    const phone = '09126660007';
    const proof = await proofFor(phone);
    const pair = await Promise.all([
      responseOf(complete(phone, proof, key())),
      responseOf(complete(phone, proof, key())),
    ]);
    const created = pair.filter((response) => response.status === 201);
    expect(created).toHaveLength(1);
    expect(pair.filter((response) => response.status !== 201).length).toBe(1);
    expect(await prisma.client.user.count({ where: { phone } })).toBe(1);
    expect(await prisma.client.salon.count({ where: { id: created[0]?.body.salonId } })).toBe(1);

    const sameKey = key();
    const replayPhone = '09126660008';
    const replayProof = await proofFor(replayPhone);
    const concurrent = await Promise.all([
      responseOf(complete(replayPhone, replayProof, sameKey)),
      responseOf(complete(replayPhone, replayProof, sameKey)),
    ]);
    expect(concurrent.every((response) => response.status === 201)).toBe(true);
    expect(concurrent[0]?.body.salonId).toBe(concurrent[1]?.body.salonId);
    expect(await prisma.client.user.count({ where: { phone: replayPhone } })).toBe(1);
  });

  it('rejects a second phone for an owner that already exists and does not consume that proof', async () => {
    const phone = '09126660009';
    const proof = await proofFor(phone);
    await complete(phone, proof, key()).expect(201);
    const secret = app.get(AppConfigService).values.PHONE_SIGNUP_HASH_SECRET as string;
    const secondProof = `second-proof-${randomUUID()}`;
    const now = new Date();
    await prisma.client.signupPhoneChallenge.create({
      data: {
        id: createId(),
        phoneHash: signupPhoneHash(secret, phone),
        status: SignupPhoneChallengeStatus.VERIFIED,
        idempotencyKey: key(),
        requestHash: 'ab'.repeat(32),
        expiresAt: new Date(now.getTime() + 60_000),
        proofHash: signupProofHash(secret, secondProof),
        proofExpiresAt: new Date(now.getTime() + 60_000),
        verifiedAt: now,
        updatedAt: now,
      },
    });
    const duplicate = await complete(phone, secondProof, key()).expect(409);
    expect(duplicate.body.message).not.toContain(phone);
    expect(await prisma.client.user.count({ where: { phone } })).toBe(1);
    const second = await prisma.client.signupPhoneChallenge.findFirstOrThrow({
      where: { proofHash: signupProofHash(secret, secondProof) },
    });
    expect(second.proofConsumedAt).toBeNull();
  });

  it('signs in with the phone and keeps the session off product routes', async () => {
    const phone = '09126660020';
    const password = 'phone-owner-password';
    const proof = await proofFor(phone);
    const created = await complete(phone, proof, key(), { password }).expect(201);

    const unknown = await phoneLogin('09126660999', password).expect(401);
    const wrong = await phoneLogin(phone, 'wrong-password-value').expect(401);
    expect(withoutRequestId(wrong.body)).toEqual(withoutRequestId(unknown.body));
    expect(JSON.stringify(wrong.body)).not.toContain(phone);
    expect(unknown.body.error).toBe('UNAUTHENTICATED');

    const loggedIn = await phoneLogin(phone, password).expect(201);
    expect(loggedIn.body.sessionScope).toBe('onboarding');
    expect(loggedIn.body.accessState).toBe('AWAITING_AGREEMENT');
    expect(loggedIn.body.user.email).toBeNull();
    expect(JSON.stringify(loggedIn.body)).not.toContain(phone);
    const payload = JSON.parse(
      Buffer.from(String(loggedIn.body.accessToken).split('.')[1] ?? '', 'base64url').toString(),
    ) as { scp?: string; role?: string; tid?: string };
    expect(payload).toEqual(
      expect.objectContaining({ scp: 'onboarding', role: 'OWNER', tid: created.body.salonId }),
    );
    expect(JSON.stringify(payload)).not.toContain(phone);

    const token = loggedIn.body.accessToken as string;
    for (const route of [
      '/customers',
      '/visits',
      '/services',
      '/users',
      '/intelligence/summary',
      '/messages/manual-outreach',
      '/vip/capability',
      '/support/conversation',
      '/actions',
      '/salon',
      '/auth/owner',
    ]) {
      const denied = await request(app.getHttpServer()).get(route).set('Authorization', `Bearer ${token}`);
      if (denied.status !== 403 || denied.body.error !== 'FORBIDDEN') {
        throw new Error(`${route} returned ${denied.status} ${JSON.stringify(denied.body)}`);
      }
    }
    const account = await request(app.getHttpServer())
      .get('/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(account.body).toEqual({
      userId: created.body.userId,
      tenantId: created.body.salonId,
      role: 'OWNER',
      sessionScope: 'onboarding',
      accessState: 'AWAITING_AGREEMENT',
    });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const audits = JSON.stringify(
      await prisma.client.auditLog.findMany({
        where: { tenantId: created.body.salonId, action: 'SALON_SESSION_ISSUED' },
      }),
    );
    expect(audits).toContain('onboarding');
    expect(audits).not.toContain(phone);
    expect(audits).not.toContain(password);

    await prisma.client.salon.update({
      where: { id: created.body.salonId },
      data: { accessState: 'PRODUCT' },
    });
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    const stillOnboarding = await request(app.getHttpServer())
      .get('/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(stillOnboarding.body.sessionScope).toBe('onboarding');
    expect(stillOnboarding.body.accessState).toBe('PRODUCT');

    const promoted = await phoneLogin(phone, password).expect(201);
    expect(promoted.body.sessionScope).toBe('product');
    const productToken = promoted.body.accessToken as string;
    const productPayload = JSON.parse(
      Buffer.from(productToken.split('.')[1] ?? '', 'base64url').toString(),
    ) as { scp?: string };
    expect(productPayload.scp).toBeUndefined();
    const services = await request(app.getHttpServer())
      .get('/services')
      .set('Authorization', `Bearer ${productToken}`)
      .expect(200);
    expect(services.body.items.map((service: { name: string }) => service.name).sort()).toEqual([
      'Hair Service',
      'Nail Service',
    ]);
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${productToken}`)
      .send({
        name: 'Extra',
        email: `extra-${randomUUID()}@example.test`,
        password: 'extra-staff-password',
        role: 'STAFF',
      })
      .expect(403);
    expect(await prisma.client.user.count({ where: { salonId: created.body.salonId } })).toBe(1);
    await expect(
      prisma.client.$executeRaw`
        INSERT INTO users (
          id, salon_id, name, email, password_hash, role, status, updated_at
        ) VALUES (
          ${createId()}::uuid,
          ${created.body.salonId}::uuid,
          'Raw extra',
          ${`raw-${randomUUID()}@example.test`},
          'hash',
          'STAFF',
          'ACTIVE',
          clock_timestamp()
        )
      `,
    ).rejects.toThrow(/additional salon users are not allowed/);
    expect(await prisma.client.user.count({ where: { salonId: created.body.salonId } })).toBe(1);

    await prisma.client.salon.update({
      where: { id: created.body.salonId },
      data: { accessState: 'AWAITING_AGREEMENT' },
    });
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${productToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/account')
      .set('Authorization', `Bearer ${productToken}`)
      .expect(401);
    const returned = await phoneLogin(phone, password).expect(201);
    expect(returned.body.sessionScope).toBe('onboarding');
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${returned.body.accessToken}`)
      .expect(403);
  });

  it('does not reveal an existing phone from OTP start and keeps login generic when suspended', async () => {
    const phone = '09126660011';
    const proof = await proofFor(phone);
    await complete(phone, proof, key()).expect(201);
    otp.sends = [];
    const again = await start(phone).expect(201);
    const fresh = await start('09126660012').expect(201);
    expect(again.body.outcome).toBe('pending');
    expect(fresh.body.outcome).toBe('pending');
    expect(Object.keys(again.body).sort()).toEqual(Object.keys(fresh.body).sort());
    expect(otp.sends).toEqual([phone, '09126660012']);

    await prisma.client.salon.updateMany({
      where: { users: { some: { phone } } },
      data: { status: 'SUSPENDED' },
    });
    const suspended = await phoneLogin(phone, 'phone-owner-password').expect(401);
    const missing = await phoneLogin('09126660998', 'phone-owner-password').expect(401);
    expect(withoutRequestId(suspended.body)).toEqual(withoutRequestId(missing.body));
  });

  it('keeps phone login after OTP signup is disabled and does not reopen email registration', async () => {
    const phone = '09126660030';
    const password = 'phone-owner-password';
    const proof = await proofFor(phone);
    const created = await complete(phone, proof, key(), { password }).expect(201);

    const loggedIn = await phoneLogin(phone, password, disabled.getHttpServer()).expect(201);
    expect(loggedIn.body.sessionScope).toBe('onboarding');
    expect(loggedIn.body.accessState).toBe('AWAITING_AGREEMENT');
    await request(disabled.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${loggedIn.body.accessToken}`)
      .expect(403);
    const unknown = await phoneLogin('09126660997', password, disabled.getHttpServer()).expect(401);
    const wrong = await phoneLogin(phone, 'wrong-password-value', disabled.getHttpServer()).expect(401);
    expect(withoutRequestId(wrong.body)).toEqual(withoutRequestId(unknown.body));
    expect(JSON.stringify(wrong.body)).not.toContain(phone);

    const before = await counts();
    const email = `legacy-${randomUUID()}@example.com`;
    await request(disabled.getHttpServer())
      .post('/auth/register')
      .send({ salonName: 'Bypass', ownerName: 'Bypass', email, password: 'legacy-owner-password' })
      .expect(404);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ salonName: 'Bypass', ownerName: 'Bypass', email, password: 'legacy-owner-password' })
      .expect(404);
    await request(disabled.getHttpServer())
      .post('/auth/signup/phone/start')
      .set('Idempotency-Key', key())
      .send({ phone: '09126660031' })
      .expect(404);
    await request(disabled.getHttpServer())
      .post('/auth/signup/phone/verify')
      .set('Idempotency-Key', key())
      .send({ phone: '09126660031', otpCode: '222222' })
      .expect(404);
    await request(disabled.getHttpServer())
      .post('/auth/signup/phone/complete')
      .set('Idempotency-Key', key())
      .send({
        phone: '09126660031',
        signupProof: 'proof-that-must-not-create',
        salonName: 'Closed',
        ownerName: 'Closed',
        password,
      })
      .expect(404);
    expect(await counts()).toEqual(before);
    expect(otp.sends).not.toContain('09126660031');

    await prisma.client.salon.update({
      where: { id: created.body.salonId },
      data: { accessState: 'PRODUCT' },
    });
    const promoted = await phoneLogin(phone, password, disabled.getHttpServer()).expect(201);
    expect(promoted.body.sessionScope).toBe('product');
    expect(promoted.body.accessState).toBe('PRODUCT');
    await request(disabled.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${promoted.body.accessToken}`)
      .expect(200);

    const config = app.get(AppConfigService);
    const emailModeRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfigService)
      .useValue({
        values: {
          ...config.values,
          PUBLIC_REGISTRATION_MODE: 'email',
          PHONE_SIGNUP_ENABLED: false,
        },
      })
      .overrideProvider(OtpyProvider)
      .useValue(otp)
      .compile();
    const emailMode = emailModeRef.createNestApplication();
    configure(emailMode);
    await emailMode.init();
    try {
      const legacyPassword = 'legacy-owner-password';
      const registered = await request(emailMode.getHttpServer())
        .post('/auth/register')
        .send({ salonName: 'Legacy Salon', ownerName: 'Legacy Owner', email, password: legacyPassword })
        .expect(201);
      expect(registered.body.accessState).toBe('PRODUCT');
      const salon = await prisma.client.salon.findUniqueOrThrow({
        where: { id: registered.body.user.tenantId },
      });
      expect(salon.additionalUsersAllowed).toBe(true);
      const owner = await prisma.client.user.findUniqueOrThrow({ where: { email } });
      expect(owner.phone).toBeNull();
      const signedIn = await request(disabled.getHttpServer())
        .post('/auth/login')
        .send({ email, password: legacyPassword })
        .expect(201);
      expect(signedIn.body.sessionScope).toBe('product');
      const token = signedIn.body.accessToken as string;
      await request(disabled.getHttpServer())
        .get('/customers')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const staffEmail = `staff-${randomUUID()}@example.com`;
      await request(disabled.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Staff', email: staffEmail, password: 'legacy-staff-password', role: 'STAFF' })
        .expect(201);
      expect(await prisma.client.user.count({ where: { salonId: salon.id } })).toBe(2);
    } finally {
      await emailMode.close();
    }

    const adminEmail = `admin-${randomUUID()}@example.com`;
    const adminPassword = 'platform-admin-password';
    await prisma.client.platformAdmin.create({
      data: {
        id: createId(),
        email: adminEmail,
        name: 'Operator',
        passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
        updatedAt: new Date(),
      },
    });
    const admin = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/admin/message-queue')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .expect(200);
  });

  it('upgrades a predecessor database without changing legacy identity or access', async () => {
    if (!container || !databaseUrl) {
      throw new Error('DISPOSABLE_POSTGRES_CONTAINER is required for the upgrade test');
    }
    const upgradeName = `salon_phone_owner_upgrade_${randomUUID().replace(/-/g, '')}`;
    const upgradeUrl = new URL(databaseUrl);
    upgradeUrl.pathname = `/${upgradeName}`;
    await psql(container, 'postgres', `CREATE DATABASE ${upgradeName}`);
    try {
      const migrationsDir = path.resolve(
        __dirname,
        '../../../packages/database/prisma/migrations',
      );
      const directories = (await readdir(migrationsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const cutoff = '20261015160000_phone_owned_salon_access';
      for (const directory of directories) {
        if (directory >= cutoff) continue;
        const sql = await readFile(path.join(migrationsDir, directory, 'migration.sql'), 'utf8');
        await psql(container, upgradeName, sql);
      }

      const upgrade = createPrismaClient(upgradeUrl.toString());
      const missingAccessState = await upgrade.$queryRaw<Array<{ typname: string }>>`
        SELECT typname FROM pg_type WHERE typname = 'SalonAccessState'
      `;
      expect(missingAccessState).toHaveLength(0);
      const salonId = createId();
      const ownerId = createId();
      const staffId = createId();
      const customerId = createId();
      const actionId = createId();
      const ownerEmail = `upgrade-owner-${randomUUID()}@example.com`;
      const staffEmail = `upgrade-staff-${randomUUID()}@example.com`;
      const password = 'upgrade-owner-password';
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await upgrade.$executeRaw`
        INSERT INTO salons (id, name, status, updated_at)
        VALUES (${salonId}::uuid, 'Upgrade Salon', 'ACTIVE', clock_timestamp())
      `;
      await upgrade.$executeRaw`
        INSERT INTO users (id, salon_id, name, email, password_hash, role, status, updated_at)
        VALUES
          (${ownerId}::uuid, ${salonId}::uuid, 'Upgrade Owner', ${ownerEmail}, ${passwordHash}, 'OWNER', 'ACTIVE', clock_timestamp()),
          (${staffId}::uuid, ${salonId}::uuid, 'Upgrade Staff', ${staffEmail}, 'hash', 'STAFF', 'ACTIVE', clock_timestamp())
      `;
      await upgrade.$executeRaw`
        INSERT INTO customers (id, salon_id, first_name, last_name, phone_number, updated_at)
        VALUES (${customerId}::uuid, ${salonId}::uuid, 'Old', 'Customer', '09120001111', clock_timestamp())
      `;
      await upgrade.$executeRaw`
        INSERT INTO opportunity_actions (
          id, salon_id, customer_id, opportunity_type, status, created_by, updated_at
        ) VALUES (
          ${actionId}::uuid, ${salonId}::uuid, ${customerId}::uuid,
          'REACTIVATION', 'OPEN', ${staffId}::uuid, clock_timestamp()
        )
      `;
      await upgrade.$disconnect();

      const later = directories.filter((directory) => directory >= cutoff);
      expect(later[0]).toBe(cutoff);
      for (const directory of later) {
        const sql = await readFile(path.join(migrationsDir, directory, 'migration.sql'), 'utf8');
        await psql(container, upgradeName, sql);
      }

      const upgraded = createPrismaClient(upgradeUrl.toString());
      const owner = await upgraded.user.findUniqueOrThrow({ where: { id: ownerId } });
      const staff = await upgraded.user.findUniqueOrThrow({ where: { id: staffId } });
      const salon = await upgraded.salon.findUniqueOrThrow({ where: { id: salonId } });
      const action = await upgraded.opportunityAction.findUniqueOrThrow({ where: { id: actionId } });
      expect(owner.email).toBe(ownerEmail);
      expect(owner.phone).toBeNull();
      expect(owner.role).toBe('OWNER');
      expect(staff.email).toBe(staffEmail);
      expect(staff.phone).toBeNull();
      expect(staff.role).toBe('STAFF');
      expect(salon.status).toBe('ACTIVE');
      expect(salon.accessState).toBe('PRODUCT');
      expect(salon.additionalUsersAllowed).toBe(true);
      expect(action.createdBy).toBe(staffId);
      expect(action.salonId).toBe(salonId);
      await upgraded.$disconnect();

      const config = app.get(AppConfigService);
      const upgradeRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(AppConfigService)
        .useValue({ values: { ...config.values, DATABASE_URL: upgradeUrl.toString() } })
        .overrideProvider(OtpyProvider)
        .useValue(otp)
        .compile();
      const upgradeApp = upgradeRef.createNestApplication();
      configure(upgradeApp);
      await upgradeApp.init();
      try {
        const connected = await upgradeApp
          .get(PrismaService)
          .client.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
        expect(connected[0]?.current_database).toBe(upgradeName);
        const signedIn = await request(upgradeApp.getHttpServer())
          .post('/auth/login')
          .send({ email: ownerEmail, password })
          .expect(201);
        expect(signedIn.body.accessState).toBe('PRODUCT');
        expect(signedIn.body.sessionScope).toBe('product');
        await request(upgradeApp.getHttpServer())
          .get('/customers')
          .set('Authorization', `Bearer ${signedIn.body.accessToken}`)
          .expect(200);
        const users = await request(upgradeApp.getHttpServer())
          .get('/users')
          .set('Authorization', `Bearer ${signedIn.body.accessToken}`)
          .expect(200);
        expect(users.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ email: ownerEmail, role: 'OWNER' }),
            expect.objectContaining({ email: staffEmail, role: 'STAFF' }),
          ]),
        );
      } finally {
        await upgradeApp.close();
      }
    } finally {
      await psql(container, 'postgres', `DROP DATABASE IF EXISTS ${upgradeName} WITH (FORCE)`);
    }
  });
});

function configure(nest: INestApplication): void {
  nest.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  nest.useGlobalFilters(new HttpExceptionFilter());
}

function resetThrottle(nest: INestApplication | undefined): void {
  const storage = nest?.get(ThrottlerStorage) as
    | { storage: Map<string, { totalHits: Map<string, number>; isBlocked: boolean }> }
    | undefined;
  if (!storage) return;
  for (const record of storage.storage.values()) {
    record.isBlocked = false;
    for (const name of record.totalHits.keys()) {
      record.totalHits.set(name, 0);
    }
  }
}

function withoutRequestId(body: { requestId?: string }): Record<string, unknown> {
  const { requestId: _requestId, ...rest } = body;
  return rest;
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

function psql(containerName: string, database: string, sql: string): Promise<void> {
  if (!/^salon_phone_owner_[a-z0-9_]+$/.test(database) && database !== 'postgres') {
    throw new Error('Refusing to run SQL against an unexpected database');
  }
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      ['exec', '-i', containerName, 'psql', '-U', 'salon', '-d', database, '-v', 'ON_ERROR_STOP=1'],
      { maxBuffer: 20_000_000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      },
    );
    child.stdin?.end(sql);
  });
}

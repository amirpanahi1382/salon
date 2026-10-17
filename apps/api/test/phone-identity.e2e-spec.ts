import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { createId } from '@salon/shared';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { BANK_TRANSFER_ATTESTATION } from '../src/activation/payment-instructions';
import { establishPlatformAdmin, type DatabaseTargetProof } from '../src/auth/establish-platform-admin';
import { OtpyProvider, type OtpSendReceipt } from '../src/auth/otp-provider';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const databaseUrl = process.env.PHONE_FIRST_DISPOSABLE_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, '') : '';
const container = process.env.DISPOSABLE_POSTGRES_CONTAINER ?? '';
const forbiddenContainers = new Set([
  'salon-platform-postgres-1',
  'salon-mobile-ui-pg-20261017',
  'salon-preview-pg-20261005',
  'salon-phone-identity-pg-20261017',
]);
const forbiddenPorts = new Set(['5432', '15450', '15442', '15452', '3002', '18082']);
const disposable =
  Boolean(databaseUrl) &&
  process.env.DATABASE_URL === databaseUrl &&
  databaseName.startsWith('salon_phone_first_') &&
  !forbiddenContainers.has(container) &&
  databaseName !== 'salon' &&
  databaseName !== 'salon_preview';

const describeIfDisposable = disposable ? describe : describe.skip;

class FakeOtpy {
  sends: string[] = [];
  async send(phone: string): Promise<OtpSendReceipt> {
    this.sends.push(phone);
    return { requestId: 'receipt-test', ttlSeconds: 120 };
  }
  async verify(_phone: string, code: string): Promise<boolean> {
    return code !== '000000';
  }
}

describeIfDisposable('phone-first identity on a new empty database', () => {
  jest.setTimeout(180_000);
  const otp = new FakeOtpy();
  let app: INestApplication;
  let prisma: PrismaService;
  const adminPhone = '09121000001';
  const adminPassword = 'platform-admin-password';

  beforeAll(async () => {
    if (!disposable || !databaseUrl) return;
    const target = new URL(databaseUrl);
    if (target.hostname !== '127.0.0.1' || forbiddenPorts.has(target.port)) {
      throw new Error('Phone-first tests refused a non-disposable database target');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpyProvider)
      .useValue(otp)
      .compile();
    app = moduleRef.createNestApplication();
    configure(app);
    await app.init();
    prisma = app.get(PrismaService);
    const config = app.get(AppConfigService).values;
    if (
      !config.PHONE_SIGNUP_ENABLED ||
      config.PUBLIC_REGISTRATION_MODE !== 'phone' ||
      !config.AGREEMENT_ACCEPTANCE_ENABLED ||
      !config.MANUAL_TRANSFER_ENABLED
    ) {
      throw new Error('Phone-first tests require phone signup, agreement, and manual transfer');
    }
    const rows = await prisma.client.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    if (rows[0]?.current_database !== databaseName) {
      throw new Error('Phone-first tests refused a database other than the disposable target');
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    otp.sends = [];
    resetThrottle(app);
  });

  function key(): string {
    return `phone-${randomUUID()}`;
  }

  it('refuses a nonempty database and requires a phone on an empty one', async () => {
    if (!container || !databaseUrl) {
      throw new Error('DISPOSABLE_POSTGRES_CONTAINER is required');
    }
    const nonempty = `salon_phone_first_nonempty_${randomUUID().replace(/-/g, '')}`;
    const outside = `salon_phone_first_outside_${randomUUID().replace(/-/g, '')}`;
    const fresh = `salon_phone_first_fresh_${randomUUID().replace(/-/g, '')}`;
    await psql(container, 'postgres', `CREATE DATABASE ${nonempty}`);
    await psql(container, 'postgres', `CREATE DATABASE ${outside}`);
    await psql(container, 'postgres', `CREATE DATABASE ${fresh}`);
    const migrationsDir = path.resolve(__dirname, '../../../packages/database/prisma/migrations');
    const directories = (await readdir(migrationsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const phoneFirst = '20261017150000_phone_first_identity';
    for (const directory of directories) {
      if (directory >= phoneFirst) continue;
      const sql = await readFile(path.join(migrationsDir, directory, 'migration.sql'), 'utf8');
      await psql(container, nonempty, sql);
      await psql(container, outside, sql);
    }
    const salonId = createId();
    await psql(
      container,
      nonempty,
      `INSERT INTO salons (id, name, status, access_state, additional_users_allowed, updated_at)
       VALUES ('${salonId}', 'Kept', 'ACTIVE', 'PRODUCT', true, clock_timestamp())`,
    );
    const transition = await readFile(path.join(migrationsDir, phoneFirst, 'migration.sql'), 'utf8');
    const beforeSalon = await schemaFingerprint(container, nonempty);
    await expect(psql(container, nonempty, transition)).rejects.toThrow(/phone_first_refuses_nonempty_database/);
    expect(await schemaFingerprint(container, nonempty)).toBe(beforeSalon);
    const kept = await psqlText(
      container,
      nonempty,
      `SELECT count(*) FROM salons WHERE id = '${salonId}'`,
    );
    expect(kept.trim()).toBe('1');
    const stillNullable = await psqlText(
      container,
      nonempty,
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'phone'`,
    );
    expect(stillNullable.trim()).toBe('YES');

    const auditId = createId();
    await psql(
      container,
      outside,
      `INSERT INTO audit_logs (id, action, result) VALUES ('${auditId}', 'OUTSIDE_SIX', 'SUCCESS')`,
    );
    const beforeOutside = await schemaFingerprint(container, outside);
    await expect(psql(container, outside, transition)).rejects.toThrow(/phone_first_refuses_nonempty_database/);
    expect(await schemaFingerprint(container, outside)).toBe(beforeOutside);
    const keptAudit = await psqlText(
      container,
      outside,
      `SELECT count(*) FROM audit_logs WHERE id = '${auditId}'`,
    );
    expect(keptAudit.trim()).toBe('1');
    const outsidePhone = await psqlText(
      container,
      outside,
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'phone'`,
    );
    expect(outsidePhone.trim()).toBe('YES');

    for (const directory of directories) {
      const sql = await readFile(path.join(migrationsDir, directory, 'migration.sql'), 'utf8');
      await psql(container, fresh, sql);
    }
    const required = await psqlText(
      container,
      fresh,
      `SELECT table_name || ':' || is_nullable
       FROM information_schema.columns
       WHERE column_name = 'phone' AND table_name IN ('users', 'platform_admins')
       ORDER BY table_name`,
    );
    expect(required.trim().split('\n').map((line) => line.trim())).toEqual([
      'platform_admins:NO',
      'users:NO',
    ]);
    await expect(
      psql(
        container,
        fresh,
        `INSERT INTO salons (id, name, status, access_state, additional_users_allowed, updated_at)
         VALUES ('${createId()}', 'Empty', 'ACTIVE', 'PRODUCT', false, clock_timestamp());
         INSERT INTO users (id, salon_id, name, password_hash, role, status, updated_at)
         SELECT id, id, 'Owner', 'hash', 'OWNER', 'ACTIVE', clock_timestamp() FROM salons WHERE name = 'Empty'`,
      ),
    ).rejects.toThrow();
    await expect(
      psql(
        container,
        fresh,
        `BEGIN;
         INSERT INTO salons (id, name, status, access_state, additional_users_allowed, updated_at)
         VALUES ('${createId()}', 'Cross', 'ACTIVE', 'AWAITING_AGREEMENT', false, clock_timestamp());
         INSERT INTO users (id, salon_id, name, phone, password_hash, role, status, updated_at)
         SELECT '${createId()}', id, 'Owner', '09121000099', 'hash', 'OWNER', 'ACTIVE', clock_timestamp()
         FROM salons WHERE name = 'Cross';
         INSERT INTO platform_admins (id, phone, password_hash, name, status, updated_at)
         VALUES ('${createId()}', '09121000099', 'hash', 'Operator', 'ACTIVE', clock_timestamp());
         COMMIT;`,
      ),
    ).rejects.toThrow(/phone_identity_cross_role/);
    const rolled = await psqlText(
      container,
      fresh,
      `SELECT count(*) FROM users WHERE phone = '09121000099'`,
    );
    expect(rolled.trim()).toBe('0');
  });

  it('creates one verified admin, then walks signup through approval without changing the password', async () => {
    const proof = await targetProof();
    otp.sends = [];
    await expect(
      establishPlatformAdmin({
        prisma: prisma.client,
        databaseUrl: databaseUrl!,
        expected: undefined,
        phone: adminPhone,
        password: adminPassword,
        otpCode: undefined,
        otp,
        hashPassword: async () => 'unused',
        createId,
      }),
    ).rejects.toThrow(/target proof is incomplete/);
    await expect(
      establishPlatformAdmin({
        prisma: prisma.client,
        databaseUrl: databaseUrl!,
        expected: { ...proof, databaseComment: 'different-marker' },
        phone: adminPhone,
        password: adminPassword,
        otpCode: '246810',
        otp,
        hashPassword: async () => 'unused',
        createId,
      }),
    ).rejects.toThrow(/does not match/);
    expect(otp.sends).toEqual([]);
    expect(await prisma.client.platformAdmin.count()).toBe(0);
    const establishes = await establishPlatformAdmin({
      prisma: prisma.client,
      databaseUrl: databaseUrl!,
      expected: proof,
      phone: adminPhone,
      password: adminPassword,
      otpCode: undefined,
      otp,
      hashPassword: async () => 'pending',
      createId,
    });
    expect(establishes).toEqual({ outcome: 'verification_sent' });
    expect(await prisma.client.platformAdmin.count()).toBe(0);
    await expect(
      establishPlatformAdmin({
        prisma: prisma.client,
        databaseUrl: databaseUrl!,
        expected: proof,
        phone: adminPhone,
        password: adminPassword,
        otpCode: '000000',
        otp,
        hashPassword: async () => 'unused',
        createId,
      }),
    ).rejects.toThrow(/verification failed/);
    expect(await prisma.client.platformAdmin.count()).toBe(0);
    const createdAdmin = await establishPlatformAdmin({
      prisma: prisma.client,
      databaseUrl: databaseUrl!,
      expected: proof,
      phone: adminPhone,
      password: adminPassword,
      otpCode: '246810',
      otp,
      hashPassword: async (password) => {
        const argon2 = await import('argon2');
        return argon2.hash(password, { type: argon2.argon2id });
      },
      createId,
    });
    expect(createdAdmin).toEqual({ outcome: 'established' });
    await expect(
      establishPlatformAdmin({
        prisma: prisma.client,
        databaseUrl: databaseUrl!,
        expected: proof,
        phone: '09121000002',
        password: adminPassword,
        otpCode: '246810',
        otp,
        hashPassword: async () => 'unused',
        createId,
      }),
    ).rejects.toThrow(/already exists/);
    expect(await prisma.client.platformAdmin.count()).toBe(1);

    await request(app.getHttpServer()).post('/auth/register').send({}).expect(404);
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(404);
    await request(app.getHttpServer()).post('/admin/auth/login').send({}).expect(404);

    const phone = '09121000010';
    const password = 'phone-owner-password';
    await request(app.getHttpServer())
      .post('/auth/signup/phone/start')
      .set('Idempotency-Key', key())
      .send({ phone })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/signup/phone/verify')
      .set('Idempotency-Key', key())
      .send({ phone, otpCode: '000000' })
      .expect(400);
    const verified = await request(app.getHttpServer())
      .post('/auth/signup/phone/verify')
      .set('Idempotency-Key', key())
      .send({ phone, otpCode: '222222' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/signup/phone/complete')
      .set('Idempotency-Key', key())
      .send({
        phone,
        signupProof: verified.body.signupProof,
        salonName: 'Niloofar',
        ownerName: 'Niloofar',
        password,
        passwordConfirmation: 'other-password',
      })
      .expect(400);
    expect(await prisma.client.user.count()).toBe(0);
    const created = await request(app.getHttpServer())
      .post('/auth/signup/phone/complete')
      .set('Idempotency-Key', key())
      .send({
        phone,
        signupProof: verified.body.signupProof,
        salonName: 'Niloofar',
        ownerName: 'Niloofar',
        password,
        passwordConfirmation: password,
      })
      .expect(201);
    expect(created.body.accessToken).toBeUndefined();
    expect(created.body.accessState).toBe('AWAITING_AGREEMENT');
    expect(await prisma.client.platformAdmin.count()).toBe(1);
    const owner = await prisma.client.user.findUniqueOrThrow({ where: { id: created.body.userId } });
    const passwordHash = owner.passwordHash;
    expect(owner.phone).toBe(phone);
    expect(owner.email).toBeNull();
    const salon = await prisma.client.salon.findUniqueOrThrow({ where: { id: created.body.salonId } });
    expect(salon.additionalUsersAllowed).toBe(false);
    expect(salon.accessState).toBe('AWAITING_AGREEMENT');

    const unknown = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone: '09121000999', password })
      .expect(401);
    const wrong = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone, password: 'wrong-password' })
      .expect(401);
    expect(withoutRequestId(wrong.body)).toEqual(withoutRequestId(unknown.body));

    const restricted = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone, password })
      .expect(201);
    expect(restricted.body.accountKind).toBe('SALON_USER');
    expect(restricted.body.sessionScope).toBe('onboarding');
    const onboardingToken = restricted.body.accessToken as string;
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .expect(403);

    const adminSession = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone: adminPhone, password: adminPassword })
      .expect(201);
    expect(adminSession.body.accountKind).toBe('PLATFORM_ADMIN');
    await request(app.getHttpServer())
      .get('/admin/auth/me')
      .set('Authorization', `Bearer ${adminSession.body.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminSession.body.accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post('/admin/agreements/versions/publish')
      .set('Authorization', `Bearer ${adminSession.body.accessToken}`)
      .expect(201);
    const presented = await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .send({
        fullName: 'نرگس رضایی',
        nationalId: nationalId('049937089'),
        salonName: 'سالن قرارداد',
        phone,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .set('Idempotency-Key', key())
      .send({ presentationId: presented.body.presentationId, accepted: true })
      .expect(201);
    const paying = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone, password })
      .expect(201);
    expect(paying.body.accessState).toBe('AWAITING_PAYMENT');
    const paymentToken = paying.body.accessToken as string;
    const status = await request(app.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${paymentToken}`)
      .expect(200);
    expect(status.body.phase).toBe('AWAITING_RECEIPT');
    const uploaded = await request(app.getHttpServer())
      .post('/activation/receipts')
      .set('Authorization', `Bearer ${paymentToken}`)
      .attach('file', await receiptJpeg(), 'receipt.jpg')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/activation/receipts/${uploaded.body.receiptId}/submit`)
      .set('Authorization', `Bearer ${paymentToken}`)
      .set('Idempotency-Key', key())
      .expect(201);
    const approved = await request(app.getHttpServer())
      .post(`/admin/activation-receipts/${uploaded.body.receiptId}/approve`)
      .set('Authorization', `Bearer ${adminSession.body.accessToken}`)
      .set('Idempotency-Key', key())
      .send({ bankAttestation: BANK_TRANSFER_ATTESTATION })
      .expect(201);
    expect(approved.body.phase).toBe('APPROVED');
    expect(JSON.stringify(approved.body)).not.toContain(password);
    expect((await prisma.client.user.findUniqueOrThrow({ where: { id: owner.id } })).passwordHash).toBe(
      passwordHash,
    );
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${paymentToken}`)
      .expect(403);
    const product = await request(app.getHttpServer())
      .post('/auth/session/product')
      .set('Authorization', `Bearer ${paymentToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${product.body.accessToken}`)
      .expect(200);
  });

  it('rejects a duplicate phone, replays one send, and lets one concurrent start win', async () => {
    const phone = '09121000021';
    const startKey = key();
    otp.sends = [];
    await request(app.getHttpServer())
      .post('/auth/signup/phone/start')
      .set('Idempotency-Key', startKey)
      .send({ phone })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/signup/phone/start')
      .set('Idempotency-Key', startKey)
      .send({ phone })
      .expect(201);
    expect(otp.sends).toEqual([phone]);

    const racePhone = '09121000022';
    otp.sends = [];
    const raced = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/signup/phone/start')
        .set('Idempotency-Key', key())
        .send({ phone: racePhone }),
      request(app.getHttpServer())
        .post('/auth/signup/phone/start')
        .set('Idempotency-Key', key())
        .send({ phone: racePhone }),
    ]);
    expect(raced.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(otp.sends).toEqual([racePhone]);

    const verified = await request(app.getHttpServer())
      .post('/auth/signup/phone/verify')
      .set('Idempotency-Key', key())
      .send({ phone, otpCode: '333333' })
      .expect(201);
    const completeKey = key();
    const completeBody = {
      phone,
      signupProof: verified.body.signupProof,
      salonName: 'One',
      ownerName: 'One',
      password: 'phone-owner-password',
      passwordConfirmation: 'phone-owner-password',
    };
    const first = await request(app.getHttpServer())
      .post('/auth/signup/phone/complete')
      .set('Idempotency-Key', completeKey)
      .send(completeBody)
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post('/auth/signup/phone/complete')
      .set('Idempotency-Key', completeKey)
      .send(completeBody)
      .expect(201);
    expect(replay.body.salonId).toBe(first.body.salonId);
    const before = await prisma.client.user.count();
    await request(app.getHttpServer())
      .post('/auth/signup/phone/complete')
      .set('Idempotency-Key', key())
      .send({ ...completeBody, salonName: 'Two' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/signup/phone/start')
      .set('Idempotency-Key', key())
      .send({ phone })
      .expect(201);
    const again = await request(app.getHttpServer())
      .post('/auth/signup/phone/verify')
      .set('Idempotency-Key', key())
      .send({ phone, otpCode: '444444' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/signup/phone/complete')
      .set('Idempotency-Key', key())
      .send({
        ...completeBody,
        signupProof: again.body.signupProof,
        salonName: 'Two',
      })
      .expect(409);
    expect(await prisma.client.user.count()).toBe(before);
    expect(first.body.salonId).toBeTruthy();

    await request(app.getHttpServer())
      .post('/auth/signup/phone/start')
      .set('Idempotency-Key', key())
      .send({ phone: adminPhone })
      .expect(201);
    const adminProof = await request(app.getHttpServer())
      .post('/auth/signup/phone/verify')
      .set('Idempotency-Key', key())
      .send({ phone: adminPhone, otpCode: '333333' })
      .expect(201);
    const admins = await prisma.client.platformAdmin.count();
    await request(app.getHttpServer())
      .post('/auth/signup/phone/complete')
      .set('Idempotency-Key', key())
      .send({
        phone: adminPhone,
        signupProof: adminProof.body.signupProof,
        salonName: 'Not Admin',
        ownerName: 'Not Admin',
        password: 'phone-owner-password',
        passwordConfirmation: 'phone-owner-password',
      })
      .expect(409);
    expect(await prisma.client.platformAdmin.count()).toBe(admins);
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

async function targetProof(): Promise<DatabaseTargetProof> {
  const marker = 'salon-phone-first-disposable-marker';
  await psql(container, 'postgres', `COMMENT ON DATABASE ${databaseName} IS '${marker}'`);
  const text = await psqlText(
    container,
    databaseName,
    `SELECT current_database() || '|' || (SELECT system_identifier::text FROM pg_control_system()) || '|' || COALESCE(shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database'), '')`,
  );
  const [name, systemIdentifier, comment] = text.trim().split('|');
  return {
    databaseName: name ?? '',
    systemIdentifier: systemIdentifier ?? '',
    databaseComment: comment ?? '',
  };
}

async function schemaFingerprint(containerName: string, database: string): Promise<string> {
  return psqlText(
    containerName,
    database,
    `SELECT md5(string_agg(marker, ',' ORDER BY marker)) FROM (
       SELECT table_name || '.' || column_name || ':' || is_nullable || ':' || data_type AS marker
       FROM information_schema.columns WHERE table_schema = 'public'
       UNION ALL
       SELECT 'trigger:' || tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ) markers`,
  );
}

function withoutRequestId(body: { requestId?: string }): Record<string, unknown> {
  const { requestId: _requestId, ...rest } = body;
  return rest;
}

function nationalId(base9: string): string {
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(base9[index]) * (10 - index);
  }
  const remainder = sum % 11;
  const check = remainder < 2 ? remainder : 11 - remainder;
  return `${base9}${check}`;
}

function receiptJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 40, b: 60 } },
  })
    .jpeg()
    .toBuffer();
}

function psql(containerName: string, database: string, sql: string): Promise<void> {
  return psqlCapture(containerName, database, sql).then(() => undefined);
}

function psqlText(containerName: string, database: string, sql: string): Promise<string> {
  return psqlCapture(containerName, database, sql, ['-t', '-A']);
}

function psqlCapture(
  containerName: string,
  database: string,
  sql: string,
  extra: string[] = [],
): Promise<string> {
  if (!/^salon_phone_first_[a-z0-9_]+$/.test(database) && database !== 'postgres') {
    throw new Error('Refusing to run SQL against an unexpected database');
  }
  if (forbiddenContainers.has(containerName)) {
    throw new Error('Refusing to run SQL in a protected container');
  }
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      ['exec', '-i', containerName, 'psql', '-U', 'salon', '-d', database, '-v', 'ON_ERROR_STOP=1', ...extra],
      { maxBuffer: 20_000_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.end(sql);
  });
}

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { decode } from 'jsonwebtoken';
import { createPrismaClient } from '@salon/database';
import { createId, InfrastructureError } from '@salon/shared';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { provisionSalonOwner } from '../src/auth/provision-salon-owner';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/infrastructure/storage/object-storage';
import { S3CompatibleObjectStorage } from '../src/infrastructure/storage/s3-compatible.object-storage';
import { BANK_TRANSFER_ATTESTATION, CONTRACT_PAYMENT_AMOUNT_LABEL, MANUAL_TRANSFER_CARD_NUMBER, MANUAL_TRANSFER_CARDHOLDER_NAME } from '../src/activation/payment-instructions';

const databaseUrl = process.env.ACTIVATION_DISPOSABLE_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, '') : '';
const container = process.env.DISPOSABLE_POSTGRES_CONTAINER ?? '';
const disposable =
  Boolean(databaseUrl) &&
  process.env.DATABASE_URL === databaseUrl &&
  databaseName.startsWith('salon_activation_') &&
  databaseName !== 'salon' &&
  databaseName !== 'salon_preview';

const describeIfDisposable = disposable ? describe : describe.skip;

describeIfDisposable('manual transfer receipt review on a disposable database', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let hidden: INestApplication;
  let prisma: PrismaService;
  const national = nationalId('001354241');
  const password = 'activation-owner-password';

  beforeAll(async () => {
    if (!disposable || !databaseUrl) return;
    const target = new URL(databaseUrl);
    if (
      (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') ||
      databaseName === 'salon' ||
      databaseName === 'salon_preview'
    ) {
      throw new Error('Activation tests refused a non-disposable database target');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configure(app);
    await app.init();
    prisma = app.get(PrismaService);
    const rows = await prisma.client.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    if (rows[0]?.current_database !== databaseName) {
      throw new Error('Activation tests refused a database other than the disposable target');
    }
    const config = app.get(AppConfigService);
    if (!config.values.MANUAL_TRANSFER_ENABLED || !config.values.AGREEMENT_ACCEPTANCE_ENABLED) {
      throw new Error('Activation tests require manual transfer and agreement acceptance flags');
    }
    if (config.values.PHONE_SIGNUP_ENABLED) {
      throw new Error('Activation tests must leave phone signup disabled');
    }
    const storage = app.get(OBJECT_STORAGE);
    const hiddenRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfigService)
      .useValue({ values: { ...config.values, MANUAL_TRANSFER_ENABLED: false } })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .compile();
    hidden = hiddenRef.createNestApplication();
    configure(hidden);
    await hidden.init();
  });

  afterAll(async () => {
    if (hidden) await hidden.close();
    if (app) await app.close();
  });

  beforeEach(() => {
    resetThrottle(app);
    resetThrottle(hidden);
  });

  it('keeps bank instructions unpublished until the flag is on and leaves an email salon active', async () => {
    const email = await legacyOwner();
    await request(hidden.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${email.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${email.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${email.token}`)
      .expect(200);
    const salon = await prisma.client.salon.findUniqueOrThrow({ where: { id: email.salonId } });
    expect(salon.accessState).toBe('PRODUCT');
    expect(salon.additionalUsersAllowed).toBe(true);
    expect(await prisma.client.activationReceipt.count({ where: { salonId: email.salonId } })).toBe(0);
  });

  it('reviews one receipt, rejects a replacement path, and exchanges a product session only after approval', async () => {
    const admin = await platformAdmin();
    await request(app.getHttpServer())
      .post('/admin/agreements/versions/publish')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    const owner = await acceptOwner(admin.token);
    const other = await acceptOwner(admin.token);
    const unavailable = await request(hidden.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(unavailable.body).toEqual({
      phase: 'PAYMENT_UNAVAILABLE',
      receiptReady: false,
      receiptId: null,
      submittedAt: null,
      rejectionReason: null,
      instructions: null,
    });
    expect(JSON.stringify(unavailable.body)).not.toContain(MANUAL_TRANSFER_CARD_NUMBER);
    expect(JSON.stringify(unavailable.body)).not.toContain(MANUAL_TRANSFER_CARDHOLDER_NAME);
    await request(hidden.getHttpServer())
      .post('/activation/receipts')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', await receiptJpeg(1), 'receipt.jpg')
      .expect(404);

    const status = await request(app.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(status.body.phase).toBe('AWAITING_RECEIPT');
    expect(status.body.receiptReady).toBe(false);
    expect(status.body.instructions).toMatchObject({
      cardNumber: MANUAL_TRANSFER_CARD_NUMBER,
      cardNumberCopy: MANUAL_TRANSFER_CARD_NUMBER,
      cardholderName: MANUAL_TRANSFER_CARDHOLDER_NAME,
      amountLabel: CONTRACT_PAYMENT_AMOUNT_LABEL,
      amountCopy: CONTRACT_PAYMENT_AMOUNT_LABEL,
      amountIrr: '50000000.00',
      currency: 'IRR',
    });
    expect(status.body.instructions.notice).toContain('تأیید واریز نیست');

    await request(app.getHttpServer())
      .post('/activation/receipts')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('<svg><script>alert(1)</script></svg>'), 'receipt.svg')
      .expect(400);
    await request(app.getHttpServer())
      .post('/activation/receipts')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.alloc(ACTIVATION_TOO_BIG, 0xff), 'huge.jpg')
      .expect(413);
    expect(await prisma.client.activationReceipt.count({
      where: { salonId: owner.salonId, phase: { in: ['STORED', 'UNDER_REVIEW'] } },
    })).toBe(0);

    const first = await upload(owner.token, await receiptJpeg(2));
    const truncated = (await receiptJpeg(3)).subarray(0, 24);
    await request(app.getHttpServer())
      .post('/activation/receipts')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', truncated, 'truncated.jpg')
      .expect(400);
    const oversized = await sharp({
      create: { width: 8_001, height: 1, channels: 3, background: { r: 4, g: 5, b: 6 } },
    }).png().toBuffer();
    await request(app.getHttpServer())
      .post('/activation/receipts')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', oversized, 'huge.png')
      .expect(400);
    const replacement = await upload(owner.token, await receiptJpeg(4));
    expect(replacement.body.phase).toBe('STORED');
    const old = await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: first.body.receiptId } });
    expect(old.phase).toBe('SUPERSEDED');
    await request(app.getHttpServer())
      .post(`/activation/receipts/${first.body.receiptId}/submit`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', `submit-old-${randomUUID()}`)
      .expect(409);

    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    const stored = await prisma.client.activationReceipt.findUniqueOrThrow({
      where: { id: replacement.body.receiptId },
    });
    await storage.deleteObject(stored.objectKey);
    await request(app.getHttpServer())
      .post(`/activation/receipts/${stored.id}/submit`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', `missing-${randomUUID()}`)
      .expect(503);
    expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: stored.id } })).phase).toBe('STORED');

    const ready = await upload(owner.token, await receiptJpeg(5));
    const submitKey = `submit-${randomUUID()}`;
    const submitted = await request(app.getHttpServer())
      .post(`/activation/receipts/${ready.body.receiptId}/submit`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', submitKey)
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post(`/activation/receipts/${ready.body.receiptId}/submit`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', submitKey)
      .expect(201);
    expect(replay.body.receiptId).toBe(submitted.body.receiptId);
    expect(replay.body.replayed).toBe(true);
    await request(app.getHttpServer())
      .post(`/activation/receipts/${ready.body.receiptId}/submit`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', `other-${randomUUID()}`)
      .expect(409);
    expect(await prisma.client.activationReceipt.count({
      where: { salonId: owner.salonId, phase: 'UNDER_REVIEW' },
    })).toBe(1);

    const waiting = await request(app.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(waiting.body.phase).toBe('UNDER_REVIEW');
    expect(waiting.body.instructions).toBeNull();
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/auth/owner')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/activation/receipts/${ready.body.receiptId}/image`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    const pending = await request(app.getHttpServer())
      .get('/admin/activation-receipts')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(pending.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: ready.body.receiptId,
        salonName: 'سالن قرارداد',
        ownerName: 'نرگس رضایی',
        phase: 'UNDER_REVIEW',
      }),
    ]));
    const detail = await request(app.getHttpServer())
      .get(`/admin/activation-receipts/${ready.body.receiptId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(detail.body.instructions.amountLabel).toBe(CONTRACT_PAYMENT_AMOUNT_LABEL);
    expect(detail.body.agreementVersionKey).toBe('CONTRACT_V1');
    expect(detail.body.notice).toContain('تأیید واریز نیست');
    expect(detail.body.requiredBankAttestation).toBe(BANK_TRANSFER_ATTESTATION);
    expect(detail.body.bankAttestationWording).toBeNull();
    const image = await request(app.getHttpServer())
      .get(`/admin/activation-receipts/${ready.body.receiptId}/image`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(image.headers['cache-control']).toContain('no-store');
    expect(Number(image.headers['content-length'])).toBeGreaterThan(10);
    expect(await prisma.client.auditLog.count({
      where: { resourceId: ready.body.receiptId, action: 'ACTIVATION_RECEIPT_VIEWED' },
    })).toBe(1);
    const paused = await request(hidden.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(paused.body.phase).toBe('UNDER_REVIEW');
    expect(paused.body.receiptId).toBe(ready.body.receiptId);
    expect(paused.body.instructions).toBeNull();
    expect(JSON.stringify(paused.body)).not.toContain(MANUAL_TRANSFER_CARD_NUMBER);
    const hiddenPending = await request(hidden.getHttpServer())
      .get('/admin/activation-receipts')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(hiddenPending.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ready.body.receiptId, phase: 'UNDER_REVIEW' }),
    ]));
    const hiddenDetail = await request(hidden.getHttpServer())
      .get(`/admin/activation-receipts/${ready.body.receiptId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(hiddenDetail.body.id).toBe(ready.body.receiptId);
    expect(hiddenDetail.body.bankAttestationWording).toBeNull();
    const hiddenImage = await request(hidden.getHttpServer())
      .get(`/admin/activation-receipts/${ready.body.receiptId}/image`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(Number(hiddenImage.headers['content-length'])).toBeGreaterThan(10);
    const views = await prisma.client.auditLog.findMany({
      where: { resourceId: ready.body.receiptId, action: 'ACTIVATION_RECEIPT_VIEWED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(views).toHaveLength(2);
    expect(JSON.stringify(views[0]?.metadata)).not.toContain('bankAttestationWording');
    expect(JSON.stringify(views[0]?.metadata)).not.toContain('MANUAL_PLATFORM_ADMIN');
    await request(hidden.getHttpServer())
      .post(`/activation/receipts/${ready.body.receiptId}/submit`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', `hidden-submit-${randomUUID()}`)
      .expect(404);
    await request(hidden.getHttpServer())
      .post(`/admin/activation-receipts/${ready.body.receiptId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', `hidden-approve-${randomUUID()}`)
      .send({ bankAttestation: BANK_TRANSFER_ATTESTATION })
      .expect(404);
    await request(hidden.getHttpServer())
      .post(`/admin/activation-receipts/${ready.body.receiptId}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', `hidden-reject-${randomUUID()}`)
      .send({ reason: 'نباید در حالت خاموش ثبت شود' })
      .expect(404);
    expect((await prisma.client.salon.findUniqueOrThrow({ where: { id: owner.salonId } })).accessState)
      .toBe('AWAITING_PAYMENT');
    expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: ready.body.receiptId } })).phase)
      .toBe('UNDER_REVIEW');

    const rejectedDecision = await request(app.getHttpServer())
      .post(`/admin/activation-receipts/${ready.body.receiptId}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', `reject-${randomUUID()}`)
      .send({ reason: 'مبلغ با قرارداد یکی نیست' })
      .expect(201);
    expect(rejectedDecision.body.phase).toBe('REJECTED');
    expect(rejectedDecision.body.accessState).toBe('AWAITING_PAYMENT');
    const rejectedSalon = await prisma.client.salon.findUniqueOrThrow({ where: { id: owner.salonId } });
    expect(rejectedSalon.accessState).toBe('AWAITING_PAYMENT');
    await request(app.getHttpServer())
      .post(`/admin/activation-receipts/${ready.body.receiptId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', `late-${randomUUID()}`)
      .send({ bankAttestation: BANK_TRANSFER_ATTESTATION })
      .expect(409);
    const hiddenRejected = await request(hidden.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(hiddenRejected.body.phase).toBe('PAYMENT_UNAVAILABLE');
    expect(hiddenRejected.body.rejectionReason).toBe('مبلغ با قرارداد یکی نیست');
    expect(hiddenRejected.body.instructions).toBeNull();
    expect(JSON.stringify(hiddenRejected.body)).not.toContain(MANUAL_TRANSFER_CARD_NUMBER);
    await request(hidden.getHttpServer())
      .post('/activation/receipts')
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', await receiptJpeg(1), 'receipt.jpg')
      .expect(404);
    const rejected = await request(app.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(rejected.body.rejectionReason).toBe('مبلغ با قرارداد یکی نیست');
    expect(rejected.body.receiptReady).toBe(false);
    const again = await upload(owner.token, await receiptJpeg(6));
    const submittedAgain = await request(app.getHttpServer())
      .post(`/activation/receipts/${again.body.receiptId}/submit`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', `submit-again-${randomUUID()}`)
      .expect(201);
    expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: ready.body.receiptId } })).phase)
      .toBe('REJECTED');
    await request(app.getHttpServer())
      .post(`/admin/activation-receipts/${submittedAgain.body.receiptId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', `forged-flag-${randomUUID()}`)
      .send({ bankVerified: true })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/admin/activation-receipts/${submittedAgain.body.receiptId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', `forged-text-${randomUUID()}`)
      .send({ bankAttestation: 'true' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/admin/activation-receipts/${submittedAgain.body.receiptId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', `missing-attestation-${randomUUID()}`)
      .send({})
      .expect(400);
    expect((await prisma.client.salon.findUniqueOrThrow({ where: { id: owner.salonId } })).accessState)
      .toBe('AWAITING_PAYMENT');
    expect(await prisma.client.auditLog.count({
      where: { resourceId: submittedAgain.body.receiptId, action: 'ACTIVATION_RECEIPT_APPROVED' },
    })).toBe(0);
    const finalKey = `approve-final-${randomUUID()}`;
    const approved = await request(app.getHttpServer())
      .post(`/admin/activation-receipts/${submittedAgain.body.receiptId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', finalKey)
      .send({ bankAttestation: BANK_TRANSFER_ATTESTATION })
      .expect(201);
    expect(approved.body.phase).toBe('APPROVED');
    const replayed = await request(app.getHttpServer())
      .post(`/admin/activation-receipts/${submittedAgain.body.receiptId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', finalKey)
      .send({ bankAttestation: BANK_TRANSFER_ATTESTATION })
      .expect(201);
    expect(replayed.body.replayed).toBe(true);
    await request(app.getHttpServer())
      .post(`/admin/activation-receipts/${submittedAgain.body.receiptId}/reject`)
      .set('Authorization', `Bearer ${admin.token}`)
      .set('Idempotency-Key', `after-${randomUUID()}`)
      .send({ reason: 'دیر شده است' })
      .expect(409);
    await assertApproved(owner, submittedAgain.body.receiptId, admin.token, finalKey);
    const competing = await upload(other.token, await receiptJpeg(7));
    const competingSubmit = await request(app.getHttpServer())
      .post(`/activation/receipts/${competing.body.receiptId}/submit`)
      .set('Authorization', `Bearer ${other.token}`)
      .set('Idempotency-Key', `submit-race-${randomUUID()}`)
      .expect(201);
    const approveKey = `approve-race-${randomUUID()}`;
    const race = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/activation-receipts/${competingSubmit.body.receiptId}/approve`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Idempotency-Key', approveKey)
        .send({ bankAttestation: BANK_TRANSFER_ATTESTATION }),
      request(app.getHttpServer())
        .post(`/admin/activation-receipts/${competingSubmit.body.receiptId}/reject`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Idempotency-Key', `reject-race-${randomUUID()}`)
        .send({ reason: 'بررسی همزمان' }),
    ]);
    expect(race.map((item) => item.status).sort()).toEqual([201, 409]);
    const winner = race.find((item) => item.status === 201);
    const competingSalon = await prisma.client.salon.findUniqueOrThrow({ where: { id: other.salonId } });
    expect(competingSalon.accessState).toBe(winner?.body.phase === 'APPROVED' ? 'PRODUCT' : 'AWAITING_PAYMENT');
    expect(await prisma.client.activationReceipt.count({
      where: { id: competingSubmit.body.receiptId, phase: winner?.body.phase },
    })).toBe(1);
    const competingReceipt = await prisma.client.activationReceipt.findUniqueOrThrow({
      where: { id: competingSubmit.body.receiptId },
    });
    expect(competingReceipt.bankAttestationWording).toBe(
      competingReceipt.phase === 'APPROVED' ? BANK_TRANSFER_ATTESTATION : null,
    );

    const acceptance = await prisma.client.agreementAcceptance.findFirstOrThrow({
      where: { salonId: owner.salonId },
    });
    expect(acceptance.amountIrr.toFixed(2)).toBe('50000000.00');
    expect(await prisma.client.activationReceipt.count({ where: { salonId: owner.salonId } })).toBeGreaterThan(1);
  });

  it('applies the receipt migration without rewriting a historical salon', async () => {
    if (!container || !databaseUrl) {
      throw new Error('DISPOSABLE_POSTGRES_CONTAINER is required for the upgrade rehearsal');
    }
    const upgradeName = `salon_activation_upgrade_${randomUUID().replace(/-/g, '')}`;
    const upgradeUrl = new URL(databaseUrl);
    upgradeUrl.pathname = `/${upgradeName}`;
    await psql(container, 'postgres', `CREATE DATABASE ${upgradeName}`);
    try {
      const migrationsDir = path.resolve(__dirname, '../../../packages/database/prisma/migrations');
      const directories = (await readdir(migrationsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const directory of directories) {
        if (directory >= '20261015190000_activation_receipts') continue;
        await psql(container, upgradeName, await readFile(path.join(migrationsDir, directory, 'migration.sql'), 'utf8'));
      }
      const before = createPrismaClient(upgradeUrl.toString());
      const salonId = createId();
      await before.salon.create({
        data: { id: salonId, name: 'Historical email', status: 'ACTIVE', updatedAt: new Date() },
      });
      await before.$disconnect();
      const sql = await readFile(
        path.join(migrationsDir, '20261015190000_activation_receipts', 'migration.sql'),
        'utf8',
      );
      expect(sql).not.toMatch(/UPDATE\s+"salons"/i);
      await psql(container, upgradeName, sql);
      const after = createPrismaClient(upgradeUrl.toString());
      const salon = await after.salon.findUniqueOrThrow({ where: { id: salonId } });
      expect(salon.accessState).toBe('PRODUCT');
      expect(await after.activationReceipt.count()).toBe(0);
      const upgradedColumn = await after.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'activation_receipts' AND column_name = 'bank_attestation_wording'
      `;
      expect(upgradedColumn).toHaveLength(1);
      await after.$disconnect();
    } finally {
      await psql(container, 'postgres', `DROP DATABASE IF EXISTS ${upgradeName} WITH (FORCE)`);
    }
  });

  it('applies a fresh migrate of the unpublished receipt migration on an empty disposable database', async () => {
    if (!container || !databaseUrl) {
      throw new Error('DISPOSABLE_POSTGRES_CONTAINER is required for the fresh migrate rehearsal');
    }
    const freshName = `salon_activation_fresh_${randomUUID().replace(/-/g, '')}`;
    const freshUrl = new URL(databaseUrl);
    freshUrl.pathname = `/${freshName}`;
    await psql(container, 'postgres', `CREATE DATABASE ${freshName}`);
    try {
      await migrateDeploy(freshUrl.toString());
      const fresh = createPrismaClient(freshUrl.toString());
      const columns = await fresh.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'activation_receipts' AND column_name = 'bank_attestation_wording'
      `;
      expect(columns).toHaveLength(1);
      const salonId = createId();
      await fresh.salon.create({
        data: { id: salonId, name: 'Fresh email', status: 'ACTIVE', updatedAt: new Date() },
      });
      expect((await fresh.salon.findUniqueOrThrow({ where: { id: salonId } })).accessState).toBe('PRODUCT');
      expect(await fresh.activationReceipt.count()).toBe(0);
      await fresh.$disconnect();
    } finally {
      await psql(container, 'postgres', `DROP DATABASE IF EXISTS ${freshName} WITH (FORCE)`);
    }
  });

  it('rolls back receipt intent when PUT authorization preparation fails', async () => {
    const admin = await platformAdmin();
    const publish = await request(app.getHttpServer())
      .post('/admin/agreements/versions/publish')
      .set('Authorization', `Bearer ${admin.token}`);
    expect([201, 409]).toContain(publish.status);
    const owner = await acceptOwner(admin.token);
    const first = await upload(owner.token, await receiptJpeg(42));
    const original = await prisma.client.activationReceipt.findUniqueOrThrow({
      where: { id: first.body.receiptId },
    });
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    if (!storage.preparePutObject) {
      throw new Error('Activation storage cannot prepare a put');
    }
    const originalPrepare = storage.preparePutObject.bind(storage);
    const originalPut = storage.putObject.bind(storage);
    const rowCount = await prisma.client.activationReceipt.count({ where: { salonId: owner.salonId } });
    const auditCount = await prisma.client.auditLog.count({
      where: { tenantId: owner.salonId, action: 'ACTIVATION_RECEIPT_STORED' },
    });
    let putCount = 0;
    storage.putObject = async (input) => {
      putCount += 1;
      return originalPut(input);
    };
    storage.preparePutObject = () => {
      throw new InfrastructureError('File storage is temporarily unavailable');
    };
    try {
      await postReceipt(owner.token, await receiptJpeg(43)).then((response) => {
        expect(response.status).toBe(503);
      });
      expect(putCount).toBe(0);
      expect(await prisma.client.activationReceipt.count({ where: { salonId: owner.salonId } }))
        .toBe(rowCount);
      expect(await prisma.client.auditLog.count({
        where: { tenantId: owner.salonId, action: 'ACTIVATION_RECEIPT_STORED' },
      })).toBe(auditCount);
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: original.id } })).phase)
        .toBe('STORED');
      const status = await request(app.getHttpServer())
        .get('/activation/status')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(status.body.receiptReady).toBe(true);
      expect(status.body.receiptId).toBe(original.id);

      storage.preparePutObject = originalPrepare;
      const retried = await upload(owner.token, await receiptJpeg(44));
      expect(putCount).toBe(1);
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: original.id } })).phase)
        .toBe('SUPERSEDED');
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({
        where: { id: retried.body.receiptId },
      })).phase).toBe('STORED');
    } finally {
      storage.preparePutObject = originalPrepare;
      storage.putObject = originalPut;
    }
  });

  it('keeps a stored receipt ready unless the replacement image is verified', async () => {
    const admin = await platformAdmin();
    const publish = await request(app.getHttpServer())
      .post('/admin/agreements/versions/publish')
      .set('Authorization', `Bearer ${admin.token}`);
    expect([201, 409]).toContain(publish.status);
    const owner = await acceptOwner(admin.token);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    if (!storage.preparePutObject) {
      throw new Error('Activation storage cannot prepare a put');
    }
    const originalPut = storage.putObject.bind(storage);
    const originalGet = storage.getObject.bind(storage);
    const originalPrepare = storage.preparePutObject.bind(storage);
    let mode: 'ok' | 'fail' | 'timeout' | 'tamper' | 'hold' = 'ok';
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    storage.preparePutObject = (input) => {
      if (mode === 'timeout') {
        mode = 'ok';
        return { execute: async () => { throw new Error('storage timeout'); } };
      }
      return originalPrepare(input);
    };
    storage.putObject = async (input) => {
      if (mode === 'fail') {
        mode = 'ok';
        throw new InfrastructureError('File storage is temporarily unavailable');
      }
      if (mode === 'hold') {
        mode = 'ok';
        await hold;
      }
      return originalPut(input);
    };
    storage.getObject = async (key) => {
      const found = await originalGet(key);
      if (mode === 'tamper') {
        mode = 'ok';
        return { body: Buffer.from([0x00, 0x01, 0x02]), contentType: found.contentType };
      }
      return found;
    };
    try {
      const first = await upload(owner.token, await receiptJpeg(8));
      const original = await prisma.client.activationReceipt.findUniqueOrThrow({
        where: { id: first.body.receiptId },
      });
      const originalBytes = await storage.getObject(original.objectKey);

      mode = 'fail';
      const failed = await postReceipt(owner.token, await receiptJpeg(9));
      expect(failed.status).toBe(503);
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: original.id } })).phase)
        .toBe('STORED');
      expect(await prisma.client.activationReceipt.count({
        where: { salonId: owner.salonId, phase: 'FAILED' },
      })).toBe(1);
      expect((await storage.getObject(original.objectKey)).body.equals(originalBytes.body)).toBe(true);

      mode = 'timeout';
      const timedOut = await postReceipt(owner.token, await receiptJpeg(10));
      expect(timedOut.status).toBe(503);
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: original.id } })).phase)
        .toBe('STORED');

      mode = 'tamper';
      const unverified = await postReceipt(owner.token, await receiptJpeg(11));
      expect(unverified.status).toBe(503);
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: original.id } })).phase)
        .toBe('STORED');

      const replaced = await upload(owner.token, await receiptJpeg(12));
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: original.id } })).phase)
        .toBe('SUPERSEDED');
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: replaced.body.receiptId } })).phase)
        .toBe('STORED');
      expect((await storage.getObject(original.objectKey)).body.equals(originalBytes.body)).toBe(true);
      const recovered = await request(app.getHttpServer())
        .get('/activation/status')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(recovered.body.receiptReady).toBe(true);
      expect(recovered.body.receiptId).toBe(replaced.body.receiptId);

      mode = 'hold';
      const overlapping = postReceipt(owner.token, await receiptJpeg(13));
      await waitFor(async () => prisma.client.activationReceipt.count({
        where: { salonId: owner.salonId, phase: 'UPLOADING' },
      }).then((count) => count === 1));
      const loser = await postReceipt(owner.token, await receiptJpeg(14));
      expect(loser.status).toBe(409);
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: replaced.body.receiptId } })).phase)
        .toBe('STORED');
      releaseHold();
      const winner = await overlapping;
      expect(winner.status).toBe(201);
      expect(await prisma.client.activationReceipt.count({
        where: { salonId: owner.salonId, phase: 'STORED' },
      })).toBe(1);
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: replaced.body.receiptId } })).phase)
        .toBe('SUPERSEDED');

      const duplicateId = createId();
      const duplicateDigest = createHash('sha256').update(await receiptJpeg(15)).digest('hex');
      const storedIndex = await prisma.client.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes WHERE indexname = 'activation_receipts_one_stored'
      `;
      expect(storedIndex[0]?.indexdef).toContain("phase");
      expect(storedIndex[0]?.indexdef).toContain("STORED");
      await expect(prisma.client.$executeRaw`
        INSERT INTO activation_receipts (
          id, salon_id, user_id, agreement_acceptance_id, object_key, content_type,
          byte_size, sha256, phase, stored_at, updated_at
        )
        SELECT ${duplicateId}::uuid, salon_id, user_id, agreement_acceptance_id,
               ${`activation-receipts/${owner.salonId}/${duplicateId}`}, content_type,
               byte_size, ${duplicateDigest}, 'STORED'::"ActivationReceiptPhase",
               clock_timestamp(), clock_timestamp()
        FROM activation_receipts
        WHERE salon_id = ${owner.salonId}::uuid AND phase = 'STORED'::"ActivationReceiptPhase"
      `).rejects.toThrow(/23505/);
      expect(await prisma.client.activationReceipt.count({
        where: { salonId: owner.salonId, phase: 'STORED' },
      })).toBe(1);

      const current = await prisma.client.activationReceipt.findFirstOrThrow({
        where: { salonId: owner.salonId, phase: 'STORED' },
      });
      const crashedId = createId();
      const crashedKey = `activation-receipts/${owner.salonId}/${crashedId}`;
      const crashedBytes = await receiptJpeg(16);
      await storage.putObject({ key: crashedKey, body: crashedBytes, contentType: 'image/jpeg' });
      await prisma.client.$executeRaw`
        INSERT INTO activation_receipts (
          id, salon_id, user_id, agreement_acceptance_id, object_key, content_type,
          byte_size, sha256, phase, created_at, updated_at
        )
        SELECT ${crashedId}::uuid, salon_id, user_id, agreement_acceptance_id, ${crashedKey},
               'image/jpeg', ${crashedBytes.length}, ${createHash('sha256').update(crashedBytes).digest('hex')},
               'UPLOADING'::"ActivationReceiptPhase",
               clock_timestamp() - interval '2 minutes', clock_timestamp()
        FROM activation_receipts
        WHERE id = ${current.id}::uuid
      `;
      const duringCrash = await request(app.getHttpServer())
        .get('/activation/status')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(duringCrash.body.receiptReady).toBe(true);
      expect(duringCrash.body.receiptId).toBe(current.id);
      await request(app.getHttpServer())
        .post(`/activation/receipts/${crashedId}/submit`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Idempotency-Key', `crashed-${randomUUID()}`)
        .expect(409);
      expect((await storage.getObject(crashedKey)).body.equals(crashedBytes)).toBe(true);
      expect((await storage.getObject(current.objectKey)).body.length).toBeGreaterThan(10);

      const afterRestart = await upload(owner.token, await receiptJpeg(17));
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: crashedId } })).phase)
        .toBe('FAILED');
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: current.id } })).phase)
        .toBe('SUPERSEDED');
      expect(afterRestart.body.phase).toBe('STORED');
      expect((await storage.getObject(crashedKey)).body.equals(crashedBytes)).toBe(true);
      expect(await prisma.client.activationReceipt.count({
        where: { salonId: owner.salonId, phase: 'STORED' },
      })).toBe(1);
    } finally {
      storage.putObject = originalPut;
      storage.getObject = originalGet;
      storage.preparePutObject = originalPrepare;
    }
  });

  it('commits the stored phase and success audit together, and leaves an honest orphan when that audit fails', async () => {
    const admin = await platformAdmin();
    const publish = await request(app.getHttpServer())
      .post('/admin/agreements/versions/publish')
      .set('Authorization', `Bearer ${admin.token}`);
    expect([201, 409]).toContain(publish.status);
    const owner = await acceptOwner(admin.token);
    const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    if (!storage.preparePutObject) {
      throw new Error('Activation storage cannot prepare a put');
    }
    const originalPut = storage.putObject.bind(storage);
    const originalGet = storage.getObject.bind(storage);
    const originalDelete = storage.deleteObject.bind(storage);
    const deletedKeys: string[] = [];
    let mode: 'ok' | 'fail-put' | 'tamper' = 'ok';
    storage.putObject = async (input) => {
      if (mode === 'fail-put') {
        mode = 'ok';
        throw new InfrastructureError('File storage is temporarily unavailable');
      }
      return originalPut(input);
    };
    storage.getObject = async (key) => {
      const found = await originalGet(key);
      if (mode === 'tamper') {
        mode = 'ok';
        return { body: Buffer.from([0x00, 0x01, 0x02]), contentType: found.contentType };
      }
      return found;
    };
    storage.deleteObject = async (key) => {
      deletedKeys.push(key);
      await originalDelete(key);
    };
    const firstBody = await receiptJpeg(21);
    const replacementBody = await receiptJpeg(22);
    try {
      const first = await upload(owner.token, firstBody);
      const firstRow = await prisma.client.activationReceipt.findUniqueOrThrow({
        where: { id: first.body.receiptId },
      });
      const firstAudit = await storedAudits(owner.salonId);
      expect(await prisma.client.activationReceipt.count({
        where: { salonId: owner.salonId, phase: 'STORED' },
      })).toBe(1);
      expect(firstAudit).toHaveLength(1);
      expect(firstAudit[0]).toMatchObject({
        resourceId: firstRow.id,
        result: 'SUCCESS',
        metadata: {
          agreementAcceptanceId: firstRow.agreementAcceptanceId,
          objectKey: firstRow.objectKey,
          sha256: createHash('sha256').update(firstBody).digest('hex'),
          byteSize: firstBody.length,
          contentType: 'image/jpeg',
        },
      });

      const beforeFailure = new Set((await prisma.client.activationReceipt.findMany({
        where: { salonId: owner.salonId },
        select: { id: true },
      })).map((row) => row.id));
      mode = 'fail-put';
      const failedPut = await postReceipt(owner.token, await receiptJpeg(23));
      expect(failedPut.status).toBe(503);
      const failedPutRow = await onlyNewReceipt(owner.salonId, beforeFailure);
      expect(failedPutRow.phase).toBe('FAILED');
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: firstRow.id } })).phase)
        .toBe('STORED');
      expect(await storedAudits(owner.salonId)).toHaveLength(1);
      expect(await prisma.client.auditLog.count({
        where: { resourceId: failedPutRow.id, action: 'ACTIVATION_RECEIPT_STORED' },
      })).toBe(0);
      expect(deletedKeys).not.toContain(firstRow.objectKey);

      const beforeTamper = new Set((await prisma.client.activationReceipt.findMany({
        where: { salonId: owner.salonId },
        select: { id: true },
      })).map((row) => row.id));
      mode = 'tamper';
      const unverified = await postReceipt(owner.token, await receiptJpeg(24));
      expect(unverified.status).toBe(503);
      const unverifiedRow = await onlyNewReceipt(owner.salonId, beforeTamper);
      expect(unverifiedRow.phase).toBe('FAILED');
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: firstRow.id } })).phase)
        .toBe('STORED');
      expect(await storedAudits(owner.salonId)).toHaveLength(1);
      expect(await prisma.client.auditLog.count({
        where: { resourceId: unverifiedRow.id, action: 'ACTIVATION_RECEIPT_STORED' },
      })).toBe(0);
      expect(deletedKeys).toContain(unverifiedRow.objectKey);
      expect(deletedKeys).not.toContain(firstRow.objectKey);
      await expect(storage.getObject(unverifiedRow.objectKey)).rejects.toThrow();
      expect((await storage.getObject(firstRow.objectKey)).body.equals(firstBody)).toBe(true);

      const replacement = await upload(owner.token, replacementBody);
      const replacementRow = await prisma.client.activationReceipt.findUniqueOrThrow({
        where: { id: replacement.body.receiptId },
      });
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: firstRow.id } })).phase)
        .toBe('SUPERSEDED');
      expect(replacementRow.phase).toBe('STORED');
      const replacementAudits = await storedAudits(owner.salonId);
      expect(replacementAudits.map((audit) => audit.resourceId).sort()).toEqual(
        [firstRow.id, replacementRow.id].sort(),
      );
      expect(replacementAudits.find((audit) => audit.resourceId === replacementRow.id)).toMatchObject({
        result: 'SUCCESS',
        metadata: {
          agreementAcceptanceId: replacementRow.agreementAcceptanceId,
          objectKey: replacementRow.objectKey,
          sha256: createHash('sha256').update(replacementBody).digest('hex'),
          byteSize: replacementBody.length,
          contentType: 'image/jpeg',
        },
      });
      expect(await prisma.client.activationReceipt.count({
        where: { salonId: owner.salonId, phase: 'STORED' },
      })).toBe(1);

      await psql(container, databaseName, `
        CREATE OR REPLACE FUNCTION refuse_activation_receipt_stored_audit()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          IF NEW.action = 'ACTIVATION_RECEIPT_STORED' THEN
            RAISE EXCEPTION 'activation receipt stored audit refused';
          END IF;
          RETURN NEW;
        END;
        $fn$;
        CREATE TRIGGER refuse_activation_receipt_stored_audit
        BEFORE INSERT ON audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION refuse_activation_receipt_stored_audit();
      `);
      const beforeAuditFailure = new Set((await prisma.client.activationReceipt.findMany({
        where: { salonId: owner.salonId },
        select: { id: true },
      })).map((row) => row.id));
      const deletedBeforeOrphan = deletedKeys.length;
      const refused = await postReceipt(owner.token, await receiptJpeg(25));
      expect(refused.status).toBe(500);
      const orphan = await onlyNewReceipt(owner.salonId, beforeAuditFailure);
      expect(JSON.stringify(refused.body)).not.toContain(orphan.id);
      expect(orphan.phase).toBe('UPLOADING');
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: replacementRow.id } })).phase)
        .toBe('STORED');
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: firstRow.id } })).phase)
        .toBe('SUPERSEDED');
      expect(await prisma.client.activationReceipt.count({
        where: { salonId: owner.salonId, phase: 'STORED' },
      })).toBe(1);
      expect(await storedAudits(owner.salonId)).toHaveLength(2);
      expect(await prisma.client.auditLog.count({
        where: { resourceId: orphan.id, action: 'ACTIVATION_RECEIPT_STORED' },
      })).toBe(0);
      expect(deletedKeys).toHaveLength(deletedBeforeOrphan);
      expect(deletedKeys).not.toContain(orphan.objectKey);
      expect((await storage.getObject(orphan.objectKey)).body.length).toBe(orphan.byteSize);
      const ready = await request(app.getHttpServer())
        .get('/activation/status')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(ready.body.receiptReady).toBe(true);
      expect(ready.body.receiptId).toBe(replacementRow.id);
      await request(app.getHttpServer())
        .post(`/activation/receipts/${orphan.id}/submit`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Idempotency-Key', `orphan-${randomUUID()}`)
        .expect(409);
      expect((await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: orphan.id } })).phase)
        .toBe('UPLOADING');
      expect((await storage.getObject(orphan.objectKey)).body.length).toBe(orphan.byteSize);
      // The object and UPLOADING row are the crash window after a committed PUT
      // and before the phase transaction. This test does not retry the upload
      // or delete the object. A later upload may mark a row older than 60 seconds
      // FAILED and still leave the object in storage.
    } finally {
      storage.putObject = originalPut;
      storage.getObject = originalGet;
      storage.deleteObject = originalDelete;
      await psql(container, databaseName, `
        DROP TRIGGER IF EXISTS refuse_activation_receipt_stored_audit ON audit_logs;
        DROP FUNCTION IF EXISTS refuse_activation_receipt_stored_audit();
      `);
    }
  });

  it('stores a decoded receipt through the disposable S3 adapter', async () => {
    const endpoint = process.env.ACTIVATION_DISPOSABLE_MINIO_ENDPOINT ?? '';
    const port = Number(process.env.ACTIVATION_DISPOSABLE_MINIO_PORT ?? '0');
    const bucket = process.env.ACTIVATION_DISPOSABLE_MINIO_BUCKET ?? '';
    const accessKey = process.env.ACTIVATION_DISPOSABLE_MINIO_ACCESS_KEY ?? '';
    const secretKey = process.env.ACTIVATION_DISPOSABLE_MINIO_SECRET_KEY ?? '';
    if (!endpoint || !port || !bucket || !accessKey || !secretKey) {
      throw new Error('Disposable MinIO identity is required for the S3 receipt smoke');
    }
    const rows = await prisma.client.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    expect(rows[0]?.current_database).toBe(databaseName);
    expect(databaseName.startsWith('salon_activation_')).toBe(true);
    expect(['salon', 'salon_preview']).not.toContain(databaseName);
    expect(endpoint).toBe('127.0.0.1');
    expect(port).not.toBe(9000);
    expect(bucket.startsWith('salon-activation-')).toBe(true);
    expect(bucket).not.toBe('salon-platform');
    console.info(`activation smoke database=${databaseName} minio=${endpoint}:${port} bucket=${bucket}`);

    const s3 = new S3CompatibleObjectStorage({
      MINIO_ENDPOINT: endpoint,
      MINIO_PORT: port,
      MINIO_USE_SSL: false,
      MINIO_ACCESS_KEY: accessKey,
      MINIO_SECRET_KEY: secretKey,
      MINIO_BUCKET: bucket,
      MINIO_REQUEST_TIMEOUT_MS: 10_000,
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(s3)
      .compile();
    const s3App = moduleRef.createNestApplication();
    configure(s3App);
    await s3App.init();
    try {
      const admin = await platformAdmin();
      const publish = await request(app.getHttpServer())
        .post('/admin/agreements/versions/publish')
        .set('Authorization', `Bearer ${admin.token}`);
      expect([201, 409]).toContain(publish.status);
      const owner = await acceptOwner(admin.token);
      const body = await receiptJpeg(40);
      const uploaded = await request(s3App.getHttpServer())
        .post('/activation/receipts')
        .set('Authorization', `Bearer ${owner.token}`)
        .attach('file', body, 'receipt.jpg')
        .expect(201);
      const row = await prisma.client.activationReceipt.findUniqueOrThrow({
        where: { id: uploaded.body.receiptId as string },
      });
      const digest = createHash('sha256').update(body).digest('hex');
      expect(row.phase).toBe('STORED');
      expect(row.sha256).toBe(digest);
      expect(row.byteSize).toBe(body.length);
      const storedObject = await s3.getObject(row.objectKey);
      expect(storedObject.body.equals(body)).toBe(true);
      expect(createHash('sha256').update(storedObject.body).digest('hex')).toBe(digest);

      await request(s3App.getHttpServer())
        .post(`/activation/receipts/${row.id}/submit`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Idempotency-Key', `s3-submit-${randomUUID()}`)
        .expect(201);
      const image = await request(s3App.getHttpServer())
        .get(`/admin/activation-receipts/${row.id}/image`)
        .set('Authorization', `Bearer ${admin.token}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(Buffer.isBuffer(image.body)).toBe(true);
      expect((image.body as Buffer).equals(body)).toBe(true);
      const approved = await request(s3App.getHttpServer())
        .post(`/admin/activation-receipts/${row.id}/approve`)
        .set('Authorization', `Bearer ${admin.token}`)
        .set('Idempotency-Key', `s3-approve-${randomUUID()}`)
        .send({ bankAttestation: BANK_TRANSFER_ATTESTATION })
        .expect(201);
      expect(approved.body.phase).toBe('APPROVED');
      expect((await prisma.client.salon.findUniqueOrThrow({ where: { id: owner.salonId } })).accessState)
        .toBe('PRODUCT');

      const orphanKey = `activation-receipts/${owner.salonId}/${createId()}`;
      const orphanBody = await receiptJpeg(41);
      await s3.putObject({ key: orphanKey, body: orphanBody, contentType: 'image/jpeg' });
      expect((await s3.getObject(orphanKey)).body.equals(orphanBody)).toBe(true);
      expect(await prisma.client.activationReceipt.count({ where: { objectKey: orphanKey } })).toBe(0);
      console.info(`orphan object remains s3://${bucket}/${orphanKey}`);
    } finally {
      await s3App.close();
    }
  });

  async function assertApproved(
    owner: { token: string; phone: string; salonId: string },
    receiptId: string,
    adminToken: string,
    approveKey: string,
  ) {
    const salon = await prisma.client.salon.findUniqueOrThrow({ where: { id: owner.salonId } });
    expect(salon.accessState).toBe('PRODUCT');
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403);
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(me.body.accessState).toBe('PRODUCT');
    expect(me.body.sessionScope).toBe('onboarding');
    const polled = await request(app.getHttpServer())
      .get('/activation/status')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(polled.body.phase).toBe('APPROVED');
    expect(polled.body.instructions).toBeNull();
    const exchanged = await request(app.getHttpServer())
      .post('/auth/session/product')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);
    expect(exchanged.body.sessionScope).toBe('product');
    expect(exchanged.body.accessState).toBe('PRODUCT');
    const claims = decode(exchanged.body.accessToken) as { scp?: string };
    expect(claims.scp).toBeUndefined();
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${exchanged.body.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403);
    const relogin = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone: owner.phone, password })
      .expect(201);
    expect(relogin.body.sessionScope).toBe('product');
    expect(relogin.body.accessState).toBe('PRODUCT');
    const audits = await prisma.client.auditLog.findMany({
      where: { resourceId: receiptId, action: 'ACTIVATION_RECEIPT_APPROVED' },
    });
    expect(audits).toHaveLength(1);
    const receipt = await prisma.client.activationReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    expect(receipt.bankAttestationWording).toBe(BANK_TRANSFER_ATTESTATION);
    expect(receipt.decidedByAdminId).toBe(audits[0]?.actorId);
    expect(receipt.decidedAt).toBeInstanceOf(Date);
    expect(audits[0]?.metadata).toEqual(expect.objectContaining({
      idempotencyKey: approveKey,
      decision: 'APPROVE',
      receiptId,
      sha256: receipt.sha256,
      decidedByAdminId: audits[0]?.actorId,
      decidedAt: receipt.decidedAt?.toISOString(),
      bankAttestationWording: BANK_TRANSFER_ATTESTATION,
      attestation: 'MANUAL_PLATFORM_ADMIN',
    }));
    expect(JSON.stringify(audits[0]?.metadata)).not.toContain(MANUAL_TRANSFER_CARD_NUMBER);
    const recorded = await request(app.getHttpServer())
      .get(`/admin/activation-receipts/${receiptId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(recorded.body.bankAttestationWording).toBe(BANK_TRANSFER_ATTESTATION);
    expect(recorded.body.requiredBankAttestation).toBeNull();
  }

  async function storedAudits(salonId: string) {
    return prisma.client.auditLog.findMany({
      where: { tenantId: salonId, action: 'ACTIVATION_RECEIPT_STORED' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function onlyNewReceipt(salonId: string, before: Set<string>) {
    const rows = await prisma.client.activationReceipt.findMany({ where: { salonId } });
    const created = rows.filter((row) => !before.has(row.id));
    expect(created).toHaveLength(1);
    return created[0]!;
  }

  async function postReceipt(token: string, body: Buffer) {
    return request(app.getHttpServer())
      .post('/activation/receipts')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', body, 'receipt.jpg');
  }

  async function upload(token: string, body: Buffer) {
    return request(app.getHttpServer())
      .post('/activation/receipts')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', body, 'receipt.jpg')
      .expect(201);
  }

  async function acceptOwner(adminToken: string) {
    const owner = await phoneOwner();
    const token = await login(owner.phone);
    const presented = await request(app.getHttpServer())
      .post('/agreement/presentations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'نرگس رضایی',
        nationalId: national,
        salonName: 'سالن قرارداد',
        phone: owner.phone,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/agreement/acceptance')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `accept-${randomUUID()}`)
      .send({ presentationId: presented.body.presentationId, accepted: true })
      .expect(201);
    void adminToken;
    return { ...owner, token };
  }

  async function phoneOwner() {
    const phone = `0912${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const salonId = createId();
    const userId = createId();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.client.$transaction(async (tx) => {
      await provisionSalonOwner(tx, {
        salonId,
        userId,
        salonName: 'سالن قرارداد',
        ownerName: 'نرگس رضایی',
        passwordHash,
        email: null,
        phone,
        accessState: 'AWAITING_AGREEMENT',
        additionalUsersAllowed: false,
        now: new Date(),
      });
      await tx.phoneOwnerCompletion.create({
        data: {
          id: createId(),
          idempotencyKey: `completion-${randomUUID()}`,
          requestHash: 'a'.repeat(64),
          salonId,
          userId,
        },
      });
    });
    return { phone, salonId, userId };
  }

  async function login(phone: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone, password })
      .expect(201);
    return response.body.accessToken as string;
  }

  async function legacyOwner() {
    const email = `legacy-${randomUUID()}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ salonName: 'Legacy Salon', ownerName: 'Legacy Owner', email, password })
      .expect(201);
    return {
      token: response.body.accessToken as string,
      salonId: response.body.user.tenantId as string,
    };
  }

  async function platformAdmin() {
    const email = `admin-${randomUUID()}@example.com`;
    const id = createId();
    await prisma.client.platformAdmin.create({
      data: {
        id,
        email,
        name: 'Activation Operator',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        updatedAt: new Date(),
      },
    });
    const response = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password })
      .expect(201);
    return { id, token: response.body.accessToken as string };
  }
});

const ACTIVATION_TOO_BIG = 5 * 1024 * 1024 + 1;

async function receiptJpeg(seed: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: (seed * 17) & 255, g: (seed * 29) & 255, b: (seed * 43) & 255 },
    },
  }).jpeg().toBuffer();
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

function migrateDeploy(url: string): Promise<void> {
  const target = new URL(url);
  const database = target.pathname.replace(/^\//, '');
  if (!/^salon_activation_[a-z0-9_]+$/.test(database)) {
    throw new Error('Refusing to migrate an unexpected database');
  }
  return new Promise((resolve, reject) => {
    execFile(
      'pnpm',
      ['--dir', path.resolve(__dirname, '../../../packages/database'), 'exec', 'prisma', 'migrate', 'deploy'],
      { env: { ...process.env, DATABASE_URL: url }, maxBuffer: 20_000_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message));
          return;
        }
        resolve();
      },
    );
  });
}

async function waitFor(ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await ready()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the overlapping receipt upload');
}

function psql(containerName: string, database: string, sql: string): Promise<void> {
  if (!/^salon_activation_[a-z0-9_]+$/.test(database) && database !== 'postgres') {
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

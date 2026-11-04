import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import sharp from 'sharp';
import { createPrismaClient } from '@salon/database';
import { S3CompatibleObjectStorage, type ObjectStorage, type StoredObject } from '@salon/object-storage';
import { AppModule } from '../src/app.module';
import { ACTIVATION_RECEIPT_OBJECT_STORAGE, ActivationReceiptRecoveryProcessor } from '../../worker/src/activation/activation-receipt-recovery.processor';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';

const databaseUrl = process.env.GATE3_ISOLATED_DATABASE_URL;
const adminUrl = process.env.GATE3_ADMIN_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : '';
const ready = Boolean(
  databaseUrl
  && adminUrl
  && databaseUrl === process.env.DATABASE_URL
  && /^salon_activation_/.test(databaseName)
  && process.env.GATE3_MINIO_ACCESS_KEY
  && process.env.GATE3_MINIO_SECRET_KEY,
);
const describeIfReady = ready ? describe : describe.skip;

class CountingStorage implements ObjectStorage {
  readonly deletes: string[] = [];

  constructor(private readonly delegate: S3CompatibleObjectStorage) {}

  putObject(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    return this.delegate.putObject(input);
  }

  preparePutObject(input: { key: string; body: Buffer; contentType: string; expiresAt: Date }) {
    return this.delegate.preparePutObject(input);
  }

  getObject(key: string) { return this.delegate.getObject(key); }

  async deleteObject(key: string): Promise<void> {
    this.deletes.push(key);
    await this.delegate.deleteObject(key);
  }
}

describeIfReady('activation receipt HTTP interruption recovery', () => {
  jest.setTimeout(90_000);
  const appDb = createPrismaClient(databaseUrl!);
  const adminDb = createPrismaClient(adminUrl!);
  const storage = new CountingStorage(new S3CompatibleObjectStorage({
    MINIO_ENDPOINT: process.env.GATE3_MINIO_HOST!,
    MINIO_PORT: Number(process.env.GATE3_MINIO_PORT),
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: process.env.GATE3_MINIO_ACCESS_KEY!,
    MINIO_SECRET_KEY: process.env.GATE3_MINIO_SECRET_KEY!,
    MINIO_BUCKET: process.env.GATE3_MINIO_BUCKET!,
    MINIO_REQUEST_TIMEOUT_MS: 2_000,
  }));
  const ids = {
    salonId: randomUUID(), userId: randomUUID(), adminId: randomUUID(), versionId: randomUUID(),
    presentationId: randomUUID(), acceptanceId: randomUUID(), previousId: randomUUID(),
  };
  let child: ChildProcess | undefined;
  let createdVersion = false;

  beforeAll(async () => {
    await Promise.all([appDb.$connect(), adminDb.$connect()]);
    const probe = await appDb.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    if (probe[0]?.current_database !== databaseName) throw new Error('Refusing an unexpected interruption-test database');
  });

  afterAll(async () => {
    await stopChild(child);
    await removeFixture();
    await Promise.all([appDb.$disconnect(), adminDb.$disconnect()]);
  });

  it('quarantines a real HTTP replacement after its child dies at the verified-object boundary', async () => {
    const previous = await seedFixture();
    const token = sign(
      { sub: ids.userId, tid: ids.salonId, role: 'OWNER', scp: 'onboarding' },
      process.env.JWT_SECRET!,
      { expiresIn: '5m', jwtid: randomUUID() },
    );
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 22, g: 66, b: 99 } },
    }).jpeg().toBuffer();
    child = fork(path.join(__dirname, 'support', 'activation-receipt-interruption-child.ts'), [], {
      cwd: path.join(__dirname, '..'),
      execArgv: ['-r', 'ts-node/register/transpile-only'],
      env: {
        ...process.env,
        ACTIVATION_INTERRUPT_TEST_TOKEN: token,
        ACTIVATION_INTERRUPT_TEST_IMAGE_BASE64: image.toString('base64'),
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    await waitForBoundary(child);
    const uploading = await appDb.activationReceipt.findFirstOrThrow({
      where: { salonId: ids.salonId, phase: 'UPLOADING' },
      orderBy: { createdAt: 'desc' },
    });
    expect((await storage.getObject(uploading.objectKey)).body).toEqual(image);

    child.kill('SIGKILL');
    await once(child, 'exit');
    child = undefined;

    await adminDb.activationReceipt.update({
      where: { id: uploading.id },
      data: { uploadLockedUntil: new Date(Date.now() - 1_000) },
    });
    const config = new AppConfigService();
    const recovery = new ActivationReceiptRecoveryProcessor(
      { client: appDb } as PrismaService,
      { values: { ...config.values, ACTIVATION_RECEIPT_AUTOMATIC_CLEANUP_ENABLED: false } } as AppConfigService,
      storage,
    );
    await recovery.tick(new Date());

    const failed = await appDb.activationReceipt.findUniqueOrThrow({ where: { id: uploading.id } });
    expect(failed).toMatchObject({ phase: 'FAILED', uploadLastErrorCode: 'LEASE_EXPIRED', uploadOwnerToken: null });
    expect(await appDb.activationReceiptUploadCleanup.count({ where: { receiptId: uploading.id } })).toBe(1);
    expect((await storage.getObject(uploading.objectKey)).body).toEqual(image);
    expect(storage.deletes).toEqual([]);
    expect(await appDb.activationReceipt.findUniqueOrThrow({ where: { id: previous.id } })).toMatchObject({ phase: 'STORED' });
    expect(await appDb.auditLog.count({ where: { resourceId: uploading.id, action: 'ACTIVATION_RECEIPT_STORED' } })).toBe(0);
    expect(await appDb.activationReceipt.count({ where: { id: previous.id, phase: 'SUPERSEDED' } })).toBe(0);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE).useValue(storage)
      .compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    try {
      await app.init();
      await request(app.getHttpServer())
        .get(`/activation/receipts/${previous.id}/image`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect('content-type', /image\/jpeg/);
    } finally {
      await app.close();
    }
  });

  async function seedFixture(): Promise<{ id: string; objectKey: string }> {
    const now = new Date();
    const previousImage = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 4, g: 5, b: 6 } },
    }).jpeg().toBuffer();
    const previousKey = `activation-receipts/${ids.salonId}/${ids.previousId}`;
    await storage.putObject({ key: previousKey, body: previousImage, contentType: 'image/jpeg' });
    await adminDb.$transaction(async (tx) => {
      await tx.salon.create({ data: { id: ids.salonId, name: 'Fixture salon', status: 'ACTIVE', accessState: 'AWAITING_PAYMENT', additionalUsersAllowed: false } });
      await tx.user.create({ data: { id: ids.userId, salonId: ids.salonId, name: 'Fixture owner', phone: `0912${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`, passwordHash: 'fixture', role: 'OWNER', status: 'ACTIVE' } });
      await tx.platformAdmin.create({ data: { id: ids.adminId, name: 'Fixture admin', phone: `0935${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`, passwordHash: 'fixture', status: 'ACTIVE' } });
      const contract = await tx.agreementVersion.findUnique({ where: { versionKey: 'CONTRACT_V1' } });
      if (contract) {
        ids.versionId = contract.id;
      } else {
        // The payment contract is intentionally CONTRACT_V1; it is the precise accepted-version rule exercised by upload.
        await tx.agreementVersion.create({ data: { id: ids.versionId, versionKey: 'CONTRACT_V1', templateDigest: 'a'.repeat(64), canonicalText: 'fixture', checkboxWording: 'fixture', buttonWording: 'fixture', amountIrr: '50000000.00', scopeSnapshot: {}, publishedByAdminId: ids.adminId } });
        createdVersion = true;
      }
      await tx.agreementPresentation.create({ data: { id: ids.presentationId, salonId: ids.salonId, userId: ids.userId, versionId: ids.versionId, renderedDigest: 'b'.repeat(64), evidenceKeyId: 'fixture', declaredFieldsCiphertext: Buffer.alloc(17), declaredFieldsNonce: Buffer.alloc(12), renderedDocumentCiphertext: Buffer.alloc(17), renderedDocumentNonce: Buffer.alloc(12), expiresAt: new Date(now.getTime() + 60_000) } });
      await tx.agreementAcceptance.create({ data: { id: ids.acceptanceId, salonId: ids.salonId, userId: ids.userId, versionId: ids.versionId, presentationId: ids.presentationId, templateDigest: 'a'.repeat(64), renderedDigest: 'b'.repeat(64), snapshotDigest: 'c'.repeat(64), checkboxWording: 'fixture', buttonWording: 'fixture', checkboxConfirmed: true, acceptedAt: now, sessionJti: randomUUID(), clientIp: null, clientIpSource: 'socket', userAgent: null, appVersion: null, appBuild: null, apiRevision: 'fixture', requestId: 'fixture-request', correlationId: 'fixture-correlation', amountIrr: '50000000.00', scopeSnapshot: {}, evidenceKeyId: 'fixture', snapshotCiphertext: Buffer.alloc(17), snapshotNonce: Buffer.alloc(12) } });
      await tx.activationReceipt.create({ data: { id: ids.previousId, salonId: ids.salonId, userId: ids.userId, agreementAcceptanceId: ids.acceptanceId, objectKey: previousKey, contentType: 'image/jpeg', byteSize: previousImage.length, sha256: createHash('sha256').update(previousImage).digest('hex'), phase: 'STORED', storedAt: now } });
    });
    return { id: ids.previousId, objectKey: previousKey };
  }

  async function removeFixture(): Promise<void> {
    if (!ready) return;
    await adminDb.$transaction(async (tx) => {
      // The disposable fixture is removed with triggers disabled only after the
      // test has asserted retained history; production receipts are immutable.
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.auditLog.deleteMany({ where: { tenantId: ids.salonId } });
      await tx.activationReceiptUploadCleanup.deleteMany({ where: { receipt: { salonId: ids.salonId } } });
      await tx.activationReceipt.deleteMany({ where: { salonId: ids.salonId } });
      await tx.agreementAcceptance.deleteMany({ where: { salonId: ids.salonId } });
      await tx.agreementPresentation.deleteMany({ where: { salonId: ids.salonId } });
      if (createdVersion) await tx.agreementVersion.deleteMany({ where: { id: ids.versionId } });
      await tx.user.deleteMany({ where: { salonId: ids.salonId } });
      await tx.salon.deleteMany({ where: { id: ids.salonId } });
      await tx.platformAdmin.deleteMany({ where: { id: ids.adminId } });
    });
  }
});

async function waitForBoundary(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let diagnostic = '';
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the verified-object lifecycle boundary')), 30_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('message', (message: unknown) => {
      const row = message as { type?: string; message?: string; stage?: string; status?: number; requestId?: string | null; errorCode?: string | null; operation?: string; exceptionType?: string; code?: string | null; prismaCode?: string | null; constraint?: string | null };
      if (row.type === 'activation-receipt-object-verified') { clearTimeout(timer); resolve(); }
      if (row.type === 'activation-receipt-child-exception') {
        diagnostic = ` operation=${row.operation} type=${row.exceptionType} code=${row.code ?? 'none'} prisma=${row.prismaCode ?? 'none'} constraint=${row.constraint ?? 'none'}`;
      }
      if (row.type === 'activation-receipt-child-filter') {
        diagnostic = ` filterType=${row.exceptionType} code=${row.code ?? 'none'} prisma=${row.prismaCode ?? 'none'} constraint=${row.constraint ?? 'none'}`;
      }
      if (row.type === 'activation-receipt-child-http-error') {
        clearTimeout(timer);
        reject(new Error(`Child upload failed stage=${row.stage} status=${row.status} code=${row.errorCode ?? 'none'} request=${row.requestId ?? 'none'}${diagnostic}`));
      }
      if (row.type === 'activation-receipt-child-error') { clearTimeout(timer); reject(new Error(`Child failed: ${row.message ?? 'unknown'}`)); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Child exited before lifecycle boundary (${code ?? 'signal'})`)); });
  });
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill('SIGKILL');
  await once(child, 'exit');
}

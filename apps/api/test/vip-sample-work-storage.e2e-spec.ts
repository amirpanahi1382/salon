import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { AppConfig } from '@salon/config';
import type { ObjectStorage, StoredObject } from '@salon/object-storage';
import { S3CompatibleObjectStorage } from '@salon/object-storage';
import { InfrastructureError } from '@salon/shared';
import pino from 'pino';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';
import { VipSampleWorkRecoveryProcessor } from '../../worker/src/vip/vip-sample-work-recovery.processor';

const isolatedUrl = process.env.PHASE10_ISOLATED_DATABASE_URL;
const describeIfDisposable = isolatedUrl && isolatedUrl === process.env.DATABASE_URL &&
  process.env.PHASE10_MINIO_HOST ? describe : describe.skip;

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
  0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0xff, 0xd9,
]);

type DelayedPut = { started: Promise<void>; proceed: () => void };

class FaultInjectingRealStorage implements ObjectStorage {
  readonly writtenKeys: string[] = [];
  private delayed: { started: () => void; proceed: Promise<void> } | undefined;
  private failAfterNextDelete = false;

  constructor(readonly delegate: S3CompatibleObjectStorage) {}

  delayNextPutThenFailAfterWrite(): DelayedPut {
    let started!: () => void;
    let proceed!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const proceedPromise = new Promise<void>((resolve) => { proceed = resolve; });
    this.delayed = { started, proceed: proceedPromise };
    return { started: startedPromise, proceed };
  }

  failNextDeleteAfterStorageCall(): void {
    this.failAfterNextDelete = true;
  }

  async putObject(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    const delayed = this.delayed;
    this.delayed = undefined;
    if (delayed) {
      delayed.started();
      await delayed.proceed;
      const written = await this.delegate.putObject(input);
      this.writtenKeys.push(input.key);
      throw new InfrastructureError('Injected process exit after PUT');
    }
    const written = await this.delegate.putObject(input);
    this.writtenKeys.push(input.key);
    return written;
  }

  getObject(key: string) { return this.delegate.getObject(key); }
  async deleteObject(key: string): Promise<void> {
    await this.delegate.deleteObject(key);
    if (this.failAfterNextDelete) {
      this.failAfterNextDelete = false;
      throw new InfrastructureError('Injected ambiguous DELETE timeout');
    }
  }
}

describeIfDisposable('VIP sample-work real PostgreSQL + MinIO lifecycle', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let storage: FaultInjectingRealStorage;

  beforeAll(async () => {
    const real = new S3CompatibleObjectStorage({
      MINIO_ENDPOINT: process.env.PHASE10_MINIO_HOST!,
      MINIO_PORT: Number(process.env.PHASE10_MINIO_PORT),
      MINIO_USE_SSL: false,
      MINIO_ACCESS_KEY: process.env.PHASE10_MINIO_ACCESS_KEY!,
      MINIO_SECRET_KEY: process.env.PHASE10_MINIO_SECRET_KEY!,
      MINIO_BUCKET: process.env.PHASE10_MINIO_BUCKET!,
      MINIO_REQUEST_TIMEOUT_MS: 2_000,
    });
    storage = new FaultInjectingRealStorage(real);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE).useValue(storage).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function fixture(label: string) {
    const now = new Date();
    const adminId = randomUUID(), salonId = randomUUID(), userId = randomUUID();
    const listId = randomUUID(), requestId = randomUUID();
    await prisma.client.platformAdmin.create({ data: {
      id: adminId, email: `${label}-${adminId}@example.test`, name: label, passwordHash: 'test', updatedAt: now,
    } });
    await prisma.client.salon.create({ data: { id: salonId, name: label, updatedAt: now } });
    await prisma.client.user.create({ data: {
      id: userId, salonId, name: 'Owner', email: `${label}-${userId}@example.test`,
      passwordHash: 'test', role: 'OWNER', updatedAt: now,
    } });
    await prisma.client.vipTargetList.create({ data: {
      id: listId, name: label, status: 'IN_USE', contactCount: 30, createdByAdminId: adminId,
      reservedBySalonId: salonId, reservedAt: now, updatedAt: now,
    } });
    await prisma.client.vipRequest.create({ data: {
      id: requestId, salonId, listId, createdByUserId: userId, requestedCount: 30,
      geographicRange: label, status: 'AWAITING_SAMPLE_WORK',
      reservedUntil: new Date(now.getTime() + 600_000), updatedAt: now,
    } });
    const token = await jwt.signAsync({ sub: userId, tid: salonId, role: 'OWNER' });
    return { requestId, salonId, token };
  }

  function upload(token: string, requestId: string, key: string, bytes = JPEG) {
    return request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/sample-works`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .attach('file', bytes, 'work.jpg');
  }

  it('uploads, verifies, downloads, replays, rejects a conflicting payload, and submits', async () => {
    const f = await fixture('real-success');
    const key = `upload-${randomUUID()}`;
    const first = await upload(f.token, f.requestId, key).expect(201);
    const sampleId = first.body.sampleWorks[0].id as string;
    const sample = await prisma.client.vipSampleWork.findUniqueOrThrow({ where: { id: sampleId } });
    expect(sample.verifiedAt).not.toBeNull();

    const writes = storage.writtenKeys.length;
    await upload(f.token, f.requestId, key).expect(201);
    expect(storage.writtenKeys).toHaveLength(writes);
    expect(await prisma.client.vipSampleWork.count({ where: { vipRequestId: f.requestId } })).toBe(1);

    const conflicting = Buffer.from(JPEG);
    conflicting[8] = conflicting[8]! ^ 1;
    await upload(f.token, f.requestId, key, conflicting).expect(409);
    expect(storage.writtenKeys).toHaveLength(writes);
    expect(await prisma.client.vipSampleWork.count({ where: { vipRequestId: f.requestId } })).toBe(1);

    const downloaded = await request(app.getHttpServer())
      .get(`/vip/sample-works/${sampleId}`).set('Authorization', `Bearer ${f.token}`).expect(200);
    expect(Buffer.from(downloaded.body)).toEqual(JPEG);
    await request(app.getHttpServer()).post(`/vip/requests/${f.requestId}/submit`)
      .set('Authorization', `Bearer ${f.token}`).set('Idempotency-Key', `submit-${randomUUID()}`)
      .expect(201).expect((response) => expect(response.body.status).toBe('SUBMITTED'));
  });

  it('does not serve or submit missing and corrupted objects', async () => {
    const missing = await fixture('real-missing');
    const uploaded = await upload(missing.token, missing.requestId, `missing-${randomUUID()}`).expect(201);
    const missingId = uploaded.body.sampleWorks[0].id as string;
    const missingRow = await prisma.client.vipSampleWork.findUniqueOrThrow({ where: { id: missingId } });
    await storage.delegate.deleteObject(missingRow.objectKey);
    await request(app.getHttpServer()).get(`/vip/sample-works/${missingId}`)
      .set('Authorization', `Bearer ${missing.token}`).expect(503);
    await request(app.getHttpServer()).post(`/vip/requests/${missing.requestId}/submit`)
      .set('Authorization', `Bearer ${missing.token}`).set('Idempotency-Key', `submit-${randomUUID()}`)
      .expect(503);

    const corrupt = await fixture('real-corrupt');
    const corruptUpload = await upload(corrupt.token, corrupt.requestId, `corrupt-${randomUUID()}`).expect(201);
    const corruptId = corruptUpload.body.sampleWorks[0].id as string;
    const corruptRow = await prisma.client.vipSampleWork.findUniqueOrThrow({ where: { id: corruptId } });
    await storage.delegate.putObject({ key: corruptRow.objectKey, body: Buffer.from('corrupt'), contentType: 'image/jpeg' });
    await request(app.getHttpServer()).get(`/vip/sample-works/${corruptId}`)
      .set('Authorization', `Bearer ${corrupt.token}`).expect(503);
    await request(app.getHttpServer()).post(`/vip/requests/${corrupt.requestId}/submit`)
      .set('Authorization', `Bearer ${corrupt.token}`).set('Idempotency-Key', `submit-${randomUUID()}`)
      .expect(503);
  });

  it('recovers after process exit, deletes the late old PUT, and preserves the newer committed generation', async () => {
    const f = await fixture('real-recovery');
    const barrier = storage.delayNextPutThenFailAfterWrite();
    const pendingUpload = upload(f.token, f.requestId, `interrupted-${randomUUID()}`).expect(503);
    const responsePromise = pendingUpload.then((response) => response);
    await barrier.started;
    const intent = await prisma.client.vipSampleWorkUpload.findFirstOrThrow({ where: { vipRequestId: f.requestId } });
    const oldKey = intent.objectKey!;

    const workerConfig = { values: {
      VIP_UPLOAD_RECOVERY_INTERVAL_MS: 30_000,
      VIP_UPLOAD_RECOVERY_BATCH_SIZE: 10,
      VIP_UPLOAD_LEASE_MS: 5_000,
      MINIO_REQUEST_TIMEOUT_MS: 1_000,
      VIP_UPLOAD_CLEANUP_SETTLE_MS: 5_000,
      NODE_ENV: 'test', LOG_LEVEL: 'silent',
    } as AppConfig } as AppConfigService;
    const recovery = new VipSampleWorkRecoveryProcessor(prisma as never, workerConfig, storage, pino({ level: 'silent' }));
    const recoveryTime = new Date(intent.lockedUntil!.getTime() + 1);
    expect(await recovery.releaseExpiredUploads(recoveryTime)).toBe(1);
    const earlyAt = new Date(recoveryTime.getTime() + 1_001);
    const early = await recovery.claimCleanups(earlyAt);
    const earlyClaim = early.find((claim) => claim.objectKey === oldKey);
    expect(earlyClaim).toBeDefined();
    storage.failNextDeleteAfterStorageCall();
    await recovery.processCleanup(earlyClaim!, earlyAt);
    barrier.proceed();
    await responsePromise;
    await expect(storage.delegate.getObject(oldKey)).resolves.toMatchObject({ body: JPEG });

    const ambiguous = await prisma.client.vipSampleWorkCleanup.findFirstOrThrow({ where: { objectKey: oldKey } });
    expect(ambiguous).toMatchObject({ status: 'PENDING', deletePasses: 0, lastErrorCode: 'STORAGE_DELETE_FAILED' });

    const retryAt = new Date(ambiguous.availableAt.getTime() + 1);
    const deleteRetry = await recovery.claimCleanups(retryAt);
    const deleteRetryClaim = deleteRetry.find((claim) => claim.objectKey === oldKey);
    expect(deleteRetryClaim).toBeDefined();
    await recovery.processCleanup(deleteRetryClaim!, retryAt);
    expect((await prisma.client.vipSampleWorkCleanup.findFirstOrThrow({ where: { objectKey: oldKey } })))
      .toMatchObject({ status: 'PROCESSED', deletePasses: 1 });
    await expect(storage.delegate.getObject(oldKey)).rejects.toMatchObject({ code: 'INFRASTRUCTURE_ERROR' });

    const retry = await upload(f.token, f.requestId, `retry-${randomUUID()}`).expect(201);
    const sampleId = retry.body.sampleWorks[0].id as string;
    const committed = await prisma.client.vipSampleWork.findUniqueOrThrow({ where: { id: sampleId } });
    expect(committed.objectKey).not.toBe(oldKey);

    await expect(storage.delegate.getObject(committed.objectKey)).resolves.toMatchObject({ body: JPEG });

    await prisma.client.vipSampleWorkCleanup.create({ data: {
      id: randomUUID(), uploadId: intent.id, objectKey: committed.objectKey,
      uploadGeneration: 2, settleUntil: new Date(Date.now() - 1_000),
    } });
    expect(await recovery.claimCleanups(new Date())).toEqual([]);
    await request(app.getHttpServer()).get(`/vip/sample-works/${sampleId}`)
      .set('Authorization', `Bearer ${f.token}`).expect(200);
  });
});

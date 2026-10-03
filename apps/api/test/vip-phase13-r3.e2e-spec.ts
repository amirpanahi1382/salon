import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { AppConfig } from '@salon/config';
import { createPrismaClient } from '@salon/database';
import { S3CompatibleObjectStorage, type ObjectStorage, type StoredObject } from '@salon/object-storage';
import { InfrastructureError } from '@salon/shared';
import pino from 'pino';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';
import { VipSampleWorkRecoveryProcessor } from '../../worker/src/vip/vip-sample-work-recovery.processor';

const databaseName = process.env.PHASE13B_DISPOSABLE_DATABASE_NAME;
const databaseUrl = process.env.DATABASE_URL;
const bucket = process.env.PHASE13B_MINIO_BUCKET;
const enabled = (() => {
  if (!databaseName || !databaseUrl || !bucket) return false;
  try {
    const parsed = new URL(databaseUrl);
    return /^salon_phase13b_[a-z0-9]+$/.test(databaseName) &&
      parsed.hostname === '127.0.0.1' && parsed.port !== '' &&
      parsed.pathname.slice(1) === databaseName &&
      bucket === `phase13b-disposable-${databaseName.slice('salon_phase13b_'.length)}` &&
      process.env.MINIO_ENDPOINT === '127.0.0.1' && process.env.MINIO_BUCKET === bucket &&
      Boolean(process.env.MINIO_PORT) && process.env.VIP_UPLOAD_LEASE_MS === '5000';
  } catch { return false; }
})();
const describeDisposable = enabled ? describe : describe.skip;
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);

class PauseBeforeRealPut implements ObjectStorage {
  mode: 'fresh' | 'fixed' = 'fresh';
  rejectPreparation = false;
  private barrier?: { started: () => void; release: Promise<void> };
  constructor(readonly real: S3CompatibleObjectStorage) {}

  preparePutObject(input: { key: string; body: Buffer; contentType: string; expiresAt: Date }) {
    if (this.rejectPreparation) throw new InfrastructureError('Injected authorization preparation failure');
    const fixed = this.real.preparePutObject(input);
    return { execute: async () => {
      const barrier = this.barrier;
      this.barrier = undefined;
      if (barrier) {
        barrier.started();
        await barrier.release;
        if (this.mode === 'fresh') {
          // Baseline behavior: old adapter signs anew only when the paused PUT resumes.
          await this.real.putObject(input);
          throw new InfrastructureError('Injected API interruption after real PUT');
        }
      }
      return fixed.execute();
    } };
  }

  pauseAndAbortApiAfterPut() {
    let started!: () => void;
    let release!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    this.barrier = { started, release: held };
    return { began, release };
  }

  async putObject(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    const barrier = this.barrier;
    this.barrier = undefined;
    if (barrier) {
      barrier.started();
      await barrier.release;
      await this.real.putObject(input);
      // Models an API path that exits before GET/finalization. This is not an OS kill.
      throw new InfrastructureError('Injected API interruption after real PUT');
    }
    return this.real.putObject(input);
  }
  getObject(key: string) { return this.real.getObject(key); }
  deleteObject(key: string) { return this.real.deleteObject(key); }
}

describeDisposable('Phase 13 post-terminal stale PUT (real PostgreSQL and MinIO)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let storage: PauseBeforeRealPut;

  beforeAll(async () => {
    const guard = createPrismaClient(databaseUrl!);
    try {
      const rows = await guard.$queryRaw<Array<{ name: string; comment: string | null }>>`
        SELECT datname AS name, shobj_description(oid, 'pg_database') AS comment
        FROM pg_database WHERE datname = current_database()
      `;
      if (rows[0]?.name !== databaseName ||
          rows[0]?.comment !== `phase13b-disposable:${databaseName!.slice('salon_phase13b_'.length)}`) {
        throw new Error('Phase 13B disposable database ownership check failed');
      }
    } finally { await guard.$disconnect(); }
    storage = new PauseBeforeRealPut(new S3CompatibleObjectStorage({
      MINIO_ENDPOINT: '127.0.0.1', MINIO_PORT: Number(process.env.MINIO_PORT),
      MINIO_USE_SSL: false, MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY!,
      MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY!, MINIO_BUCKET: bucket!,
      MINIO_REQUEST_TIMEOUT_MS: 2_000,
    }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE).useValue(storage).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });
  afterAll(async () => { if (app) await app.close(); });

  async function runPostTerminalPut(mode: 'fresh' | 'fixed') {
    storage.mode = mode;
    const now = new Date();
    const adminId = randomUUID(), salonId = randomUUID(), userId = randomUUID();
    const listId = randomUUID(), requestId = randomUUID();
    await prisma.client.platformAdmin.create({ data: {
      id: adminId, email: `${adminId}@example.test`, name: 'Phase13', passwordHash: 'synthetic', updatedAt: now,
    } });
    await prisma.client.salon.create({ data: { id: salonId, name: 'Phase13', updatedAt: now } });
    await prisma.client.user.create({ data: {
      id: userId, salonId, name: 'Owner', email: `${userId}@example.test`,
      passwordHash: 'synthetic', role: 'OWNER', updatedAt: now,
    } });
    await prisma.client.vipTargetList.create({ data: {
      id: listId, name: 'Phase13', status: 'IN_USE', contactCount: 30,
      createdByAdminId: adminId, reservedBySalonId: salonId, reservedAt: now, updatedAt: now,
    } });
    await prisma.client.vipRequest.create({ data: {
      id: requestId, salonId, listId, createdByUserId: userId, requestedCount: 30,
      geographicRange: 'synthetic', status: 'AWAITING_SAMPLE_WORK',
      reservedUntil: new Date(now.getTime() + 600_000), updatedAt: now,
    } });
    const token = await jwt.signAsync({ sub: userId, tid: salonId, role: 'OWNER' });
    const upload = (key: string, bytes = JPEG) => request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/sample-works`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key)
      .attach('file', bytes, 'work.jpg');
    const recovery = new VipSampleWorkRecoveryProcessor(prisma as never, {
      values: {
        VIP_UPLOAD_RECOVERY_INTERVAL_MS: 30_000, VIP_UPLOAD_RECOVERY_BATCH_SIZE: 10,
        VIP_UPLOAD_LEASE_MS: 5_000, MINIO_REQUEST_TIMEOUT_MS: 1_000,
        VIP_UPLOAD_CLEANUP_SETTLE_MS: 5_000, NODE_ENV: 'test', LOG_LEVEL: 'silent',
      } as AppConfig,
    } as AppConfigService, storage, pino({ level: 'silent' }));

    const barrier = storage.pauseAndAbortApiAfterPut();
    const oldResponse = upload(`old-${randomUUID()}`).then((result) => result);
    await barrier.began;
    const intent = await prisma.client.vipSampleWorkUpload.findFirstOrThrow({ where: { vipRequestId: requestId } });
    expect(intent.status).toBe('UPLOADING');
    const oldKey = intent.objectKey!;
    await expect(storage.real.getObject(oldKey)).rejects.toMatchObject({ code: 'INFRASTRUCTURE_ERROR' });

    const expiredAt = new Date(intent.lockedUntil!.getTime() + 1);
    expect(await recovery.releaseExpiredUploads(expiredAt)).toBe(1);
    const released = await prisma.client.vipSampleWorkUpload.findUniqueOrThrow({ where: { id: intent.id } });
    expect(released).toMatchObject({ status: 'RETRYABLE', position: null, ownerToken: null });
    const earlyAt = new Date(expiredAt.getTime() + 1_001);
    const early = await recovery.claimCleanups(earlyAt);
    expect(early).toHaveLength(1);
    await recovery.processCleanup(early[0]!, earlyAt);
    const afterEarly = await prisma.client.vipSampleWorkCleanup.findFirstOrThrow({ where: { objectKey: oldKey } });
    expect(afterEarly).toMatchObject({ status: 'PENDING', deletePasses: 1 });
    const finalAt = new Date(afterEarly.settleUntil.getTime() + 1);
    const final = await recovery.claimCleanups(finalAt);
    expect(final).toHaveLength(1);
    await recovery.processCleanup(final[0]!, finalAt);
    expect(await prisma.client.vipSampleWorkCleanup.findFirstOrThrow({ where: { objectKey: oldKey } }))
      .toMatchObject({ status: 'PROCESSED', deletePasses: 2 });
    await expect(storage.real.getObject(oldKey)).rejects.toMatchObject({ code: 'INFRASTRUCTURE_ERROR' });

    // Retry uses the released position and commits a distinct current generation.
    const retry = await upload(`retry-${randomUUID()}`).expect(201);
    const committed = await prisma.client.vipSampleWork.findUniqueOrThrow({
      where: { id: retry.body.sampleWorks[0].id as string },
    });
    expect(committed.objectKey).not.toBe(oldKey);
    expect((await storage.real.getObject(committed.objectKey)).body).toEqual(JPEG);

    // The barrier controls ordering; wall-clock waiting additionally makes the
    // fixed authorization expire before the real storage request is started.
    await new Promise((resolve) => setTimeout(resolve,
      Math.max(0, intent.lockedUntil!.getTime() + 1_100 - Date.now())));
    expect(Date.now()).toBeGreaterThan(intent.lockedUntil!.getTime());
    barrier.release();
    const failedOldResponse = await oldResponse;
    expect(failedOldResponse.status).toBe(503);
    expect(JSON.stringify(failedOldResponse.body)).not.toContain(oldKey);
    expect(JSON.stringify(failedOldResponse.body)).not.toContain('X-Amz-');
    if (mode === 'fresh') {
      // The old adapter signed afresh after the pause, reproducing the Phase 13 orphan.
      expect((await storage.real.getObject(oldKey)).body).toEqual(JPEG);
    } else {
      // The authorization fixed before commit is no longer valid at the store.
      await expect(storage.real.getObject(oldKey)).rejects.toMatchObject({ code: 'INFRASTRUCTURE_ERROR' });
    }
    expect(await recovery.releaseExpiredUploads(new Date(finalAt.getTime() + 10_000))).toBe(0);
    expect(await recovery.claimCleanups(new Date(finalAt.getTime() + 10_000))).toEqual([]);
    expect((await prisma.client.vipSampleWorkCleanup.findFirstOrThrow({ where: { objectKey: oldKey } })).status)
      .toBe('PROCESSED');
    expect(await prisma.client.vipSampleWork.count({ where: { objectKey: oldKey } })).toBe(0);
    expect((await storage.real.getObject(committed.objectKey)).body).toEqual(JPEG);
    expect(await prisma.client.vipSampleWork.count({ where: { vipRequestId: requestId } })).toBe(1);
    expect(await prisma.client.auditLog.count({ where: { tenantId: salonId, action: 'VIP_SAMPLE_WORK_UPLOADED' } })).toBe(0);
    expect(await prisma.client.outboxEvent.count({ where: { tenantId: salonId } })).toBe(0);

    await prisma.client.vipSampleWorkCleanup.create({ data: {
      id: randomUUID(), uploadId: intent.id, objectKey: committed.objectKey,
      uploadGeneration: 2, settleUntil: new Date(Date.now() - 1_000),
    } });
    expect(await recovery.claimCleanups(new Date(finalAt.getTime() + 10_000))).toEqual([]);
    expect((await storage.real.getObject(committed.objectKey)).body).toEqual(JPEG);

    if (mode === 'fixed') {
      const beforeIntents = await prisma.client.vipSampleWorkUpload.count({ where: { vipRequestId: requestId } });
      const beforeSamples = await prisma.client.vipSampleWork.count({ where: { vipRequestId: requestId } });
      const changed = Buffer.from(JPEG);
      changed[8] = changed[8]! ^ 1;
      const failedKey = `prepare-failed-${randomUUID()}`;
      storage.rejectPreparation = true;
      try {
        const failed = await upload(failedKey, changed).expect(503);
        expect(JSON.stringify(failed.body)).not.toContain('X-Amz-');
      } finally { storage.rejectPreparation = false; }
      expect(await prisma.client.vipSampleWorkUpload.count({ where: { vipRequestId: requestId } }))
        .toBe(beforeIntents);
      expect(await prisma.client.vipSampleWork.count({ where: { vipRequestId: requestId } }))
        .toBe(beforeSamples);
      expect(await prisma.client.idempotencyRecord.count({ where: { key: failedKey } })).toBe(0);
    }
  }

  it('reproduces the old fresh-sign behavior after terminal cleanup', async () => {
    await runPostTerminalPut('fresh');
  });

  it('rejects the same stale PUT with authorization fixed before intent commit', async () => {
    await runPostTerminalPut('fixed');
  });
});

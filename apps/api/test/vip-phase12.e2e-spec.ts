import { createHash, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createPrismaClient } from '@salon/database';
import { S3CompatibleObjectStorage, type ObjectStorage } from '@salon/object-storage';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';

const url = process.env.DATABASE_URL;
const databaseName = process.env.PHASE12_DISPOSABLE_DATABASE_NAME;
const fixtureRequestId = process.env.PHASE12_LEGACY_REQUEST_ID;
const enabled = (() => {
  if (!url || !databaseName || !fixtureRequestId) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === '127.0.0.1' && parsed.port !== '' &&
      parsed.pathname.slice(1) === databaseName && /^salon_phase12_[a-z0-9]+$/.test(databaseName);
  } catch { return false; }
})();
const describeDisposable = enabled ? describe : describe.skip;
const useRealStorage = Boolean(process.env.PHASE12_MINIO_PORT);
if (useRealStorage && (
  process.env.PHASE12_MINIO_BUCKET !== `phase12-disposable-${databaseName?.slice('salon_phase12_'.length)}` ||
  !process.env.PHASE12_MINIO_ACCESS || !process.env.PHASE12_MINIO_SECRET
)) {
  throw new Error('Phase 12 disposable object-storage target is not identified');
}
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);

class BarrierStorage implements ObjectStorage {
  writes = 0;
  private barrier?: { key: string; started: () => void; released: Promise<void> };

  constructor(private readonly delegate: ObjectStorage) {}

  preparePutObject(input: { key: string; body: Buffer; contentType: string; expiresAt: Date }) {
    const prepared = this.delegate.preparePutObject?.(input);
    if (!prepared) throw new Error('Test storage cannot prepare PUT');
    return { execute: async () => {
      this.writes += 1;
      return prepared.execute();
    } };
  }

  override async putObject(input: { key: string; body: Buffer; contentType: string }) {
    this.writes += 1;
    return this.delegate.putObject(input);
  }

  pauseNextGet(key: string) {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.barrier = { key, started, released };
    return { started: startedPromise, release };
  }

  override async getObject(key: string) {
    const barrier = this.barrier;
    if (barrier?.key === key) {
      this.barrier = undefined;
      barrier.started();
      await barrier.released;
    }
    return this.delegate.getObject(key);
  }

  deleteObject(key: string) { return this.delegate.deleteObject(key); }
}

describeDisposable('Phase 12 VIP predecessor replay and submission deadline', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const storage = new BarrierStorage(useRealStorage
    ? new S3CompatibleObjectStorage({
        MINIO_ENDPOINT: '127.0.0.1', MINIO_PORT: Number(process.env.PHASE12_MINIO_PORT),
        MINIO_USE_SSL: false, MINIO_ACCESS_KEY: process.env.PHASE12_MINIO_ACCESS!,
        MINIO_SECRET_KEY: process.env.PHASE12_MINIO_SECRET!,
        MINIO_BUCKET: process.env.PHASE12_MINIO_BUCKET!, MINIO_REQUEST_TIMEOUT_MS: 2000,
      })
    : new MemoryObjectStorage());

  beforeAll(async () => {
    const guard = createPrismaClient(url!);
    try {
      const rows = await guard.$queryRaw<Array<{ name: string; comment: string | null }>>`
        SELECT datname AS name, shobj_description(oid, 'pg_database') AS comment
        FROM pg_database WHERE datname = current_database()
      `;
      if (rows[0]?.name !== databaseName || rows[0]?.comment !== `phase12-disposable:${databaseName!.slice('salon_phase12_'.length)}`) {
        throw new Error('Phase 12 disposable database ownership check failed');
      }
    } finally { await guard.$disconnect(); }
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

  it('replays the migrated predecessor record without another upload effect', async () => {
    const sample = await prisma.client.vipSampleWork.findFirstOrThrow({ where: { vipRequestId: fixtureRequestId! } });
    const record = await prisma.client.idempotencyRecord.findFirstOrThrow({ where: { resourceId: sample.id } });
    const token = await jwt.signAsync({ sub: record.actorId, tid: record.tenantId, role: 'OWNER' });
    await storage.putObject({ key: sample.objectKey, body: JPEG, contentType: sample.contentType });
    const writes = storage.writes;
    const beforeAudit = await prisma.client.auditLog.count({ where: { tenantId: record.tenantId } });
    const beforeOutbox = await prisma.client.outboxEvent.count({ where: { tenantId: record.tenantId } });
    const response = await request(app.getHttpServer())
      .post(`/vip/requests/${fixtureRequestId!}/sample-works`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', record.key)
      .attach('file', JPEG, 'legacy.jpg');
    expect(response.status).toBe(201);
    expect(response.body.sampleWorks[0].id).toBe(sample.id);
    expect(await prisma.client.vipSampleWork.count({ where: { vipRequestId: fixtureRequestId! } })).toBe(1);
    expect(await prisma.client.vipSampleWorkUpload.count({ where: { vipRequestId: fixtureRequestId! } })).toBe(0);
    expect(storage.writes).toBe(writes);
    expect(await prisma.client.auditLog.count({ where: { tenantId: record.tenantId } })).toBe(beforeAudit);
    expect(await prisma.client.outboxEvent.count({ where: { tenantId: record.tenantId } })).toBe(beforeOutbox);
    expect((await prisma.client.vipSampleWork.findUniqueOrThrow({ where: { id: sample.id } })).verifiedAt).not.toBeNull();

    const changed = Buffer.from(JPEG); changed[8] = changed[8]! ^ 1;
    await request(app.getHttpServer()).post(`/vip/requests/${fixtureRequestId!}/sample-works`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', record.key)
      .attach('file', changed, 'legacy.jpg').expect(409);
    const otherUserId = randomUUID();
    await prisma.client.user.create({ data: {
      id: otherUserId, salonId: record.tenantId, name: 'Other actor',
      email: `phase12-${otherUserId}@example.test`, passwordHash: 'synthetic',
      role: 'STAFF', updatedAt: new Date(),
    } });
    const otherToken = await jwt.signAsync({ sub: otherUserId, tid: record.tenantId, role: 'STAFF' });
    await request(app.getHttpServer()).post(`/vip/requests/${fixtureRequestId!}/sample-works`)
      .set('Authorization', `Bearer ${otherToken}`).set('Idempotency-Key', record.key)
      .attach('file', JPEG, 'legacy.jpg').expect(409);
    const foreignSalon = randomUUID(), foreignUser = randomUUID();
    await prisma.client.salon.create({ data: { id: foreignSalon, name: 'Foreign', updatedAt: new Date() } });
    await prisma.client.user.create({ data: {
      id: foreignUser, salonId: foreignSalon, name: 'Foreign',
      email: `phase12-${foreignUser}@example.test`, passwordHash: 'synthetic',
      role: 'OWNER', updatedAt: new Date(),
    } });
    const foreignToken = await jwt.signAsync({ sub: foreignUser, tid: foreignSalon, role: 'OWNER' });
    const foreign = await request(app.getHttpServer()).post(`/vip/requests/${fixtureRequestId!}/sample-works`)
      .set('Authorization', `Bearer ${foreignToken}`).set('Idempotency-Key', record.key)
      .attach('file', JPEG, 'legacy.jpg').expect(404);
    expect(JSON.stringify(foreign.body)).not.toContain(sample.objectKey);

    const brokenKey = `broken-${randomUUID()}`;
    await prisma.client.idempotencyRecord.create({ data: {
      id: randomUUID(), tenantId: record.tenantId, actorId: record.actorId,
      operation: record.operation, key: brokenKey, requestHash: record.requestHash,
      resourceType: 'vip_sample_work', resourceId: randomUUID(), createdAt: record.createdAt,
    } });
    await request(app.getHttpServer()).post(`/vip/requests/${fixtureRequestId!}/sample-works`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', brokenKey)
      .attach('file', JPEG, 'legacy.jpg').expect(404);
    const brokenCurrentKey = `broken-current-${randomUUID()}`;
    await prisma.client.idempotencyRecord.create({ data: {
      id: randomUUID(), tenantId: record.tenantId, actorId: record.actorId,
      operation: record.operation, key: brokenCurrentKey, requestHash: record.requestHash,
      resourceType: 'vip_sample_work_upload', resourceId: randomUUID(),
    } });
    await request(app.getHttpServer()).post(`/vip/requests/${fixtureRequestId!}/sample-works`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', brokenCurrentKey)
      .attach('file', JPEG, 'legacy.jpg').expect(404);

    await storage.putObject({ key: sample.objectKey, body: changed, contentType: sample.contentType });
    await request(app.getHttpServer()).post(`/vip/requests/${fixtureRequestId!}/sample-works`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', record.key)
      .attach('file', JPEG, 'legacy.jpg').expect(503);
    await storage.deleteObject(sample.objectKey);
    await request(app.getHttpServer()).post(`/vip/requests/${fixtureRequestId!}/sample-works`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', record.key)
      .attach('file', JPEG, 'legacy.jpg').expect(503);
    await storage.putObject({ key: sample.objectKey, body: JPEG, contentType: sample.contentType });

    // Once the seven-day record is deleted, the old key has no replay guarantee.
    const expiredKey = `expired-${randomUUID()}`;
    const expiredRecord = await prisma.client.idempotencyRecord.create({ data: {
      id: randomUUID(), tenantId: record.tenantId, actorId: record.actorId,
      operation: record.operation, key: expiredKey, requestHash: record.requestHash,
      resourceType: 'vip_sample_work', resourceId: sample.id,
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    } });
    await prisma.client.idempotencyRecord.delete({ where: { id: expiredRecord.id } });
    const writesBeforeExpiredReplay = storage.writes;
    await request(app.getHttpServer()).post(`/vip/requests/${fixtureRequestId!}/sample-works`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', expiredKey)
      .attach('file', JPEG, 'legacy.jpg').expect(409);
    expect(storage.writes).toBe(writesBeforeExpiredReplay);
    expect(await prisma.client.vipSampleWork.count({ where: { vipRequestId: fixtureRequestId! } })).toBe(1);
    expect(await prisma.client.vipSampleWorkUpload.count({ where: { vipRequestId: fixtureRequestId! } })).toBe(0);
    expect(await prisma.client.idempotencyRecord.count({ where: { operation: record.operation, key: expiredKey } })).toBe(0);
  });

  it('rejects a reservation that expires while object verification is paused', async () => {
    const old = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: fixtureRequestId! } });
    const listId = randomUUID(), requestId = randomUUID(), sampleId = randomUUID();
    const key = `vip/${old.salonId}/${requestId}/${sampleId}`;
    await prisma.client.vipTargetList.create({ data: {
      id: listId, name: 'Phase12 deadline', status: 'IN_USE', contactCount: 30,
      createdByAdminId: (await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: old.listId } })).createdByAdminId,
      reservedBySalonId: old.salonId, reservedAt: new Date(), updatedAt: new Date(),
    } });
    await prisma.client.vipRequest.create({ data: {
      id: requestId, salonId: old.salonId, listId, createdByUserId: old.createdByUserId,
      requestedCount: 30, geographicRange: 'synthetic', status: 'AWAITING_SAMPLE_WORK',
      reservedUntil: new Date(Date.now() + 60_000), updatedAt: new Date(),
    } });
    await prisma.client.vipSampleWork.create({ data: {
      id: sampleId, vipRequestId: requestId, salonId: old.salonId, position: 1,
      objectKey: key, contentType: 'image/jpeg', byteSize: JPEG.length,
      sha256: createHash('sha256').update(JPEG).digest('hex'),
    } });
    await storage.putObject({ key, body: JPEG, contentType: 'image/jpeg' });
    const token = await jwt.signAsync({ sub: old.createdByUserId, tid: old.salonId, role: 'OWNER' });
    const idempotencyKey = `phase12-submit-${randomUUID()}`;
    const beforeOutbox = await prisma.client.outboxEvent.count({ where: { eventType: 'VipRequestSubmitted', tenantId: old.salonId } });
    const beforeAudit = await prisma.client.auditLog.count({ where: { action: 'VIP_REQUEST_SUBMITTED', tenantId: old.salonId } });
    const barrier = storage.pauseNextGet(key);
    const pending = request(app.getHttpServer()).post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idempotencyKey);
    const responsePromise = pending.then((result) => result);
    await barrier.started;
    const deadline = new Date(Date.now() + 250);
    await prisma.client.vipRequest.update({ where: { id: requestId }, data: {
      reservedUntil: deadline,
    } });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(Date.now()).toBeGreaterThan(deadline.getTime());
    barrier.release();
    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect((await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: requestId } })).status).not.toBe('SUBMITTED');
    expect(await prisma.client.idempotencyRecord.count({ where: { operation: 'VIP_REQUEST_SUBMIT', key: idempotencyKey } })).toBe(0);
    expect(await prisma.client.outboxEvent.count({ where: { eventType: 'VipRequestSubmitted', tenantId: old.salonId } })).toBe(beforeOutbox);
    expect(await prisma.client.auditLog.count({ where: { action: 'VIP_REQUEST_SUBMITTED', tenantId: old.salonId } })).toBe(beforeAudit);
  });

  it('keeps current upload replay and normal submit, including the exact deadline predicate', async () => {
    const old = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: fixtureRequestId! } });
    const listId = randomUUID(), requestId = randomUUID();
    const admin = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: old.listId } });
    await prisma.client.vipTargetList.create({ data: {
      id: listId, name: 'Phase12 current', status: 'IN_USE', contactCount: 30,
      createdByAdminId: admin.createdByAdminId, reservedBySalonId: old.salonId,
      reservedAt: new Date(), updatedAt: new Date(),
    } });
    const deadline = new Date(Date.now() + 60_000);
    await prisma.client.vipRequest.create({ data: {
      id: requestId, salonId: old.salonId, listId, createdByUserId: old.createdByUserId,
      requestedCount: 30, geographicRange: 'synthetic', status: 'AWAITING_SAMPLE_WORK',
      reservedUntil: deadline, updatedAt: new Date(),
    } });
    const token = await jwt.signAsync({ sub: old.createdByUserId, tid: old.salonId, role: 'OWNER' });
    const key = `current-${randomUUID()}`;
    const upload = () => request(app.getHttpServer()).post(`/vip/requests/${requestId}/sample-works`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key)
      .attach('file', JPEG, 'current.jpg');
    await upload().expect(201);
    const writes = storage.writes;
    await upload().expect(201);
    expect(storage.writes).toBe(writes);
    expect(await prisma.client.vipSampleWork.count({ where: { vipRequestId: requestId } })).toBe(1);
    expect(await prisma.client.vipSampleWorkUpload.count({ where: { vipRequestId: requestId, status: 'AVAILABLE' } })).toBe(1);

    const boundary = { id: requestId, salonId: old.salonId, status: 'AWAITING_SAMPLE_WORK' as const };
    expect((await prisma.client.vipRequest.updateMany({
      where: { ...boundary, reservedUntil: { gte: deadline } }, data: { updatedAt: new Date() },
    })).count).toBe(1);
    expect((await prisma.client.vipRequest.updateMany({
      where: { ...boundary, reservedUntil: { gte: new Date(deadline.getTime() + 1) } },
      data: { updatedAt: new Date() },
    })).count).toBe(0);

    const submitKey = `normal-${randomUUID()}`;
    const submitted = await request(app.getHttpServer()).post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', submitKey).expect(201);
    expect(submitted.body.status).toBe('SUBMITTED');
    const replay = await request(app.getHttpServer()).post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', submitKey).expect(201);
    expect(replay.body.submittedAt).toBe(submitted.body.submittedAt);
    const requestRow = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: requestId } });
    const sample = await prisma.client.vipSampleWork.findFirstOrThrow({ where: { vipRequestId: requestId } });
    expect(sample.verifiedAt?.getTime()).toBe(requestRow.submittedAt?.getTime());
  });
});

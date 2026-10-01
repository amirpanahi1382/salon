import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig } from '@salon/config';
import { createPrismaClient } from '@salon/database';
import type { ObjectStorage, StoredObject } from '@salon/object-storage';
import pino from 'pino';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VipSampleWorkRecoveryProcessor } from './vip-sample-work-recovery.processor';

const isolatedUrl = process.env.PHASE10_ISOLATED_DATABASE_URL;
const describeIfIsolated = isolatedUrl && isolatedUrl === process.env.DATABASE_URL ? describe : describe.skip;

class MapStorage implements ObjectStorage {
  readonly objects = new Map<string, Buffer>();
  readonly deleted: string[] = [];

  async putObject(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    this.objects.set(input.key, input.body);
    return { key: input.key, contentType: input.contentType, byteSize: input.body.length };
  }

  async getObject(key: string) {
    const body = this.objects.get(key);
    if (!body) throw new Error('NOT_FOUND');
    return { body, contentType: 'image/jpeg' };
  }

  async deleteObject(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

describeIfIsolated('VIP sample-work recovery ownership (PostgreSQL)', () => {
  const client = createPrismaClient(isolatedUrl!);
  const config = {
    values: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      VIP_UPLOAD_RECOVERY_INTERVAL_MS: 60_000,
      VIP_UPLOAD_RECOVERY_BATCH_SIZE: 10,
      VIP_UPLOAD_LEASE_MS: 5_000,
      MINIO_REQUEST_TIMEOUT_MS: 1_000,
      VIP_UPLOAD_CLEANUP_SETTLE_MS: 5_000,
    } as AppConfig,
  } as AppConfigService;
  const storage = new MapStorage();
  const processor = new VipSampleWorkRecoveryProcessor(
    { client } as PrismaService,
    config,
    storage,
    pino({ level: 'silent' }),
  );

  let salonId: string;
  let requestId: string;
  let uploadId: string;
  let generationOneKey: string;

  beforeAll(async () => {
    await client.$connect();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  beforeEach(async () => {
    storage.objects.clear();
    storage.deleted.splice(0);
    await client.$executeRawUnsafe('TRUNCATE TABLE salons CASCADE');
    await client.$executeRawUnsafe('TRUNCATE TABLE platform_admins CASCADE');

    const now = new Date();
    const adminId = randomUUID();
    salonId = randomUUID();
    const userId = randomUUID();
    const listId = randomUUID();
    requestId = randomUUID();
    uploadId = randomUUID();
    generationOneKey = `vip/${salonId}/${requestId}/${uploadId}/g1`;
    await client.platformAdmin.create({
      data: { id: adminId, email: `${adminId}@example.test`, name: 'Phase 10', passwordHash: 'test', updatedAt: now },
    });
    await client.salon.create({ data: { id: salonId, name: 'Phase 10', updatedAt: now } });
    await client.user.create({
      data: { id: userId, salonId, name: 'Owner', email: `${userId}@example.test`, passwordHash: 'test', role: 'OWNER', updatedAt: now },
    });
    await client.vipTargetList.create({
      data: { id: listId, name: 'Disposable', status: 'IN_USE', contactCount: 1,
        createdByAdminId: adminId, reservedBySalonId: salonId, reservedAt: now, updatedAt: now },
    });
    await client.vipRequest.create({
      data: { id: requestId, salonId, listId, createdByUserId: userId, requestedCount: 30,
        geographicRange: 'test', status: 'AWAITING_SAMPLE_WORK',
        reservedUntil: new Date(now.getTime() + 60_000), updatedAt: now },
    });
    await client.vipSampleWorkUpload.create({
      data: { id: uploadId, vipRequestId: requestId, salonId, sha256: 'a'.repeat(64),
        contentType: 'image/jpeg', byteSize: 4, status: 'UPLOADING', position: 1,
        generation: 1, objectKey: generationOneKey, ownerToken: 'owner-1',
        lockedUntil: new Date(now.getTime() - 2_000) },
    });
  });

  it('deletes a post-exit delayed PUT at the durable settlement horizon and preserves retry', async () => {
    const recoveryTime = new Date();
    expect(await processor.releaseExpiredUploads(recoveryTime)).toBe(1);
    const released = await client.vipSampleWorkUpload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(released).toMatchObject({ status: 'RETRYABLE', position: null, ownerToken: null });

    const firstClaims = await processor.claimCleanups(new Date(recoveryTime.getTime() + 2_000));
    expect(firstClaims).toHaveLength(1);
    await processor.processCleanup(firstClaims[0]!, new Date(recoveryTime.getTime() + 2_000));
    expect(await client.vipSampleWorkCleanup.findFirstOrThrow()).toMatchObject({
      status: 'PENDING', deletePasses: 1,
    });

    // The old process is gone: no finalizer or re-arm runs after this late PUT.
    storage.objects.set(generationOneKey, Buffer.from('late'));

    const generationTwoKey = `vip/${salonId}/${requestId}/${uploadId}/g2`;
    await client.vipSampleWorkUpload.update({
      where: { id: uploadId },
      data: { status: 'UPLOADING', position: 1, generation: 2, objectKey: generationTwoKey,
        ownerToken: 'owner-2', lockedUntil: new Date(Date.now() + 30_000) },
    });
    storage.objects.set(generationTwoKey, Buffer.from('current'));

    const finalSweep = new Date(recoveryTime.getTime() + 6_000);
    const secondClaims = await processor.claimCleanups(finalSweep);
    expect(secondClaims).toHaveLength(1);
    await processor.processCleanup(secondClaims[0]!, finalSweep);
    expect(storage.objects.has(generationOneKey)).toBe(false);
    expect(storage.objects.get(generationTwoKey)?.toString()).toBe('current');
    expect(storage.deleted).toEqual([generationOneKey, generationOneKey]);

    const staleFinalize = await client.vipSampleWorkUpload.updateMany({
      where: { id: uploadId, status: 'UPLOADING', generation: 1, ownerToken: 'owner-1' },
      data: { status: 'AVAILABLE', position: null, ownerToken: null, lockedUntil: null },
    });
    expect(staleFinalize.count).toBe(0);
  });

  it('atomically reserves one position and rejects cross-tenant intent', async () => {
    await client.vipSampleWorkUpload.update({
      where: { id: uploadId },
      data: { status: 'RETRYABLE', position: null, ownerToken: null, lockedUntil: null },
    });
    const secondId = randomUUID();
    await client.vipSampleWorkUpload.create({
      data: { id: secondId, vipRequestId: requestId, salonId, sha256: 'b'.repeat(64),
        contentType: 'image/jpeg', byteSize: 4 },
    });
    const reservations = await Promise.allSettled([
      client.vipSampleWorkUpload.update({ where: { id: uploadId }, data: { status: 'UPLOADING',
        position: 1, generation: 2, objectKey: `${generationOneKey}-retry`, ownerToken: 'one',
        lockedUntil: new Date(Date.now() + 30_000) } }),
      client.vipSampleWorkUpload.update({ where: { id: secondId }, data: { status: 'UPLOADING',
        position: 1, generation: 1, objectKey: `${generationOneKey}-other`, ownerToken: 'two',
        lockedUntil: new Date(Date.now() + 30_000) } }),
    ]);
    expect(reservations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(reservations.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const otherSalonId = randomUUID();
    await client.salon.create({ data: { id: otherSalonId, name: 'Other', updatedAt: new Date() } });
    await expect(client.vipSampleWorkUpload.create({
      data: { id: randomUUID(), vipRequestId: requestId, salonId: otherSalonId,
        sha256: createHash('sha256').update('foreign').digest('hex'), contentType: 'image/jpeg', byteSize: 1 },
    })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('never claims a cleanup key referenced by committed sample metadata', async () => {
    const body = Buffer.from('safe');
    await client.vipSampleWorkUpload.update({
      where: { id: uploadId },
      data: { status: 'RETRYABLE', position: null, ownerToken: null, lockedUntil: null },
    });
    await client.vipSampleWork.create({
      data: { id: uploadId, vipRequestId: requestId, salonId, position: 1,
        objectKey: generationOneKey, contentType: 'image/jpeg', byteSize: body.length,
        sha256: createHash('sha256').update(body).digest('hex'), verifiedAt: new Date() },
    });
    await client.vipSampleWorkUpload.update({
      where: { id: uploadId },
      data: { status: 'AVAILABLE', sampleWorkId: uploadId, verifiedAt: new Date() },
    });
    await client.vipSampleWorkCleanup.create({
      data: { id: randomUUID(), uploadId, objectKey: generationOneKey, uploadGeneration: 1,
        settleUntil: new Date(Date.now() - 1_000) },
    });
    expect(await processor.claimCleanups(new Date(Date.now() + 1_000))).toEqual([]);
    expect(storage.deleted).toEqual([]);
  });

  it('reclaims an interrupted cleanup claim after its lease expires', async () => {
    await processor.releaseExpiredUploads(new Date());
    const first = await processor.claimCleanups(new Date(Date.now() + 2_000));
    expect(first).toHaveLength(1);
    const reclaimed = await processor.claimCleanups(new Date(Date.now() + 8_000));
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]!.id).toBe(first[0]!.id);
    expect(reclaimed[0]!.claimGeneration).toBe(first[0]!.claimGeneration + 1n);
    expect(reclaimed[0]!.claimToken).not.toBe(first[0]!.claimToken);
  });
});

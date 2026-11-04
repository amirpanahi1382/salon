import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { AppConfig } from '@salon/config';
import { createPrismaClient } from '@salon/database';
import { S3CompatibleObjectStorage, type ObjectStorage, type StoredObject } from '@salon/object-storage';
import pino from 'pino';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ActivationReceiptRecoveryProcessor } from './activation-receipt-recovery.processor';

const appUrl = process.env.GATE3_ISOLATED_DATABASE_URL;
const adminUrl = process.env.GATE3_ADMIN_DATABASE_URL;
const hasMinio = Boolean(process.env.GATE3_MINIO_ACCESS_KEY && process.env.GATE3_MINIO_SECRET_KEY);
const describeIfDisposable = appUrl && adminUrl && appUrl === process.env.DATABASE_URL && hasMinio ? describe : describe.skip;
const body = Buffer.from('gate3-recovery-object');

class CountingStorage implements ObjectStorage {
  readonly deleted: string[] = [];
  constructor(readonly delegate: S3CompatibleObjectStorage) {}
  putObject(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> { return this.delegate.putObject(input); }
  preparePutObject(input: { key: string; body: Buffer; contentType: string; expiresAt: Date }) { return this.delegate.preparePutObject(input); }
  getObject(key: string) { return this.delegate.getObject(key); }
  async deleteObject(key: string) { this.deleted.push(key); return this.delegate.deleteObject(key); }
}

describeIfDisposable('activation receipt recovery quarantine (PostgreSQL + MinIO)', () => {
  jest.setTimeout(60_000);
  const app = createPrismaClient(appUrl!);
  const admin = createPrismaClient(adminUrl!);
  const storage = new CountingStorage(new S3CompatibleObjectStorage({
    MINIO_ENDPOINT: process.env.GATE3_MINIO_HOST!, MINIO_PORT: Number(process.env.GATE3_MINIO_PORT),
    MINIO_USE_SSL: false, MINIO_ACCESS_KEY: process.env.GATE3_MINIO_ACCESS_KEY!,
    MINIO_SECRET_KEY: process.env.GATE3_MINIO_SECRET_KEY!, MINIO_BUCKET: process.env.GATE3_MINIO_BUCKET!,
    MINIO_REQUEST_TIMEOUT_MS: 2_000,
  }));
  const config = { values: {
    NODE_ENV: 'test', LOG_LEVEL: 'silent', VIP_UPLOAD_RECOVERY_INTERVAL_MS: 60_000,
    VIP_UPLOAD_RECOVERY_BATCH_SIZE: 2, VIP_UPLOAD_LEASE_MS: 5_000,
    VIP_UPLOAD_CLEANUP_SETTLE_MS: 60_000, MINIO_REQUEST_TIMEOUT_MS: 1_000,
    ACTIVATION_RECEIPT_AUTOMATIC_CLEANUP_ENABLED: false,
  } as AppConfig } as AppConfigService;
  const processor = () => new ActivationReceiptRecoveryProcessor({ client: app } as PrismaService, config, storage, pino({ level: 'silent' }));

  beforeAll(async () => { await Promise.all([app.$connect(), admin.$connect()]); });
  afterAll(async () => { await Promise.all([app.$disconnect(), admin.$disconnect()]); });
  beforeEach(async () => {
    storage.deleted.splice(0);
    await admin.$executeRawUnsafe('TRUNCATE TABLE activation_receipt_upload_cleanups, activation_receipts CASCADE');
  });

  async function seed(phase: 'UPLOADING' | 'FAILED' | 'STORED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED', options: { owned?: boolean; expired?: boolean } = {}) {
    const id = randomUUID(), salonId = randomUUID(), key = `activation-receipts/${salonId}/${id}`;
    const owner = options.owned ? randomUUID() : null;
    const locked = options.owned ? new Date(Date.now() + (options.expired ? -10_000 : 60_000)) : null;
    const sha = createHash('sha256').update(body).digest('hex');
    await storage.putObject({ key, body, contentType: 'image/jpeg' });
    const storedAt = ['STORED', 'SUPERSEDED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'].includes(phase) ? new Date() : null;
    const reviewed = ['UNDER_REVIEW', 'APPROVED', 'REJECTED'].includes(phase);
    const decided = ['APPROVED', 'REJECTED'].includes(phase);
    await admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe(`
      INSERT INTO activation_receipts (id,salon_id,user_id,agreement_acceptance_id,object_key,content_type,byte_size,sha256,phase,stored_at,submitted_at,submission_idempotency_key,amount_irr,instruction_snapshot,instruction_digest,decided_at,decided_by_admin_id,decision_idempotency_key,rejection_reason,bank_attestation_wording,created_at,updated_at,upload_generation,upload_owner_token,upload_locked_until)
      VALUES ('${id}','${salonId}','${randomUUID()}','${randomUUID()}','${key}','image/jpeg',${body.length},'${sha}','${phase}',${storedAt ? 'clock_timestamp()' : 'NULL'},${reviewed ? 'clock_timestamp()' : 'NULL'},${reviewed ? `'fixture-${id}'` : 'NULL'},${reviewed ? '1.00' : 'NULL'},${reviewed ? "'{}'::jsonb" : 'NULL'},${reviewed ? `'${'a'.repeat(64)}'` : 'NULL'},${decided ? 'clock_timestamp()' : 'NULL'},${decided ? `'${randomUUID()}'` : 'NULL'},${decided ? `'decision-${id}'` : 'NULL'},${phase === 'REJECTED' ? "'fixture rejection'" : 'NULL'},${phase === 'APPROVED' ? "'واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام'" : 'NULL'},clock_timestamp(),clock_timestamp(),1,${owner ? `'${owner}'` : 'NULL'},${locked ? `'${locked.toISOString()}'` : 'NULL'})`);
    });
    return { id, salonId, key, owner, locked };
  }

  async function row(id: string) { return app.activationReceipt.findUniqueOrThrow({ where: { id } }); }

  it('quarantines an expired owned PUT durably, preserves bytes, and is idempotent across restart', async () => {
    const attempt = await seed('UPLOADING', { owned: true, expired: true });
    const now = new Date();
    await processor().tick(now);
    expect(await row(attempt.id)).toMatchObject({ phase: 'FAILED', uploadOwnerToken: null, uploadLastErrorCode: 'LEASE_EXPIRED' });
    expect(await app.activationReceiptUploadCleanup.count({ where: { receiptId: attempt.id } })).toBe(1);
    expect((await storage.getObject(attempt.key)).body).toEqual(body);
    await processor().tick(new Date(now.getTime() + 5_000));
    expect(await app.activationReceiptUploadCleanup.count({ where: { receiptId: attempt.id } })).toBe(1);
    expect(storage.deleted).toEqual([]);
    expect((await storage.getObject(attempt.key)).body).toEqual(body);
  });

  it('uses bounded FIFO expiry batches without legacy or quarantine starvation', async () => {
    const legacy = await seed('UPLOADING');
    const attempts = await Promise.all(Array.from({ length: 5 }, () => seed('UPLOADING', { owned: true, expired: true })));
    const old = await seed('FAILED');
    await app.activationReceiptUploadCleanup.create({ data: { id: randomUUID(), receiptId: old.id, objectKey: old.key, uploadGeneration: 1n, availableAt: new Date(0), settleUntil: new Date(Date.now() + 60_000) } });
    const worker = processor(), now = new Date();
    expect(await worker.releaseExpiredAttempts(now)).toBe(2);
    expect(await worker.releaseExpiredAttempts(now)).toBe(2);
    expect(await worker.releaseExpiredAttempts(now)).toBe(1);
    expect((await row(legacy.id)).phase).toBe('UPLOADING');
    expect(await app.activationReceiptUploadCleanup.count({ where: { receiptId: { in: attempts.map((item) => item.id) } } })).toBe(5);
    expect(await worker.claimCleanups(new Date(now.getTime() + 2_000))).toHaveLength(2);
    expect(storage.deleted).toEqual([]);
  });

  it('never claims protected history and does not call DELETE while quarantine-only is configured', async () => {
    const phases = ['STORED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;
    for (const phase of phases) {
      const receipt = await seed(phase);
      await app.activationReceiptUploadCleanup.create({ data: { id: randomUUID(), receiptId: receipt.id, objectKey: receipt.key, uploadGeneration: 1n, availableAt: new Date(0), settleUntil: new Date(Date.now() + 60_000) } });
    }
    expect(await processor().claimCleanups(new Date())).toEqual([]);
    expect(storage.deleted).toEqual([]);
  });

  it('fences finalization against recovery and preserves a prior STORED receipt after a replacement fails', async () => {
    const expired = await seed('UPLOADING', { owned: true, expired: true });
    const previous = await seed('STORED');
    await processor().releaseExpiredAttempts(new Date());
    const stale = await app.activationReceipt.updateMany({ where: { id: expired.id, phase: 'UPLOADING', uploadOwnerToken: expired.owner! }, data: { phase: 'STORED', storedAt: new Date(), uploadOwnerToken: null, uploadLockedUntil: null } });
    expect(stale.count).toBe(0);
    expect((await row(expired.id)).phase).toBe('FAILED');
    expect((await storage.getObject(previous.key)).body).toEqual(body);
    expect((await storage.getObject(expired.key)).body).toEqual(body);
  });

  it('lets a locked finalization commit STORED and its audit before recovery can observe expiry', async () => {
    const attempt = await seed('UPLOADING', { owned: true, expired: true });
    let locked!: () => void, release!: () => void;
    const lockHeld = new Promise<void>((resolve) => { locked = resolve; });
    const continueFinalization = new Promise<void>((resolve) => { release = resolve; });
    const finalization = app.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM activation_receipts WHERE id = ${attempt.id}::uuid FOR UPDATE`;
      locked();
      await continueFinalization;
      const changed = await tx.$executeRaw`
        UPDATE activation_receipts SET phase='STORED'::"ActivationReceiptPhase", stored_at=clock_timestamp(),
          upload_owner_token=NULL, upload_locked_until=NULL, updated_at=clock_timestamp()
        WHERE id=${attempt.id}::uuid AND phase='UPLOADING'::"ActivationReceiptPhase"
          AND upload_owner_token=${attempt.owner}::uuid AND upload_generation=1`;
      expect(changed).toBe(1);
      await tx.auditLog.create({ data: { id: randomUUID(), tenantId: attempt.salonId,
        action: 'ACTIVATION_RECEIPT_STORED', resource: 'activation_receipt', resourceId: attempt.id, result: 'SUCCESS' } });
    });
    await lockHeld;
    const recovery = processor().releaseExpiredAttempts(new Date());
    release();
    await finalization;
    expect(await recovery).toBe(0);
    expect((await row(attempt.id)).phase).toBe('STORED');
    expect(await app.auditLog.count({ where: { resourceId: attempt.id, action: 'ACTIVATION_RECEIPT_STORED' } })).toBe(1);
    expect(await app.activationReceiptUploadCleanup.count({ where: { receiptId: attempt.id } })).toBe(0);
    expect((await storage.getObject(attempt.key)).body).toEqual(body);
  });

  it('quarantines bytes after a child completes a production-adapter PUT then is terminated before finalization', async () => {
    const attempt = await seed('UPLOADING', { owned: true, expired: true });
    const source = `import { S3CompatibleObjectStorage } from '@salon/object-storage';
      const storage = new S3CompatibleObjectStorage({MINIO_ENDPOINT:process.env.GATE3_MINIO_HOST,MINIO_PORT:Number(process.env.GATE3_MINIO_PORT),MINIO_USE_SSL:false,MINIO_ACCESS_KEY:process.env.GATE3_MINIO_ACCESS_KEY,MINIO_SECRET_KEY:process.env.GATE3_MINIO_SECRET_KEY,MINIO_BUCKET:process.env.GATE3_MINIO_BUCKET,MINIO_REQUEST_TIMEOUT_MS:2000});
      await storage.preparePutObject({key:process.env.GATE3_KEY,body:Buffer.from('gate3-recovery-object'),contentType:'image/jpeg',expiresAt:new Date(Date.now()+30000)}).execute();
      process.stdout.write('PUT_COMPLETE\\n'); setInterval(()=>{},1000);`;
    const child = spawn('pnpm', ['--filter', '@salon/worker', 'exec', 'tsx', '-e', source], {
      cwd: process.cwd(), env: { ...process.env, GATE3_KEY: attempt.key }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child PUT did not complete')), 15_000);
      child.stdout.on('data', (data) => { if (data.toString().includes('PUT_COMPLETE')) { clearTimeout(timer); resolve(); } });
      child.once('error', reject);
    });
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    expect((await storage.getObject(attempt.key)).body).toEqual(body);
    expect(await processor().releaseExpiredAttempts(new Date())).toBe(1);
    expect((await row(attempt.id)).phase).toBe('FAILED');
    expect(await app.activationReceiptUploadCleanup.count({ where: { receiptId: attempt.id } })).toBe(1);
    expect((await storage.getObject(attempt.key)).body).toEqual(body);
    expect(storage.deleted).toEqual([]);
  });
});

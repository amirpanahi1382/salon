import type { AppConfig } from '@salon/config';
import type { ObjectStorage } from '@salon/object-storage';
import pino from 'pino';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VipSampleWorkRecoveryProcessor } from './vip-sample-work-recovery.processor';

describe('VipSampleWorkRecoveryProcessor', () => {
  const logger = pino({ level: 'silent' });
  const config = {
    values: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      VIP_UPLOAD_RECOVERY_INTERVAL_MS: 60_000,
      VIP_UPLOAD_RECOVERY_BATCH_SIZE: 10,
      VIP_UPLOAD_LEASE_MS: 30_000,
      MINIO_REQUEST_TIMEOUT_MS: 10_000,
      VIP_UPLOAD_CLEANUP_SETTLE_MS: 3_600_000,
    } as AppConfig,
  } as AppConfigService;

  function setup(options: { referenced?: boolean; terminalCount?: number; deleteFails?: boolean } = {}) {
    const cleanupUpdate = jest.fn().mockResolvedValue({ count: options.terminalCount ?? 1 });
    const prisma = {
      client: {
        vipSampleWork: {
          findFirst: jest.fn().mockResolvedValue(options.referenced ? { id: 'committed' } : null),
        },
        vipSampleWorkCleanup: { updateMany: cleanupUpdate },
      },
    } as unknown as PrismaService;
    const storage: ObjectStorage = {
      putObject: jest.fn(),
      getObject: jest.fn(),
      deleteObject: options.deleteFails
        ? jest.fn().mockRejectedValue(new Error('unavailable'))
        : jest.fn().mockResolvedValue(undefined),
    };
    return {
      prisma,
      storage,
      cleanupUpdate,
      processor: new VipSampleWorkRecoveryProcessor(prisma, config, storage, logger),
    };
  }

  const claim = {
    id: '11111111-1111-4111-8111-111111111111',
    objectKey: 'vip/tenant/request/upload/g1',
    claimGeneration: 2n,
    claimToken: 'owner-2',
    requestGeneration: 3n,
    settleUntil: new Date(0),
    deletePasses: 1,
  };

  it('never deletes an object that has become committed', async () => {
    const { processor, storage, cleanupUpdate } = setup({ referenced: true });
    await processor.processCleanup(claim);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(cleanupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestGeneration: 3n }),
      data: expect.objectContaining({ status: 'PENDING', lastErrorCode: 'OBJECT_BECAME_COMMITTED' }),
    }));
  });

  it('requires claim and request generations to terminally complete cleanup', async () => {
    const { processor, storage, cleanupUpdate } = setup({ terminalCount: 0 });
    await processor.processCleanup(claim);
    expect(storage.deleteObject).toHaveBeenCalledWith(claim.objectKey);
    expect(cleanupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: claim.id,
        status: 'PROCESSING',
        claimGeneration: 2n,
        claimToken: 'owner-2',
        requestGeneration: 3n,
      },
      data: expect.objectContaining({ status: 'PROCESSED' }),
    }));
  });

  it('returns failed storage deletion to a fenced retry', async () => {
    const { processor, cleanupUpdate } = setup({ deleteFails: true });
    await processor.processCleanup(claim);
    expect(cleanupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ claimGeneration: 2n, requestGeneration: 3n }),
      data: expect.objectContaining({ status: 'PENDING', lastErrorCode: 'STORAGE_DELETE_FAILED' }),
    }));
  });

  it('reschedules an early successful delete for a mandatory settlement-horizon pass', async () => {
    const { processor, cleanupUpdate } = setup();
    const settleUntil = new Date(Date.now() + 60_000);
    await processor.processCleanup({ ...claim, settleUntil, deletePasses: 0 }, new Date());
    expect(cleanupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestGeneration: claim.requestGeneration }),
      data: expect.objectContaining({
        status: 'PENDING',
        availableAt: settleUntil,
        deletePasses: { increment: 1 },
      }),
    }));
  });

  it('waits for active recovery work during graceful shutdown', async () => {
    const { processor } = setup();
    let finish!: () => void;
    const active = new Promise<void>((resolve) => { finish = resolve; });
    jest.spyOn(processor, 'releaseExpiredUploads').mockResolvedValue(0);
    jest.spyOn(processor, 'claimCleanups').mockResolvedValue([claim]);
    jest.spyOn(processor, 'processCleanup').mockReturnValue(active);
    const tick = processor.tick();
    let shutdownFinished = false;
    const shutdown = processor.onModuleDestroy().then(() => { shutdownFinished = true; });
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);
    finish();
    await Promise.all([tick, shutdown]);
    expect(shutdownFinished).toBe(true);
  });

  it('bounds a hung DELETE and returns the claim to retry', async () => {
    jest.useFakeTimers();
    try {
      const cleanupUpdate = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = { client: {
        vipSampleWork: { findFirst: jest.fn().mockResolvedValue(null) },
        vipSampleWorkCleanup: { updateMany: cleanupUpdate },
      } } as unknown as PrismaService;
      const storage = {
        putObject: jest.fn(), getObject: jest.fn(),
        deleteObject: jest.fn(() => new Promise<void>(() => undefined)),
      } as ObjectStorage;
      const processor = new VipSampleWorkRecoveryProcessor(prisma, config, storage, logger);
      const work = processor.processCleanup(claim);
      await jest.advanceTimersByTimeAsync(10_000);
      await work;
      expect(cleanupUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', lastErrorCode: 'STORAGE_DELETE_FAILED' }),
      }));
    } finally {
      jest.useRealTimers();
    }
  });
});

import type { AppConfig } from '@salon/config';
import { deleteExpiredIdempotencyBatch, deleteProcessedOutboxBatch } from '@salon/database';
import type { ObjectStorage } from '@salon/object-storage';
import pino from 'pino';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { RetentionProcessor } from '../../outbox/retention.processor';
import { VipSampleWorkRecoveryProcessor } from '../../vip/vip-sample-work-recovery.processor';

jest.mock('@salon/database', () => ({
  deleteExpiredIdempotencyBatch: jest.fn(),
  deleteProcessedOutboxBatch: jest.fn(),
}));

const synthetic = 'PHONE_FAKE_09120000000 BODY_FAKE_HELLO MONEY_FAKE_1234.56 TOKEN_FAKE_XYZ DBURL_FAKE_postgres OBJECT_FAKE_vip/key';

describe('worker polling diagnostics', () => {
  const config = { values: {
    NODE_ENV: 'test', LOG_LEVEL: 'trace',
    RETENTION_CLEANUP_BATCH_SIZE: 10, OUTBOX_PROCESSED_RETENTION_DAYS: 14,
    IDEMPOTENCY_RETENTION_DAYS: 7, VIP_UPLOAD_RECOVERY_INTERVAL_MS: 30_000,
  } as AppConfig } as AppConfigService;
  const prisma = { client: {} } as PrismaService;

  it('does not log raw retention error text or stack', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'trace' }, { write: (line: string) => { lines.push(line); } } as never);
    const error = new Error(synthetic);
    error.stack = `retention stack ${synthetic}`;
    (deleteProcessedOutboxBatch as jest.Mock).mockRejectedValueOnce(error);
    const processor = new RetentionProcessor(prisma, config, logger);
    await processor.tick();
    expect(lines.join('')).toContain('RETENTION_FAILED');
    expect(lines.join('')).toContain('retention.cleanup');
    expect(lines.join('')).not.toContain(synthetic);
    expect(deleteExpiredIdempotencyBatch).not.toHaveBeenCalled();
  });

  it('does not log raw VIP recovery error text or stack', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'trace' }, { write: (line: string) => { lines.push(line); } } as never);
    const storage = {} as ObjectStorage;
    const processor = new VipSampleWorkRecoveryProcessor(prisma, config, storage, logger);
    const error = new Error(synthetic);
    error.stack = `VIP recovery stack ${synthetic}`;
    jest.spyOn(processor, 'releaseExpiredUploads').mockRejectedValueOnce(error);
    await processor.tick();
    expect(lines.join('')).toContain('VIP_RECOVERY_FAILED');
    expect(lines.join('')).toContain('vip_sample_work_recovery.tick');
    expect(lines.join('')).not.toContain(synthetic);
  });
});

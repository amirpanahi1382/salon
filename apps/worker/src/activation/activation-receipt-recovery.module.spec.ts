import { Test } from '@nestjs/testing';
import type { AppConfig } from '@salon/config';
import { ActivationReceiptRecoveryModule } from './activation-receipt-recovery.module';
import { ActivationReceiptRecoveryProcessor } from './activation-receipt-recovery.processor';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { OutboxProcessor } from '../outbox/outbox.processor';

describe('ActivationReceiptRecoveryModule', () => {
  it('starts the quarantine processor without a storage adapter or any outbox provider', async () => {
    const config = {
      values: {
        NODE_ENV: 'test', LOG_LEVEL: 'silent', API_REVISION: 'test',
        VIP_UPLOAD_RECOVERY_INTERVAL_MS: 60_000,
        VIP_UPLOAD_RECOVERY_BATCH_SIZE: 2,
        VIP_UPLOAD_LEASE_MS: 5_000,
        VIP_UPLOAD_CLEANUP_SETTLE_MS: 60_000,
        MINIO_REQUEST_TIMEOUT_MS: 1_000,
        ACTIVATION_RECEIPT_AUTOMATIC_CLEANUP_ENABLED: false,
      } as AppConfig,
    } as AppConfigService;
    const module = await Test.createTestingModule({ imports: [ActivationReceiptRecoveryModule] })
      .overrideProvider(AppConfigService).useValue(config)
      .overrideProvider(PrismaService).useValue({ client: {} })
      .compile();
    await module.init();
    expect(module.get(ActivationReceiptRecoveryProcessor)).toBeInstanceOf(ActivationReceiptRecoveryProcessor);
    expect(() => module.get(OutboxProcessor)).toThrow();
    await module.close();
  });
});

import { Module } from '@nestjs/common';
import { AppConfigModule } from '../infrastructure/config/app-config.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { ActivationReceiptRecoveryProcessor } from './activation-receipt-recovery.processor';

/**
 * Quarantine-only process boundary. Deliberately excludes WorkerModule,
 * outbox handlers, provider clients, VIP recovery and retention processors.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule],
  providers: [ActivationReceiptRecoveryProcessor],
})
export class ActivationReceiptRecoveryModule {}

import { Module } from '@nestjs/common';
import { AppConfigModule } from './infrastructure/config/app-config.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { BaleSafirMessageSender } from './messaging/bale-safir.sender';
import { SendCustomerMessageHandler } from './messaging/send-customer-message.handler';
import { OutboxProcessor } from './outbox/outbox.processor';
import { RetentionProcessor } from './outbox/retention.processor';
import { S3CompatibleObjectStorage } from '@salon/object-storage';
import { AppConfigService } from './infrastructure/config/app-config.service';
import {
  VIP_OBJECT_STORAGE,
  VipSampleWorkRecoveryProcessor,
} from './vip/vip-sample-work-recovery.processor';

@Module({
  imports: [AppConfigModule, DatabaseModule],
  providers: [
    BaleSafirMessageSender,
    SendCustomerMessageHandler,
    OutboxProcessor,
    RetentionProcessor,
    {
      provide: VIP_OBJECT_STORAGE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new S3CompatibleObjectStorage(config.values),
    },
    VipSampleWorkRecoveryProcessor,
  ],
})
export class WorkerModule {}

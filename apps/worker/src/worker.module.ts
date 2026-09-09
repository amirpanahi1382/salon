import { Module } from '@nestjs/common';
import { AppConfigModule } from './infrastructure/config/app-config.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { BaleSafirMessageSender } from './messaging/bale-safir.sender';
import { SendCustomerMessageHandler } from './messaging/send-customer-message.handler';
import { OutboxProcessor } from './outbox/outbox.processor';
import { RetentionProcessor } from './outbox/retention.processor';

@Module({
  imports: [AppConfigModule, DatabaseModule],
  providers: [
    BaleSafirMessageSender,
    SendCustomerMessageHandler,
    OutboxProcessor,
    RetentionProcessor,
  ],
})
export class WorkerModule {}

import { Module } from '@nestjs/common';
import { AppConfigModule } from './infrastructure/config/app-config.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { OutboxProcessor } from './outbox/outbox.processor';
import { RetentionProcessor } from './outbox/retention.processor';

@Module({
  imports: [AppConfigModule, DatabaseModule],
  providers: [OutboxProcessor, RetentionProcessor],
})
export class WorkerModule {}

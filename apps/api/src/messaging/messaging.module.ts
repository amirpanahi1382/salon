import { Module } from '@nestjs/common';
import { ActionModule } from '../action/action.module';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { AdminMessageQueueController } from './admin-message-queue.controller';
import { AdminMessageRepository } from './admin-message.repository';
import {
  GetAdminMessageUseCase,
  ListAdminMessageQueueUseCase,
  MarkManualMessageSentUseCase,
  RetryBaleMessageUseCase,
  SelectMessageDeliveryModeUseCase,
} from './admin-message.use-cases';
import { MessagingController } from './messaging.controller';
import { GetMessageUseCase, ListCustomerMessagesUseCase } from './get-message.use-case';
import { MessageRepository } from './message.repository';
import { SendOpportunityMessageUseCase } from './send-opportunity-message.use-case';

@Module({
  imports: [AuthModule, ActionModule, CustomerModule],
  controllers: [MessagingController, AdminMessageQueueController],
  providers: [
    MessageRepository,
    AdminMessageRepository,
    SendOpportunityMessageUseCase,
    GetMessageUseCase,
    ListCustomerMessagesUseCase,
    ListAdminMessageQueueUseCase,
    GetAdminMessageUseCase,
    SelectMessageDeliveryModeUseCase,
    MarkManualMessageSentUseCase,
    RetryBaleMessageUseCase,
  ],
})
export class MessagingModule {}

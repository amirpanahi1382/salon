import { Module } from '@nestjs/common';
import { ActionModule } from '../action/action.module';
import { AuthModule } from '../auth/auth.module';
import { ContactPolicyModule } from '../contact-policy/contact-policy.module';
import { CustomerModule } from '../customer/customer.module';
import { ReturnCommitmentModule } from '../return-commitment/return-commitment.module';
import { AdminMessageQueueController } from './admin-message-queue.controller';
import { AdminNormalMessagesController } from './admin-normal-messages.controller';
import { AdminMessageRepository } from './admin-message.repository';
import { AdminNormalMessagesRepository } from './admin-normal-messages.repository';
import {
  GetAdminMessageUseCase,
  ListAdminMessageQueueUseCase,
  MarkManualMessageSentUseCase,
  RetryBaleMessageUseCase,
  SelectMessageDeliveryModeUseCase,
  CancelAdminMessageUseCase,
} from './admin-message.use-cases';
import { MessagingController } from './messaging.controller';
import { GetMessageUseCase, ListCustomerMessagesUseCase } from './get-message.use-case';
import { ListManualOutreachUseCase } from './list-manual-outreach.use-case';
import { ListOrdinaryMessageHistoryUseCase } from './list-ordinary-message-history.use-case';
import { MessageRepository } from './message.repository';
import { SendManualOutreachMessageUseCase } from './send-manual-outreach-message.use-case';
import { SendOpportunityMessageUseCase } from './send-opportunity-message.use-case';
import {
  GetAdminNormalSalonFolderUseCase,
  ListAdminNormalSalonFoldersUseCase,
} from './admin-normal-messages.use-cases';

@Module({
  imports: [AuthModule, ActionModule, CustomerModule, ReturnCommitmentModule, ContactPolicyModule],
  controllers: [MessagingController, AdminMessageQueueController, AdminNormalMessagesController],
  providers: [
    MessageRepository,
    AdminMessageRepository,
    AdminNormalMessagesRepository,
    SendOpportunityMessageUseCase,
    SendManualOutreachMessageUseCase,
    GetMessageUseCase,
    ListCustomerMessagesUseCase,
    ListManualOutreachUseCase,
    ListOrdinaryMessageHistoryUseCase,
    ListAdminMessageQueueUseCase,
    GetAdminMessageUseCase,
    SelectMessageDeliveryModeUseCase,
    MarkManualMessageSentUseCase,
    RetryBaleMessageUseCase,
    CancelAdminMessageUseCase,
    ListAdminNormalSalonFoldersUseCase,
    GetAdminNormalSalonFolderUseCase,
  ],
})
export class MessagingModule {}

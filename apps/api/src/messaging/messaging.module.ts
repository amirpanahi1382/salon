import { Module } from '@nestjs/common';
import { ActionModule } from '../action/action.module';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { MessagingController } from './messaging.controller';
import { GetMessageUseCase, ListCustomerMessagesUseCase } from './get-message.use-case';
import { MessageRepository } from './message.repository';
import { SendOpportunityMessageUseCase } from './send-opportunity-message.use-case';

@Module({
  imports: [AuthModule, ActionModule, CustomerModule],
  controllers: [MessagingController],
  providers: [
    MessageRepository,
    SendOpportunityMessageUseCase,
    GetMessageUseCase,
    ListCustomerMessagesUseCase,
  ],
})
export class MessagingModule {}

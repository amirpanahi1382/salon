import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { ActionController } from './action.controller';
import { ActionRepository } from './action.repository';
import { CreateActionUseCase } from './create-action.use-case';
import { CurrentOpportunityService } from './current-opportunity.service';
import { ListActionsUseCase, ListCustomerActionsUseCase } from './list-actions.use-case';
import { CompleteActionUseCase, DismissActionUseCase } from './transition-action.use-case';

@Module({
  imports: [AuthModule, CustomerModule, IntelligenceModule],
  controllers: [ActionController],
  providers: [
    ActionRepository,
    CurrentOpportunityService,
    CreateActionUseCase,
    ListActionsUseCase,
    ListCustomerActionsUseCase,
    CompleteActionUseCase,
    DismissActionUseCase,
  ],
  exports: [ActionRepository],
})
export class ActionModule {}

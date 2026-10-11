import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { VisitModule } from '../visit/visit.module';
import { AdminVisitIntentionController, VisitIntentionController } from './visit-intention.controller';
import { VisitIntentionRepository } from './visit-intention.repository';
import {
  AdminCreateCustomerVisitIntentionUseCase,
  AdminCreateVipVisitIntentionUseCase,
  AdminUpdateVisitIntentionUseCase,
  ArriveVisitIntentionUseCase,
  CreateCustomerVisitIntentionUseCase,
  CreateSalonVipVisitIntentionUseCase,
  LinkVisitIntentionUseCase,
  ListCustomerVisitIntentionsUseCase,
  ListFollowUpsUseCase,
  ListSalonVipVisitIntentionsUseCase,
  UpdateVisitIntentionUseCase,
} from './visit-intention.use-cases';

@Module({
  imports: [AuthModule, CustomerModule, VisitModule],
  controllers: [VisitIntentionController, AdminVisitIntentionController],
  providers: [
    VisitIntentionRepository,
    CreateCustomerVisitIntentionUseCase,
    AdminCreateCustomerVisitIntentionUseCase,
    CreateSalonVipVisitIntentionUseCase,
    ListSalonVipVisitIntentionsUseCase,
    AdminCreateVipVisitIntentionUseCase,
    UpdateVisitIntentionUseCase,
    AdminUpdateVisitIntentionUseCase,
    ListCustomerVisitIntentionsUseCase,
    ListFollowUpsUseCase,
    ArriveVisitIntentionUseCase,
    LinkVisitIntentionUseCase,
  ],
})
export class VisitIntentionModule {}

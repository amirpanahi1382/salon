import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { CreateVisitUseCase } from './create-visit.use-case';
import { GetVisitUseCase } from './get-visit.use-case';
import { ListCustomerVisitsUseCase } from './list-customer-visits.use-case';
import { VisitController } from './visit.controller';
import { VisitRepository } from './visit.repository';

@Module({
  imports: [AuthModule, CustomerModule],
  controllers: [VisitController],
  providers: [VisitRepository, CreateVisitUseCase, GetVisitUseCase, ListCustomerVisitsUseCase],
  exports: [VisitRepository],
})
export class VisitModule {}

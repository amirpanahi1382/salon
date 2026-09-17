import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { CompleteVisitWithSaleUseCase } from './complete-visit-with-sale.use-case';
import { CreateVisitUseCase } from './create-visit.use-case';
import { DeleteVisitUseCase } from './delete-visit.use-case';
import { GetVisitUseCase } from './get-visit.use-case';
import { ExportVisitsUseCase } from './export-visits.use-case';
import { ListCustomerVisitsUseCase } from './list-customer-visits.use-case';
import { ListVisitsUseCase } from './list-visits.use-case';
import { RecordCompletedVisit } from './record-completed-visit';
import { VisitController } from './visit.controller';
import { VisitRepository } from './visit.repository';

@Module({
  imports: [AuthModule, CustomerModule],
  controllers: [VisitController],
  providers: [
    VisitRepository,
    RecordCompletedVisit,
    CreateVisitUseCase,
    CompleteVisitWithSaleUseCase,
    GetVisitUseCase,
    ListVisitsUseCase,
    ListCustomerVisitsUseCase,
    ExportVisitsUseCase,
    DeleteVisitUseCase,
  ],
  exports: [VisitRepository, RecordCompletedVisit],
})
export class VisitModule {}

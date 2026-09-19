import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { VisitModule } from '../visit/visit.module';
import { AdminReturnCommitmentController } from './admin-return-commitment.controller';
import {
  AdminCreateReturnCommitmentUseCase,
  AdminUpdateReturnCommitmentUseCase,
} from './admin-return-commitment.use-case';
import { ArriveReturnCommitmentUseCase } from './arrive-return-commitment.use-case';
import { CreateReturnCommitmentUseCase } from './create-return-commitment.use-case';
import { LinkReturnCommitmentVisitUseCase } from './link-return-commitment-visit.use-case';
import {
  ListCustomerReturnCommitmentsUseCase,
  ListOpenReturnCommitmentsUseCase,
  ListUpcomingReturnCommitmentsUseCase,
} from './list-return-commitments.use-case';
import { ReturnCommitmentController } from './return-commitment.controller';
import { ReturnCommitmentRepository } from './return-commitment.repository';
import { UpdateReturnCommitmentUseCase } from './update-return-commitment.use-case';

@Module({
  imports: [AuthModule, CustomerModule, VisitModule],
  controllers: [ReturnCommitmentController, AdminReturnCommitmentController],
  providers: [
    ReturnCommitmentRepository,
    CreateReturnCommitmentUseCase,
    UpdateReturnCommitmentUseCase,
    AdminCreateReturnCommitmentUseCase,
    AdminUpdateReturnCommitmentUseCase,
    ArriveReturnCommitmentUseCase,
    LinkReturnCommitmentVisitUseCase,
    ListCustomerReturnCommitmentsUseCase,
    ListUpcomingReturnCommitmentsUseCase,
    ListOpenReturnCommitmentsUseCase,
  ],
  exports: [ReturnCommitmentRepository],
})
export class ReturnCommitmentModule {}

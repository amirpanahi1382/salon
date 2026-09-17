import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { VisitModule } from '../visit/visit.module';
import { ArriveReturnCommitmentUseCase } from './arrive-return-commitment.use-case';
import { CreateReturnCommitmentUseCase } from './create-return-commitment.use-case';
import { LinkReturnCommitmentVisitUseCase } from './link-return-commitment-visit.use-case';
import {
  ListCustomerReturnCommitmentsUseCase,
  ListUpcomingReturnCommitmentsUseCase,
} from './list-return-commitments.use-case';
import { ReturnCommitmentController } from './return-commitment.controller';
import { ReturnCommitmentRepository } from './return-commitment.repository';
import { UpdateReturnCommitmentUseCase } from './update-return-commitment.use-case';

@Module({
  imports: [AuthModule, CustomerModule, VisitModule],
  controllers: [ReturnCommitmentController],
  providers: [
    ReturnCommitmentRepository,
    CreateReturnCommitmentUseCase,
    UpdateReturnCommitmentUseCase,
    ArriveReturnCommitmentUseCase,
    LinkReturnCommitmentVisitUseCase,
    ListCustomerReturnCommitmentsUseCase,
    ListUpcomingReturnCommitmentsUseCase,
  ],
  exports: [ReturnCommitmentRepository],
})
export class ReturnCommitmentModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GetRecoveryOutcomesSummaryUseCase } from './get-recovery-outcomes-summary.use-case';
import { ListRecoveryOutcomeReturnsUseCase } from './list-recovery-outcome-returns.use-case';
import { RecoveryOutcomesController } from './recovery-outcomes.controller';
import { RecoveryOutcomesRepository } from './recovery-outcomes.repository';

@Module({
  imports: [AuthModule],
  controllers: [RecoveryOutcomesController],
  providers: [
    RecoveryOutcomesRepository,
    GetRecoveryOutcomesSummaryUseCase,
    ListRecoveryOutcomeReturnsUseCase,
  ],
})
export class RecoveryOutcomesModule {}

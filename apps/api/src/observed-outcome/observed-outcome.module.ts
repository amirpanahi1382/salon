import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { ListObservedReturnsUseCase } from './list-observed-returns.use-case';
import { ObservedOutcomeController } from './observed-outcome.controller';
import { ObservedOutcomeRepository } from './observed-outcome.repository';

@Module({
  imports: [AuthModule, CustomerModule],
  controllers: [ObservedOutcomeController],
  providers: [ObservedOutcomeRepository, ListObservedReturnsUseCase],
})
export class ObservedOutcomeModule {}

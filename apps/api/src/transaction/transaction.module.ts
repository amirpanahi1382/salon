import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { VisitModule } from '../visit/visit.module';
import { CreateTransactionUseCase } from './create-transaction.use-case';
import { GetTransactionUseCase } from './get-transaction.use-case';
import { ListTransactionsUseCase } from './list-transactions.use-case';
import { TransactionController } from './transaction.controller';
import { TransactionRepository } from './transaction.repository';
import { VoidTransactionUseCase } from './void-transaction.use-case';

@Module({
  imports: [AuthModule, CustomerModule, VisitModule],
  controllers: [TransactionController],
  providers: [
    TransactionRepository,
    CreateTransactionUseCase,
    GetTransactionUseCase,
    ListTransactionsUseCase,
    VoidTransactionUseCase,
  ],
  exports: [TransactionRepository],
})
export class TransactionModule {}

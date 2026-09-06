import { Injectable } from '@nestjs/common';
import { NotFoundError, type AuthenticatedPrincipal } from '@salon/shared';
import { toTransactionResponse } from './transaction.mapper';
import { TransactionRepository } from './transaction.repository';

@Injectable()
export class GetTransactionUseCase {
  constructor(private readonly transactions: TransactionRepository) {}

  async execute(principal: AuthenticatedPrincipal, id: string) {
    const row = await this.transactions.findById(principal.tenantId, id);
    if (!row) {
      throw new NotFoundError('Transaction not found');
    }
    return toTransactionResponse(row);
  }
}

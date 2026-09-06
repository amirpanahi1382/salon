import { Injectable } from '@nestjs/common';
import {
  createId,
  DOMAIN_EVENT_TYPES,
  NotFoundError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { toTransactionResponse } from './transaction.mapper';
import { TransactionRepository } from './transaction.repository';

@Injectable()
export class VoidTransactionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, id: string) {
    const existing = await this.transactions.findById(principal.tenantId, id);
    if (!existing) {
      throw new NotFoundError('Transaction not found');
    }
    if (existing.status === 'VOIDED') {
      return toTransactionResponse(existing);
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const voided = await tx.ledgerTransaction.updateMany({
        where: { id, salonId: principal.tenantId, status: 'COMPLETED' },
        data: { status: 'VOIDED' },
      });
      const current = await this.transactions.findById(principal.tenantId, id, tx);
      if (!current) {
        throw new NotFoundError('Transaction not found');
      }
      if (voided.count === 1) {
        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            eventType: DOMAIN_EVENT_TYPES.TransactionVoided,
            payload: { transactionId: id, customerId: current.customerId, salonId: principal.tenantId },
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'TRANSACTION_VOIDED',
            resource: 'transaction',
            resourceId: id,
            result: 'SUCCESS',
            metadata: { customerId: current.customerId, salonId: principal.tenantId },
          },
        });
      }
      return current;
    });
    return toTransactionResponse(updated);
  }
}

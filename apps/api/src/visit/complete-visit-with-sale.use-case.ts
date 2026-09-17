import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  assertCurrencyIrr,
  createId,
  formatMoneyString,
  NotFoundError,
  parseMoneyString,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { toTransactionResponse } from '../transaction/transaction.mapper';
import type { CompleteVisitWithSaleDto } from './visit.dto';
import {
  VISIT_COMPLETE_WITH_SALE_OPERATION,
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
  visitCompleteWithSaleRequestHash,
} from './idempotency';
import { RecordCompletedVisit } from './record-completed-visit';
import { toVisitResponse } from './visit.mapper';
import { parseCompletedVisitedAt } from './visited-at';

@Injectable()
export class CompleteVisitWithSaleUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recordVisit: RecordCompletedVisit,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    input: CompleteVisitWithSaleDto,
    rawIdempotencyKey: string | string[] | undefined,
  ) {
    const idempotencyKey = requireIdempotencyKey(rawIdempotencyKey);
    const visitedAt = parseCompletedVisitedAt(input.visitedAt);
    const currency = assertCurrencyIrr(input.currency);
    const amount = formatMoneyString(parseMoneyString(input.amount));
    const requestHash = visitCompleteWithSaleRequestHash({
      customerId: input.customerId,
      visitedAt: visitedAt.toISOString(),
      serviceId: input.serviceId,
      amount,
      currency,
    });
    const visitId = createId();
    const transactionId = createId();
    const now = new Date();

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: VISIT_COMPLETE_WITH_SALE_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'transaction',
          resourceId: transactionId,
        });

        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: VISIT_COMPLETE_WITH_SALE_OPERATION,
            key: idempotencyKey,
          });
          if (!existing) {
            throw new NotFoundError('Transaction not found');
          }
          assertSameIdempotentRequest(existing.requestHash, requestHash);
          return this.recordVisit.loadVisitWithSale(tx, principal.tenantId, existing.resourceId);
        }

        return this.recordVisit.createWithSale(tx, {
          principal,
          customerId: input.customerId,
          visitedAt,
          serviceId: input.serviceId,
          amount: input.amount,
          currency: input.currency,
          visitId,
          transactionId,
          now,
        });
      });

      return {
        visit: toVisitResponse(created.visit),
        transaction: toTransactionResponse(created.transaction),
      };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundError('Related record not found');
      }
      const mapped = mapPrismaError(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }
}

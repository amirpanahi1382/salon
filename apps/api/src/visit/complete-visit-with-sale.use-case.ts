import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  assertCurrencyIrr,
  createId,
  DOMAIN_EVENT_TYPES,
  ForbiddenError,
  formatMoneyString,
  multiplyMoney,
  NotFoundError,
  parseMoneyString,
  ValidationError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { TRANSACTION_INCLUDE, toTransactionResponse } from '../transaction/transaction.mapper';
import type { CompleteVisitWithSaleDto } from './visit.dto';
import {
  VISIT_COMPLETE_WITH_SALE_OPERATION,
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
  visitCompleteWithSaleRequestHash,
} from './idempotency';
import { VISIT_SELECT, toVisitResponse } from './visit.mapper';
import { parseCompletedVisitedAt } from './visited-at';

@Injectable()
export class CompleteVisitWithSaleUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerRepository,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    input: CompleteVisitWithSaleDto,
    rawIdempotencyKey: string | string[] | undefined,
  ) {
    if (principal.role !== 'OWNER' && principal.role !== 'MANAGER') {
      throw new ForbiddenError();
    }

    const idempotencyKey = requireIdempotencyKey(rawIdempotencyKey);
    const visitedAt = parseCompletedVisitedAt(input.visitedAt);
    const currency = assertCurrencyIrr(input.currency);
    const amountMinor = parseMoneyString(input.amount);
    if (amountMinor <= 0n) {
      throw new ValidationError('amount must be greater than 0');
    }
    const itemTotal = multiplyMoney(amountMinor, 1);
    if (itemTotal !== amountMinor) {
      throw new ValidationError('Sum of item totals must equal the transaction amount');
    }

    const amount = formatMoneyString(amountMinor);
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
          return this.loadResult(tx, principal.tenantId, existing.resourceId);
        }

        const customer = await this.customers.findById(principal.tenantId, input.customerId, tx);
        if (!customer) {
          throw new NotFoundError('Customer not found');
        }

        const service = await tx.service.findFirst({
          where: { id: input.serviceId, salonId: principal.tenantId },
          select: { id: true, status: true },
        });
        if (!service) {
          throw new NotFoundError('Service not found');
        }
        if (service.status !== 'ACTIVE') {
          throw new ValidationError('Inactive services cannot be used on new transactions');
        }

        await tx.visit.create({
          data: {
            id: visitId,
            salonId: principal.tenantId,
            customerId: customer.id,
            visitedAt,
            updatedAt: now,
          },
        });

        await tx.ledgerTransaction.create({
          data: {
            id: transactionId,
            salonId: principal.tenantId,
            customerId: customer.id,
            visitId,
            occurredAt: visitedAt,
            amount: new Prisma.Decimal(amount),
            currency,
            status: 'COMPLETED',
            updatedAt: now,
            items: {
              create: [
                {
                  id: createId(),
                  serviceId: service.id,
                  quantity: 1,
                  unitPrice: new Prisma.Decimal(amount),
                  totalAmount: new Prisma.Decimal(amount),
                },
              ],
            },
          },
        });

        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            eventType: DOMAIN_EVENT_TYPES.VisitCompleted,
            payload: {
              visitId,
              customerId: customer.id,
              salonId: principal.tenantId,
              visitedAt: visitedAt.toISOString(),
            },
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            eventType: DOMAIN_EVENT_TYPES.TransactionCreated,
            payload: {
              transactionId,
              customerId: customer.id,
              salonId: principal.tenantId,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'VISIT_CREATED',
            resource: 'visit',
            resourceId: visitId,
            result: 'SUCCESS',
            metadata: { customerId: customer.id },
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            tenantId: principal.tenantId,
            actorId: principal.userId,
            action: 'TRANSACTION_CREATED',
            resource: 'transaction',
            resourceId: transactionId,
            result: 'SUCCESS',
            metadata: { customerId: customer.id, salonId: principal.tenantId, visitId },
          },
        });

        return this.loadResult(tx, principal.tenantId, transactionId);
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

  private async loadResult(
    tx: Prisma.TransactionClient,
    tenantId: string,
    transactionId: string,
  ) {
    const transaction = await tx.ledgerTransaction.findFirst({
      where: { id: transactionId, salonId: tenantId },
      include: TRANSACTION_INCLUDE,
    });
    if (!transaction?.visitId) {
      throw new NotFoundError('Transaction not found');
    }
    const visit = await tx.visit.findFirst({
      where: { id: transaction.visitId, salonId: tenantId },
      select: VISIT_SELECT,
    });
    if (!visit) {
      throw new NotFoundError('Visit not found');
    }
    return { visit, transaction };
  }
}

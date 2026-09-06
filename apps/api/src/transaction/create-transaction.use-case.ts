import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  addMoney,
  assertCurrencyIrr,
  createId,
  DOMAIN_EVENT_TYPES,
  formatMoneyString,
  multiplyMoney,
  NotFoundError,
  parseMoneyString,
  ValidationError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { CustomerRepository } from '../customer/customer.repository';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
} from '../infrastructure/http/idempotency';
import { mapPrismaError } from '../infrastructure/http/prisma-error';
import { VisitRepository } from '../visit/visit.repository';
import { parseCompletedVisitedAt } from '../visit/visited-at';
import {
  TRANSACTION_CREATE_OPERATION,
  transactionCreateRequestHash,
} from './transaction-idempotency';
import type { CreateTransactionDto } from './transaction.dto';
import { toTransactionResponse } from './transaction.mapper';
import { TransactionRepository } from './transaction.repository';

const MAX_ITEMS = 50;

@Injectable()
export class CreateTransactionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerRepository,
    private readonly visits: VisitRepository,
    private readonly transactions: TransactionRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, input: CreateTransactionDto, idempotencyKey: string) {
    if (input.items.length > MAX_ITEMS) {
      throw new ValidationError('A transaction may contain at most 50 line items');
    }
    const currency = assertCurrencyIrr(input.currency);
    const occurredAt = parseCompletedVisitedAt(input.occurredAt);
    const amountMinor = parseMoneyString(input.amount);
    const itemMinors = input.items.map((item) => {
      const unit = parseMoneyString(item.unitPrice);
      return {
        serviceId: item.serviceId,
        quantity: item.quantity,
        unitMinor: unit,
        totalMinor: multiplyMoney(unit, item.quantity),
      };
    });
    const itemsSum = addMoney(itemMinors.map((item) => item.totalMinor));
    if (itemsSum !== amountMinor) {
      throw new ValidationError('Sum of item totals must equal the transaction amount');
    }

    const requestHash = transactionCreateRequestHash({
      customerId: input.customerId,
      visitId: input.visitId ?? null,
      occurredAt: occurredAt.toISOString(),
      amount: formatMoneyString(amountMinor),
      currency,
      items: input.items.map((item) => ({
        serviceId: item.serviceId,
        quantity: item.quantity,
        unitPrice: formatMoneyString(parseMoneyString(item.unitPrice)),
      })),
    });
    const transactionId = createId();

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          operation: TRANSACTION_CREATE_OPERATION,
          key: idempotencyKey,
          requestHash,
          resourceType: 'transaction',
          resourceId: transactionId,
        });
        if (!claim.inserted) {
          const existing = await findIdempotencyRecord(tx, {
            tenantId: principal.tenantId,
            actorId: principal.userId,
            operation: TRANSACTION_CREATE_OPERATION,
            key: idempotencyKey,
          });
          if (!existing) {
            throw new NotFoundError('Transaction not found');
          }
          assertSameIdempotentRequest(existing.requestHash, requestHash);
          const replay = await this.transactions.findById(principal.tenantId, existing.resourceId, tx);
          if (!replay) {
            throw new NotFoundError('Transaction not found');
          }
          return replay;
        }

        const customer = await this.customers.findById(principal.tenantId, input.customerId, tx);
        if (!customer) {
          throw new NotFoundError('Customer not found');
        }

        if (input.visitId) {
          const visit = await this.visits.findById(principal.tenantId, input.visitId, tx);
          if (!visit) {
            throw new NotFoundError('Visit not found');
          }
          if (visit.customerId !== customer.id) {
            throw new ValidationError('visitId must belong to the same customer');
          }
        }

        const serviceIds = [...new Set(itemMinors.map((item) => item.serviceId))];
        const services = await tx.service.findMany({
          where: { salonId: principal.tenantId, id: { in: serviceIds } },
          select: { id: true, status: true },
        });
        if (services.length !== serviceIds.length) {
          throw new NotFoundError('Service not found');
        }
        if (services.some((service) => service.status !== 'ACTIVE')) {
          throw new ValidationError('Inactive services cannot be used on new transactions');
        }

        await tx.ledgerTransaction.create({
          data: {
            id: transactionId,
            salonId: principal.tenantId,
            customerId: customer.id,
            visitId: input.visitId ?? null,
            occurredAt,
            amount: new Prisma.Decimal(formatMoneyString(amountMinor)),
            currency,
            status: 'COMPLETED',
            updatedAt: new Date(),
            items: {
                create: itemMinors.map((item) => ({
                id: createId(),
                serviceId: item.serviceId,
                quantity: item.quantity,
                unitPrice: new Prisma.Decimal(formatMoneyString(item.unitMinor)),
                totalAmount: new Prisma.Decimal(formatMoneyString(item.totalMinor)),
              })),
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
            action: 'TRANSACTION_CREATED',
            resource: 'transaction',
            resourceId: transactionId,
            result: 'SUCCESS',
            metadata: { customerId: customer.id, salonId: principal.tenantId },
          },
        });

        const loaded = await this.transactions.findById(principal.tenantId, transactionId, tx);
        if (!loaded) {
          throw new NotFoundError('Transaction not found');
        }
        return loaded;
      });
      return toTransactionResponse(created);
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

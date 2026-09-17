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
import { TRANSACTION_INCLUDE } from '../transaction/transaction.mapper';
import { VISIT_SELECT } from './visit.mapper';

export type RecordedVisit = {
  id: string;
  customerId: string;
  visitedAt: Date;
  createdAt: Date;
};

@Injectable()
export class RecordCompletedVisit {
  constructor(private readonly customers: CustomerRepository) {}

  async create(
    tx: Prisma.TransactionClient,
    input: {
      principal: AuthenticatedPrincipal;
      customerId: string;
      visitedAt: Date;
      visitId: string;
      now: Date;
    },
  ): Promise<RecordedVisit> {
    const customer = await this.customers.findById(
      input.principal.tenantId,
      input.customerId,
      tx,
    );
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }
    return this.writeVisit(tx, {
      principal: input.principal,
      customerId: customer.id,
      visitedAt: input.visitedAt,
      visitId: input.visitId,
      now: input.now,
    });
  }

  async createWithSale(
    tx: Prisma.TransactionClient,
    input: {
      principal: AuthenticatedPrincipal;
      customerId: string;
      visitedAt: Date;
      serviceId: string;
      amount: string;
      currency?: string;
      visitId: string;
      transactionId: string;
      now: Date;
    },
  ) {
    if (input.principal.role !== 'OWNER' && input.principal.role !== 'MANAGER') {
      throw new ForbiddenError();
    }

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

    const customer = await this.customers.findById(
      input.principal.tenantId,
      input.customerId,
      tx,
    );
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    const service = await tx.service.findFirst({
      where: { id: input.serviceId, salonId: input.principal.tenantId },
      select: { id: true, status: true },
    });
    if (!service) {
      throw new NotFoundError('Service not found');
    }
    if (service.status !== 'ACTIVE') {
      throw new ValidationError('Inactive services cannot be used on new transactions');
    }

    await this.writeVisit(tx, {
      principal: input.principal,
      customerId: customer.id,
      visitedAt: input.visitedAt,
      visitId: input.visitId,
      now: input.now,
    });

    await tx.ledgerTransaction.create({
      data: {
        id: input.transactionId,
        salonId: input.principal.tenantId,
        customerId: customer.id,
        visitId: input.visitId,
        occurredAt: input.visitedAt,
        amount: new Prisma.Decimal(amount),
        currency,
        status: 'COMPLETED',
        updatedAt: input.now,
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
        tenantId: input.principal.tenantId,
        eventType: DOMAIN_EVENT_TYPES.TransactionCreated,
        payload: {
          transactionId: input.transactionId,
          customerId: customer.id,
          salonId: input.principal.tenantId,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: input.principal.tenantId,
        actorId: input.principal.userId,
        action: 'TRANSACTION_CREATED',
        resource: 'transaction',
        resourceId: input.transactionId,
        result: 'SUCCESS',
        metadata: {
          customerId: customer.id,
          salonId: input.principal.tenantId,
          visitId: input.visitId,
        },
      },
    });

    return this.loadVisitWithSale(tx, input.principal.tenantId, input.transactionId);
  }

  async loadVisitWithSale(
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

  private async writeVisit(
    tx: Prisma.TransactionClient,
    input: {
      principal: AuthenticatedPrincipal;
      customerId: string;
      visitedAt: Date;
      visitId: string;
      now: Date;
    },
  ): Promise<RecordedVisit> {
    const visit = await tx.visit.create({
      data: {
        id: input.visitId,
        salonId: input.principal.tenantId,
        customerId: input.customerId,
        visitedAt: input.visitedAt,
        updatedAt: input.now,
      },
      select: VISIT_SELECT,
    });

    await tx.outboxEvent.create({
      data: {
        id: createId(),
        tenantId: input.principal.tenantId,
        eventType: DOMAIN_EVENT_TYPES.VisitCompleted,
        payload: {
          visitId: input.visitId,
          customerId: input.customerId,
          salonId: input.principal.tenantId,
          visitedAt: input.visitedAt.toISOString(),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: input.principal.tenantId,
        actorId: input.principal.userId,
        action: 'VISIT_CREATED',
        resource: 'visit',
        resourceId: input.visitId,
        result: 'SUCCESS',
        metadata: { customerId: input.customerId },
      },
    });

    return visit;
  }
}

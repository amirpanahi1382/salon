import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  createId,
  DOMAIN_EVENT_TYPES,
  NotFoundError,
  type AuthenticatedPrincipal,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { CustomerRepository } from './customer.repository';

@Injectable()
export class DeleteCustomerUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerRepository,
  ) {}

  async execute(principal: AuthenticatedPrincipal, customerId: string) {
    const existing = await this.customers.findById(principal.tenantId, customerId);
    if (!existing) {
      throw new NotFoundError('Customer not found');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.prisma.client.$transaction(async (tx) => {
        const financialCount = await tx.ledgerTransaction.count({
          where: { salonId: principal.tenantId, customerId: existing.id },
        });
        if (financialCount > 0) {
          throw new ConflictError('Customer cannot be deleted while financial records exist');
        }
        const removedMessages = await tx.messageDelivery.deleteMany({
            where: { salonId: principal.tenantId, customerId: existing.id },
          });
        const removedActions = await tx.opportunityAction.deleteMany({
            where: { salonId: principal.tenantId, customerId: existing.id },
          });
          const removedVisits = await tx.visit.deleteMany({
            where: { salonId: principal.tenantId, customerId: existing.id },
          });
          const deleted = await tx.customer.deleteMany({
            where: { id: existing.id, salonId: principal.tenantId },
          });
          if (deleted.count === 0) {
            throw new NotFoundError('Customer not found');
          }

          await tx.outboxEvent.create({
            data: {
              id: createId(),
              tenantId: principal.tenantId,
              eventType: DOMAIN_EVENT_TYPES.CustomerDeleted,
              payload: {
                customerId: existing.id,
                salonId: principal.tenantId,
                visitCount: removedVisits.count,
                actionCount: removedActions.count,
                messageCount: removedMessages.count,
              },
            },
          });

          await tx.auditLog.create({
            data: {
              id: createId(),
              tenantId: principal.tenantId,
              actorId: principal.userId,
              action: 'CUSTOMER_DELETED',
              resource: 'customer',
              resourceId: existing.id,
              result: 'SUCCESS',
              metadata: {
                visitCount: removedVisits.count,
                actionCount: removedActions.count,
                messageCount: removedMessages.count,
                salonId: principal.tenantId,
              },
            },
          });
        });
        return;
      } catch (error: unknown) {
        if (error instanceof NotFoundError || error instanceof ConflictError) {
          throw error;
        }
        // A visit can be inserted after deleteMany(visits) and before customer delete.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
          const financialCount = await this.prisma.client.ledgerTransaction.count({
            where: { salonId: principal.tenantId, customerId: existing.id },
          });
          if (financialCount > 0) {
            throw new ConflictError('Customer cannot be deleted while financial records exist');
          }
          if (attempt < 2) {
            continue;
          }
          throw new ConflictError('Customer could not be deleted because related records changed');
        }
        throw error;
      }
    }
  }
}

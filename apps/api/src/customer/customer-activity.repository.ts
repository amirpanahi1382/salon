import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  activityKeysetOr,
  CUSTOMER_ACTIVITY_LIST_LIMIT,
  mergeCustomerActivity,
  type CustomerActivityCursor,
  type CustomerActivityRow,
} from './customer-activity';

@Injectable()
export class CustomerActivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForCustomer(
    tenantId: string,
    customerId: string,
    cursor?: CustomerActivityCursor,
  ): Promise<CustomerActivityRow[]> {
    const take = CUSTOMER_ACTIVITY_LIST_LIMIT + 1;
    const visitCursor = activityKeysetOr('visitedAt', 'VISIT', cursor);
    const transactionCursor = activityKeysetOr('occurredAt', 'TRANSACTION', cursor);
    const actionCursor = activityKeysetOr('createdAt', 'OPPORTUNITY_ACTION', cursor);
    const messageCursor = activityKeysetOr('requestedAt', 'MANUAL_MESSAGE', cursor);

    const [visits, transactions, actions, messages] = await Promise.all([
      this.prisma.client.visit.findMany({
        where: { salonId: tenantId, customerId, ...(visitCursor ?? {}) },
        select: { id: true, visitedAt: true, createdAt: true },
        orderBy: [{ visitedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.client.ledgerTransaction.findMany({
        where: { salonId: tenantId, customerId, ...(transactionCursor ?? {}) },
        select: { id: true, occurredAt: true, createdAt: true, status: true },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.client.opportunityAction.findMany({
        where: { salonId: tenantId, customerId, status: { not: 'DISMISSED' }, ...(actionCursor ?? {}) },
        select: { id: true, createdAt: true, status: true, opportunityType: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.client.messageRequest.findMany({
        where: {
          salonId: tenantId,
          customerId,
          actionId: null,
          opportunityType: null,
          ...(messageCursor ?? {}),
        },
        select: { id: true, requestedAt: true, createdAt: true, status: true },
        orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
    ]);

    return mergeCustomerActivity(
      [
        visits.map((row) => ({
          id: row.id,
          type: 'VISIT' as const,
          occurredAt: row.visitedAt,
          createdAt: row.createdAt,
          status: null,
          opportunityType: null,
        })),
        transactions.map((row) => ({
          id: row.id,
          type: 'TRANSACTION' as const,
          occurredAt: row.occurredAt,
          createdAt: row.createdAt,
          status: row.status,
          opportunityType: null,
        })),
        actions.map((row) => ({
          id: row.id,
          type: 'OPPORTUNITY_ACTION' as const,
          occurredAt: row.createdAt,
          createdAt: row.createdAt,
          status: row.status,
          opportunityType: row.opportunityType,
        })),
        messages.map((row) => ({
          id: row.id,
          type: 'MANUAL_MESSAGE' as const,
          occurredAt: row.requestedAt,
          createdAt: row.createdAt,
          status: row.status,
          opportunityType: null,
        })),
      ],
      CUSTOMER_ACTIVITY_LIST_LIMIT,
    );
  }
}

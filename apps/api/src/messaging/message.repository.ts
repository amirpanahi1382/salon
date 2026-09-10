import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { MESSAGE_REQUEST_SELECT } from './message.mapper';

export const MESSAGE_LIST_LIMIT = 200;

type MessageDb = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class MessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  findRequestById(tenantId: string, id: string, db: MessageDb = this.prisma.client) {
    return db.messageRequest.findFirst({
      where: { id, salonId: tenantId },
      select: MESSAGE_REQUEST_SELECT,
    });
  }

  /**
   * Inserts an enforceable daily-limit request without aborting `tx` on conflict.
   * PostgreSQL unique violations abort interactive transactions; ON CONFLICT does not.
   */
  async insertEnforceableIfAbsent(
    tx: Prisma.TransactionClient,
    input: {
      id: string;
      salonId: string;
      customerId: string;
      actionId: string | null;
      createdByUserId: string;
      opportunityType: string | null;
      messageText: string;
      requestedAt: Date;
      messageBusinessDate: Date;
    },
  ): Promise<boolean> {
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO message_requests (
        id, salon_id, customer_id, action_id, created_by_user_id, opportunity_type,
        message_text, requested_at, message_business_date, counts_toward_daily_limit,
        status, created_at, updated_at
      )
      VALUES (
        ${input.id}::uuid,
        ${input.salonId}::uuid,
        ${input.customerId}::uuid,
        ${input.actionId}::uuid,
        ${input.createdByUserId}::uuid,
        CAST(${input.opportunityType} AS "OpportunityActionType"),
        ${input.messageText},
        ${input.requestedAt},
        ${input.messageBusinessDate}::date,
        true,
        'QUEUED'::"MessageRequestStatus",
        ${input.requestedAt},
        ${input.requestedAt}
      )
      ON CONFLICT (salon_id, customer_id, message_business_date) WHERE counts_toward_daily_limit
      DO NOTHING
      RETURNING id
    `;
    return inserted.length > 0;
  }

  findRequestByDeliveryId(tenantId: string, deliveryId: string, db: MessageDb = this.prisma.client) {
    return db.messageRequest.findFirst({
      where: { salonId: tenantId, deliveries: { some: { id: deliveryId, salonId: tenantId } } },
      select: MESSAGE_REQUEST_SELECT,
    });
  }

  listForCustomer(
    tenantId: string,
    customerId: string,
    cursor?: { createdAt: Date; id: string },
  ) {
    return this.prisma.client.messageRequest.findMany({
      where: {
        salonId: tenantId,
        customerId,
        ...(cursor
          ? {
              OR: [
                { requestedAt: { lt: cursor.createdAt } },
                { requestedAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: MESSAGE_REQUEST_SELECT,
      orderBy: [{ requestedAt: 'desc' as const }, { id: 'desc' as const }],
      take: MESSAGE_LIST_LIMIT + 1,
    });
  }
}

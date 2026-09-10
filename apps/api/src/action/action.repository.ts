import { Injectable } from '@nestjs/common';
import { Prisma, type OpportunityActionStatus, type OpportunityActionType } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ACTION_SELECT } from './action.mapper';

export const ACTION_LIST_LIMIT = 200;

type ActionDb = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class ActionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tenantId: string, id: string, db: ActionDb = this.prisma.client) {
    return db.opportunityAction.findFirst({
      where: { id, salonId: tenantId },
      select: ACTION_SELECT,
    });
  }

  findOpen(
    tenantId: string,
    customerId: string,
    opportunityType: OpportunityActionType,
    db: ActionDb = this.prisma.client,
  ) {
    return db.opportunityAction.findFirst({
      where: { salonId: tenantId, customerId, opportunityType, status: 'OPEN' },
      select: ACTION_SELECT,
    });
  }

  /**
   * Inserts OPEN without aborting the transaction when the partial unique index
   * already has a row. ON CONFLICT DO NOTHING does not raise, so callers may
   * query the same `tx` afterward. Never follow a P2002 with another `tx` query.
   */
  async insertOpenIfAbsent(
    tx: Prisma.TransactionClient,
    input: {
      id: string;
      salonId: string;
      customerId: string;
      opportunityType: OpportunityActionType;
      createdBy: string;
      now: Date;
    },
  ): Promise<boolean> {
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO opportunity_actions (
        id, salon_id, customer_id, opportunity_type, status, created_by, created_at, updated_at
      )
      VALUES (
        ${input.id}::uuid,
        ${input.salonId}::uuid,
        ${input.customerId}::uuid,
        CAST(${input.opportunityType} AS "OpportunityActionType"),
        'OPEN'::"OpportunityActionStatus",
        ${input.createdBy}::uuid,
        ${input.now},
        ${input.now}
      )
      ON CONFLICT (salon_id, customer_id, opportunity_type) WHERE status = 'OPEN'
      DO NOTHING
      RETURNING id
    `;
    return inserted.length > 0;
  }

  deleteForCustomer(tenantId: string, customerId: string, db: ActionDb = this.prisma.client) {
    return db.opportunityAction.deleteMany({
      where: { salonId: tenantId, customerId },
    });
  }

  list(
    tenantId: string,
    filters: {
      customerId?: string;
      status?: OpportunityActionStatus;
      cursor?: { createdAt: Date; id: string };
    },
  ) {
    return this.prisma.client.opportunityAction.findMany({
      where: {
        salonId: tenantId,
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.cursor ? actionCursorWhere(filters.cursor) : {}),
      },
      select: ACTION_SELECT,
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: ACTION_LIST_LIMIT + 1,
    });
  }
}

function actionCursorWhere(cursor: { createdAt: Date; id: string }) {
  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
  };
}

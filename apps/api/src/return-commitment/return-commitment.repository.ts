import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { completedRevenueByVisitIds } from '../transaction/completed-visit-revenue';
import { RETURN_COMMITMENT_LIST_LIMIT } from './upcoming-window';
import {
  RETURN_COMMITMENT_SELECT,
  toCommitmentBackedReturn,
  toReturnCommitmentResponse,
  type ReturnCommitmentRow,
} from './return-commitment.mapper';
import type { ReturnCommitmentResponseDto } from './return-commitment.dto';

type Db = Prisma.TransactionClient | PrismaService['client'];

export type ReturnCommitmentSource = {
  requestId: string;
  deliveryId: string;
  customerId: string;
  requestCustomerId: string | null;
  vipRequestId: string | null;
  deliveryCustomerId: string | null;
  deliveryStatus: string;
  submittedAt: Date | null;
};

@Injectable()
export class ReturnCommitmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tenantId: string, id: string, db: Db = this.prisma.client) {
    return db.returnCommitment.findFirst({
      where: { id, salonId: tenantId },
      select: RETURN_COMMITMENT_SELECT,
    });
  }

  async lockByIdForUpdate(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<ReturnCommitmentRow | null> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        customer_id: string;
        source_message_request_id: string;
        source_message_delivery_id: string;
        expected_at: Date;
        actual_visit_id: string | null;
        created_by_user_id: string;
        updated_by_user_id: string;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT
        id,
        customer_id,
        source_message_request_id,
        source_message_delivery_id,
        expected_at,
        actual_visit_id,
        created_by_user_id,
        updated_by_user_id,
        created_at,
        updated_at
      FROM return_commitments
      WHERE id = ${id}::uuid AND salon_id = ${tenantId}::uuid
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      customerId: row.customer_id,
      sourceMessageRequestId: row.source_message_request_id,
      sourceMessageDeliveryId: row.source_message_delivery_id,
      expectedAt: row.expected_at,
      actualVisitId: row.actual_visit_id,
      createdByUserId: row.created_by_user_id,
      updatedByUserId: row.updated_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  findByActualVisitId(tenantId: string, visitId: string, db: Db = this.prisma.client) {
    return db.returnCommitment.findFirst({
      where: { salonId: tenantId, actualVisitId: visitId },
      select: RETURN_COMMITMENT_SELECT,
    });
  }

  linkActualVisit(input: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    id: string;
    visitId: string;
    actorId: string;
    now: Date;
  }) {
    return input.tx.returnCommitment.updateMany({
      where: {
        id: input.id,
        salonId: input.tenantId,
        actualVisitId: null,
      },
      data: {
        actualVisitId: input.visitId,
        updatedByUserId: input.actorId,
        updatedAt: input.now,
      },
    });
  }

  async toReadModels(
    tenantId: string,
    rows: ReturnCommitmentRow[],
    db: Db = this.prisma.client,
  ): Promise<ReturnCommitmentResponseDto[]> {
    const visitIds = [...new Set(rows.map((row) => row.actualVisitId).filter((id): id is string => Boolean(id)))];
    const visits =
      visitIds.length === 0
        ? []
        : await db.visit.findMany({
            where: { salonId: tenantId, id: { in: visitIds } },
            select: { id: true, customerId: true, visitedAt: true },
          });
    const visitById = new Map(visits.map((visit) => [visit.id, visit]));
    const visitIdsByCustomer = new Map<string, string[]>();
    for (const visit of visits) {
      const current = visitIdsByCustomer.get(visit.customerId) ?? [];
      current.push(visit.id);
      visitIdsByCustomer.set(visit.customerId, current);
    }
    const revenueByVisit = new Map<string, bigint>();
    for (const [customerId, ids] of visitIdsByCustomer) {
      const amounts = await completedRevenueByVisitIds(db, tenantId, customerId, ids);
      for (const [visitId, amount] of amounts) {
        revenueByVisit.set(visitId, amount);
      }
    }

    return rows.map((row) => {
      if (!row.actualVisitId) {
        return toReturnCommitmentResponse(row, null);
      }
      const visit = visitById.get(row.actualVisitId);
      if (!visit) {
        return toReturnCommitmentResponse(row, null);
      }
      return toReturnCommitmentResponse(
        row,
        toCommitmentBackedReturn(visit, revenueByVisit.get(visit.id)),
      );
    });
  }

  async toReadModel(
    tenantId: string,
    row: ReturnCommitmentRow,
    db: Db = this.prisma.client,
  ): Promise<ReturnCommitmentResponseDto> {
    const [mapped] = await this.toReadModels(tenantId, [row], db);
    return mapped ?? toReturnCommitmentResponse(row, null);
  }

  findBySourceRequestId(tenantId: string, requestId: string, db: Db = this.prisma.client) {
    return db.returnCommitment.findFirst({
      where: { salonId: tenantId, sourceMessageRequestId: requestId },
      select: RETURN_COMMITMENT_SELECT,
    });
  }

  findSummariesByRequestIds(tenantId: string, requestIds: string[]) {
    if (requestIds.length === 0) {
      return Promise.resolve([] as ReturnCommitmentRow[]);
    }
    return this.prisma.client.returnCommitment.findMany({
      where: { salonId: tenantId, sourceMessageRequestId: { in: requestIds } },
      select: RETURN_COMMITMENT_SELECT,
    });
  }

  async findEligibleSource(
    tenantId: string,
    messageRequestId: string,
    db: Db = this.prisma.client,
  ): Promise<ReturnCommitmentSource | null> {
    const request = await db.messageRequest.findFirst({
      where: { id: messageRequestId, salonId: tenantId },
      select: {
        id: true,
        customerId: true,
        vipRequestId: true,
        deliveries: {
          select: {
            id: true,
            customerId: true,
            status: true,
            submittedAt: true,
          },
          take: 1,
        },
      },
    });
    if (!request) {
      return null;
    }
    const delivery = request.deliveries[0];
    if (!delivery) {
      return {
        requestId: request.id,
        deliveryId: '',
        customerId: request.customerId ?? '',
        requestCustomerId: request.customerId,
        vipRequestId: request.vipRequestId,
        deliveryCustomerId: null,
        deliveryStatus: 'QUEUED',
        submittedAt: null,
      };
    }
    return {
      requestId: request.id,
      deliveryId: delivery.id,
      customerId: request.customerId ?? '',
      requestCustomerId: request.customerId,
      vipRequestId: request.vipRequestId,
      deliveryCustomerId: delivery.customerId,
      deliveryStatus: delivery.status,
      submittedAt: delivery.submittedAt,
    };
  }

  listForCustomer(
    tenantId: string,
    customerId: string,
    cursor?: { expectedAt: Date; id: string },
  ) {
    return this.prisma.client.returnCommitment.findMany({
      where: {
        salonId: tenantId,
        customerId,
        ...(cursor
          ? {
              OR: [
                { expectedAt: { lt: cursor.expectedAt } },
                { expectedAt: cursor.expectedAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: RETURN_COMMITMENT_SELECT,
      orderBy: [{ expectedAt: 'desc' as const }, { id: 'desc' as const }],
      take: RETURN_COMMITMENT_LIST_LIMIT + 1,
    });
  }

  listUpcoming(
    tenantId: string,
    from: Date,
    to: Date,
    cursor?: { expectedAt: Date; id: string },
  ) {
    return this.prisma.client.returnCommitment.findMany({
      where: {
        salonId: tenantId,
        AND: [
          { expectedAt: { gte: from, lt: to } },
          ...(cursor
            ? [
                {
                  OR: [
                    { expectedAt: { gt: cursor.expectedAt } },
                    { expectedAt: cursor.expectedAt, id: { gt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        customerId: true,
        expectedAt: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ expectedAt: 'asc' as const }, { id: 'asc' as const }],
      take: RETURN_COMMITMENT_LIST_LIMIT + 1,
    });
  }

  async insertIfAbsent(
    tx: Prisma.TransactionClient,
    input: {
      id: string;
      salonId: string;
      customerId: string;
      sourceMessageRequestId: string;
      sourceMessageDeliveryId: string;
      expectedAt: Date;
      createdByUserId: string;
      now: Date;
    },
  ): Promise<boolean> {
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO return_commitments (
        id, salon_id, customer_id, source_message_request_id, source_message_delivery_id,
        expected_at, actual_visit_id, created_by_user_id, updated_by_user_id, created_at, updated_at
      )
      VALUES (
        ${input.id}::uuid,
        ${input.salonId}::uuid,
        ${input.customerId}::uuid,
        ${input.sourceMessageRequestId}::uuid,
        ${input.sourceMessageDeliveryId}::uuid,
        ${input.expectedAt},
        NULL,
        ${input.createdByUserId}::uuid,
        ${input.createdByUserId}::uuid,
        ${input.now},
        ${input.now}
      )
      ON CONFLICT (salon_id, source_message_request_id) DO NOTHING
      RETURNING id
    `;
    return inserted.length > 0;
  }

  updateExpectedAt(input: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    id: string;
    expectedAt: Date;
    updatedAt: Date;
    actorId: string;
    now: Date;
  }) {
    return input.tx.returnCommitment.updateMany({
      where: {
        id: input.id,
        salonId: input.tenantId,
        updatedAt: input.updatedAt,
        actualVisitId: null,
      },
      data: {
        expectedAt: input.expectedAt,
        updatedByUserId: input.actorId,
        updatedAt: input.now,
      },
    });
  }
}

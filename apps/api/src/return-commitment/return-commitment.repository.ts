import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { completedRevenueByVisitIds } from '../transaction/completed-visit-revenue';
import type { ReturnCommitmentWriteActor } from './return-commitment-actor';
import {
  operationallyOpenReturnCommitmentSql,
  operationallySettledUnlinkedReturnCommitmentSql,
} from './operational-open-return-commitment.sql';
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
  salonId: string;
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
        created_by_user_id: string | null;
        created_by_platform_admin_id: string | null;
        updated_by_user_id: string | null;
        updated_by_platform_admin_id: string | null;
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
        created_by_platform_admin_id,
        updated_by_user_id,
        updated_by_platform_admin_id,
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
      createdByPlatformAdminId: row.created_by_platform_admin_id,
      updatedByUserId: row.updated_by_user_id,
      updatedByPlatformAdminId: row.updated_by_platform_admin_id,
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

  /** True when a same-salon Visit exists with visitedAt > source delivery submittedAt. Does not pick a Visit. */
  async hasQualifyingPostOutreachVisit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    customerId: string,
    sourceMessageDeliveryId: string,
  ): Promise<boolean> {
    const delivery = await tx.messageDelivery.findFirst({
      where: { id: sourceMessageDeliveryId, salonId: tenantId },
      select: { submittedAt: true },
    });
    if (!delivery?.submittedAt) {
      return false;
    }
    const visit = await tx.visit.findFirst({
      where: {
        salonId: tenantId,
        customerId,
        visitedAt: { gt: delivery.submittedAt },
      },
      select: { id: true },
    });
    return Boolean(visit);
  }

  linkActualVisit(input: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    id: string;
    visitId: string;
    actor: ReturnCommitmentWriteActor;
    now: Date;
  }) {
    const userId = input.actor.kind === 'SALON_USER' ? input.actor.userId : null;
    const adminId = input.actor.kind === 'PLATFORM_ADMIN' ? input.actor.adminId : null;
    return input.tx.returnCommitment.updateMany({
      where: {
        id: input.id,
        salonId: input.tenantId,
        actualVisitId: null,
      },
      data: {
        actualVisitId: input.visitId,
        updatedByUserId: userId,
        updatedByPlatformAdminId: adminId,
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
    const linkedRows = rows.filter((row) => row.actualVisitId != null);
    const sourceDeliveries = linkedRows.length === 0
      ? []
      : await db.messageDelivery.findMany({
          where: {
            salonId: tenantId,
            id: { in: linkedRows.map((row) => row.sourceMessageDeliveryId) },
          },
          select: {
            id: true,
            customerId: true,
            messageRequestId: true,
            status: true,
            submittedAt: true,
            messageRequest: { select: { customerId: true, vipRequestId: true } },
          },
        });
    const sourceById = new Map(sourceDeliveries.map((delivery) => [delivery.id, delivery]));
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

    const settledUnlinkedIds = await this.findSettledUnlinkedIds(
      tenantId,
      rows.filter((row) => row.actualVisitId == null).map((row) => row.id),
      db,
    );

    return rows.map((row) => {
      const operationallyOpen = row.actualVisitId == null && !settledUnlinkedIds.has(row.id);
      if (!row.actualVisitId) {
        return toReturnCommitmentResponse(row, null, operationallyOpen);
      }
      const visit = visitById.get(row.actualVisitId);
      const source = sourceById.get(row.sourceMessageDeliveryId);
      if (
        !visit || !source || visit.customerId !== row.customerId ||
        source.messageRequestId !== row.sourceMessageRequestId ||
        source.customerId !== row.customerId ||
        source.messageRequest.customerId !== row.customerId ||
        source.messageRequest.vipRequestId != null ||
        source.status !== 'SENT' || !source.submittedAt ||
        visit.visitedAt <= source.submittedAt
      ) {
        return toReturnCommitmentResponse(row, null, false);
      }
      return toReturnCommitmentResponse(
        row,
        toCommitmentBackedReturn(visit, revenueByVisit.get(visit.id)),
        false,
      );
    });
  }

  private async findSettledUnlinkedIds(tenantId: string, ids: string[], db: Db): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }
    const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT rc.id
      FROM return_commitments rc
      INNER JOIN message_deliveries md
        ON md.id = rc.source_message_delivery_id AND md.salon_id = rc.salon_id
      WHERE rc.salon_id = ${tenantId}::uuid
        AND rc.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        AND ${operationallySettledUnlinkedReturnCommitmentSql}
    `);
    return new Set(rows.map((row) => row.id));
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

  findEligibleSource(
    tenantId: string,
    messageRequestId: string,
    db: Db = this.prisma.client,
  ): Promise<ReturnCommitmentSource | null> {
    return this.loadSource({ id: messageRequestId, salonId: tenantId }, db);
  }

  findEligibleSourceByRequestId(
    messageRequestId: string,
    db: Db = this.prisma.client,
  ): Promise<ReturnCommitmentSource | null> {
    return this.loadSource({ id: messageRequestId }, db);
  }

  private async loadSource(
    where: { id: string; salonId?: string },
    db: Db,
  ): Promise<ReturnCommitmentSource | null> {
    const request = await db.messageRequest.findFirst({
      where,
      select: {
        id: true,
        salonId: true,
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
    return this.mapSource(request);
  }

  private mapSource(request: {
    id: string;
    salonId: string;
    customerId: string | null;
    vipRequestId: string | null;
    deliveries: Array<{
      id: string;
      customerId: string | null;
      status: string;
      submittedAt: Date | null;
    }>;
  }): ReturnCommitmentSource {
    const delivery = request.deliveries[0];
    if (!delivery) {
      return {
        requestId: request.id,
        salonId: request.salonId,
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
      salonId: request.salonId,
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

  listOpen(
    tenantId: string,
    cursor?: { expectedAt: Date; id: string },
  ) {
    const cursorExpectedAt = cursor?.expectedAt ?? new Date(0);
    const cursorId = cursor?.id ?? '00000000-0000-0000-0000-000000000000';
    return this.prisma.client.$queryRaw<
      Array<{
        id: string;
        customer_id: string;
        expected_at: Date;
        created_by_platform_admin_id: string | null;
        first_name: string;
        last_name: string;
        phone_number: string;
      }>
    >(Prisma.sql`
      SELECT ranked.id,
             ranked.customer_id,
             ranked.expected_at,
             ranked.created_by_platform_admin_id,
             ranked.first_name,
             ranked.last_name,
             ranked.phone_number
      FROM (
        SELECT DISTINCT ON (rc.customer_id)
          rc.id,
          rc.customer_id,
          rc.expected_at,
          rc.created_by_platform_admin_id,
          c.first_name,
          c.last_name,
          c.phone_number
        FROM return_commitments rc
        INNER JOIN customers c
          ON c.id = rc.customer_id AND c.salon_id = rc.salon_id
        INNER JOIN message_deliveries md
          ON md.id = rc.source_message_delivery_id AND md.salon_id = rc.salon_id
        WHERE rc.salon_id = ${tenantId}::uuid
          AND ${operationallyOpenReturnCommitmentSql}
        ORDER BY rc.customer_id, rc.expected_at ASC, rc.id ASC
      ) ranked
      WHERE (
        ${cursor == null}
        OR ranked.expected_at > ${cursorExpectedAt}
        OR (
          ranked.expected_at = ${cursorExpectedAt}
          AND ranked.id > ${cursorId}::uuid
        )
      )
      ORDER BY ranked.expected_at ASC, ranked.id ASC
      LIMIT ${RETURN_COMMITMENT_LIST_LIMIT + 1}
    `);
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
      actor: ReturnCommitmentWriteActor;
      now: Date;
    },
  ): Promise<boolean> {
    const userId = input.actor.kind === 'SALON_USER' ? input.actor.userId : null;
    const adminId = input.actor.kind === 'PLATFORM_ADMIN' ? input.actor.adminId : null;
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO return_commitments (
        id, salon_id, customer_id, source_message_request_id, source_message_delivery_id,
        expected_at, actual_visit_id, created_by_user_id, created_by_platform_admin_id,
        updated_by_user_id, updated_by_platform_admin_id, created_at, updated_at
      )
      VALUES (
        ${input.id}::uuid,
        ${input.salonId}::uuid,
        ${input.customerId}::uuid,
        ${input.sourceMessageRequestId}::uuid,
        ${input.sourceMessageDeliveryId}::uuid,
        ${input.expectedAt},
        NULL,
        ${userId}::uuid,
        ${adminId}::uuid,
        ${userId}::uuid,
        ${adminId}::uuid,
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
    actor: ReturnCommitmentWriteActor;
    now: Date;
  }) {
    const userId = input.actor.kind === 'SALON_USER' ? input.actor.userId : null;
    const adminId = input.actor.kind === 'PLATFORM_ADMIN' ? input.actor.adminId : null;
    return input.tx.returnCommitment.updateMany({
      where: {
        id: input.id,
        salonId: input.tenantId,
        updatedAt: input.updatedAt,
        actualVisitId: null,
      },
      data: {
        expectedAt: input.expectedAt,
        updatedByUserId: userId,
        updatedByPlatformAdminId: adminId,
        updatedAt: input.now,
      },
    });
  }
}

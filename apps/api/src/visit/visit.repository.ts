import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VISIT_SELECT } from './visit.mapper';
import { VISIT_SALE_SELECT } from './visit-sale';
import { VISIT_EXPORT_MAX_ROWS } from './visit-export.constants';

export const VISIT_LIST_LIMIT = 200;

type VisitDb = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class VisitRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tenantId: string, visitId: string, db: VisitDb = this.prisma.client) {
    return db.visit.findFirst({
      where: { id: visitId, salonId: tenantId },
      select: VISIT_SELECT,
    });
  }

  listForCustomer(tenantId: string, customerId: string, cursor?: { visitedAt: Date; createdAt: Date; id: string }) {
    return this.prisma.client.visit.findMany({
      where: {
        salonId: tenantId,
        customerId,
        ...(cursor ? visitCursorWhere(cursor) : {}),
      },
      select: VISIT_SELECT,
      orderBy: [{ visitedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: VISIT_LIST_LIMIT + 1,
    });
  }

  listForSalon(
    tenantId: string,
    filters: {
      customerId?: string;
      from?: Date;
      to?: Date;
      limit?: number;
      cursor?: { visitedAt: Date; createdAt: Date; id: string };
    },
  ) {
    const take = Math.min(Math.max(filters.limit ?? VISIT_LIST_LIMIT, 1), VISIT_LIST_LIMIT);
    return this.prisma.client.visit.findMany({
      where: {
        salonId: tenantId,
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.from || filters.to
          ? {
              visitedAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lt: filters.to } : {}),
              },
            }
          : {}),
        ...(filters.cursor ? visitCursorWhere(filters.cursor) : {}),
      },
      select: {
        ...VISIT_SELECT,
        customer: { select: { firstName: true, lastName: true } },
        transactions: {
          where: { salonId: tenantId },
          select: VISIT_SALE_SELECT,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ visitedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
  }

  listForSalonExport(
    tenantId: string,
    filters: {
      customerId?: string;
      from?: Date;
      to?: Date;
    },
  ) {
    const overflowLimit = VISIT_EXPORT_MAX_ROWS + 1;
    const customerFilter = filters.customerId
      ? Prisma.sql`AND v.customer_id = ${filters.customerId}::uuid`
      : Prisma.sql``;
    const fromFilter = filters.from
      ? Prisma.sql`AND ranked.visited_at >= ${filters.from}`
      : Prisma.sql``;
    const toFilter = filters.to
      ? Prisma.sql`AND ranked.visited_at < ${filters.to}`
      : Prisma.sql``;

    return this.prisma.client.$queryRaw<VisitExportSqlRow[]>(Prisma.sql`
      WITH ranked AS (
        SELECT
          v.id,
          v.salon_id,
          v.customer_id,
          v.visited_at,
          v.created_at,
          c.first_name AS "firstName",
          c.last_name AS "lastName",
          LAG(v.visited_at) OVER (
            PARTITION BY v.customer_id
            ORDER BY v.visited_at ASC, v.created_at ASC, v.id ASC
          ) AS "prevVisitedAt"
        FROM visits v
        INNER JOIN customers c
          ON c.id = v.customer_id AND c.salon_id = v.salon_id
        WHERE v.salon_id = ${tenantId}::uuid
          ${customerFilter}
      )
      SELECT
        ranked."firstName",
        ranked."lastName",
        svc.service_name AS "serviceName",
        CASE WHEN sale.status = 'COMPLETED' THEN sale.amount::text ELSE NULL END AS "amountReceived",
        ranked.visited_at AS "visitedAt",
        CASE
          WHEN ranked."prevVisitedAt" IS NULL THEN NULL
          ELSE FLOOR(EXTRACT(EPOCH FROM (ranked.visited_at - ranked."prevVisitedAt")) / 86400)::int
        END AS "daysSincePreviousVisit"
      FROM ranked
      LEFT JOIN LATERAL (
        SELECT t.id, t.amount, t.status
        FROM transactions t
        WHERE t.visit_id = ranked.id
          AND t.salon_id = ranked.salon_id
        ORDER BY CASE WHEN t.status = 'COMPLETED' THEN 0 ELSE 1 END, t.created_at ASC, t.id ASC
        LIMIT 1
      ) sale ON true
      LEFT JOIN LATERAL (
        SELECT s.name AS service_name
        FROM transaction_items ti
        INNER JOIN services s
          ON s.id = ti.service_id
          AND s.salon_id = ti.salon_id
          AND s.salon_id = ranked.salon_id
        WHERE ti.transaction_id = sale.id
          AND ti.salon_id = ranked.salon_id
        ORDER BY ti.id ASC
        LIMIT 1
      ) svc ON true
      WHERE true
        ${fromFilter}
        ${toFilter}
      ORDER BY ranked.visited_at DESC, ranked.created_at DESC, ranked.id DESC
      LIMIT ${overflowLimit}
    `);
  }

  deleteById(tenantId: string, visitId: string, db: VisitDb = this.prisma.client) {
    return db.visit.deleteMany({
      where: { id: visitId, salonId: tenantId },
    });
  }

  deleteForCustomer(tenantId: string, customerId: string, db: VisitDb = this.prisma.client) {
    return db.visit.deleteMany({
      where: { salonId: tenantId, customerId },
    });
  }
}

export type VisitExportSqlRow = {
  firstName: string;
  lastName: string;
  serviceName: string | null;
  amountReceived: string | null;
  visitedAt: Date;
  daysSincePreviousVisit: number | bigint | null;
};

function visitCursorWhere(cursor: { visitedAt: Date; createdAt: Date; id: string }) {
  return {
    OR: [
      { visitedAt: { lt: cursor.visitedAt } },
      { visitedAt: cursor.visitedAt, createdAt: { lt: cursor.createdAt } },
      { visitedAt: cursor.visitedAt, createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

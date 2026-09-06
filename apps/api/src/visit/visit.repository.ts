import { Injectable } from '@nestjs/common';
import type { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VISIT_SELECT } from './visit.mapper';

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
      },
      orderBy: [{ visitedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
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

function visitCursorWhere(cursor: { visitedAt: Date; createdAt: Date; id: string }) {
  return {
    OR: [
      { visitedAt: { lt: cursor.visitedAt } },
      { visitedAt: cursor.visitedAt, createdAt: { lt: cursor.createdAt } },
      { visitedAt: cursor.visitedAt, createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

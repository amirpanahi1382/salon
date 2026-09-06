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

  listForCustomer(tenantId: string, customerId: string) {
    return this.prisma.client.visit.findMany({
      where: { salonId: tenantId, customerId },
      select: VISIT_SELECT,
      orderBy: { visitedAt: 'desc' },
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
      },
      select: {
        ...VISIT_SELECT,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ visitedAt: 'desc' }, { createdAt: 'desc' }],
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

  listVisitedAtForCustomer(tenantId: string, customerId: string) {
    return this.prisma.client.visit.findMany({
      where: { salonId: tenantId, customerId },
      select: { visitedAt: true },
      orderBy: { visitedAt: 'asc' },
    });
  }

  listVisitedAtForSalon(tenantId: string, customerIds?: string[]) {
    if (customerIds && customerIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.prisma.client.visit.findMany({
      where: {
        salonId: tenantId,
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
      },
      select: { customerId: true, visitedAt: true },
      orderBy: { visitedAt: 'asc' },
    });
  }
}

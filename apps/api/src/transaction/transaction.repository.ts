import { Injectable } from '@nestjs/common';
import type { Prisma, TransactionStatus } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { TRANSACTION_INCLUDE } from './transaction.mapper';

export const TRANSACTION_LIST_LIMIT = 200;

type Db = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class TransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tenantId: string, id: string, db: Db = this.prisma.client) {
    return db.ledgerTransaction.findFirst({
      where: { id, salonId: tenantId },
      include: TRANSACTION_INCLUDE,
    });
  }

  countForCustomer(tenantId: string, customerId: string, db: Db = this.prisma.client) {
    return db.ledgerTransaction.count({
      where: { salonId: tenantId, customerId },
    });
  }

  countForVisit(tenantId: string, visitId: string, db: Db = this.prisma.client) {
    return db.ledgerTransaction.count({
      where: { salonId: tenantId, visitId },
    });
  }

  list(
    tenantId: string,
    filters: {
      customerId?: string;
      status?: TransactionStatus;
      from?: Date;
      to?: Date;
      limit?: number;
      cursor?: { occurredAt: Date; id: string };
    },
  ) {
    const take = Math.min(Math.max(filters.limit ?? TRANSACTION_LIST_LIMIT, 1), TRANSACTION_LIST_LIMIT);
    return this.prisma.client.ledgerTransaction.findMany({
      where: {
        salonId: tenantId,
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.from || filters.to
          ? {
              occurredAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lt: filters.to } : {}),
              },
            }
          : {}),
        ...(filters.cursor ? cursorWhere(filters.cursor) : {}),
      },
      include: TRANSACTION_INCLUDE,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
  }
}

function cursorWhere(cursor: { occurredAt: Date; id: string }) {
  return {
    OR: [
      { occurredAt: { lt: cursor.occurredAt } },
      { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
    ],
  };
}

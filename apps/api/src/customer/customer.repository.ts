import { Injectable } from '@nestjs/common';
import type { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { CUSTOMER_SELECT } from './customer.mapper';

export const CUSTOMER_LIST_LIMIT = 200;
export const INTELLIGENCE_CUSTOMER_CAP = 5000;

type CustomerDb = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tenantId: string, customerId: string, db: CustomerDb = this.prisma.client) {
    return db.customer.findFirst({
      where: { id: customerId, salonId: tenantId },
      select: CUSTOMER_SELECT,
    });
  }

  findByPhone(tenantId: string, phoneNumber: string, db: CustomerDb = this.prisma.client) {
    return db.customer.findFirst({
      where: { salonId: tenantId, phoneNumber },
      select: { id: true },
    });
  }

  findPhones(tenantId: string, phoneNumbers: string[], db: CustomerDb = this.prisma.client) {
    if (phoneNumbers.length === 0) {
      return Promise.resolve([]);
    }
    return db.customer.findMany({
      where: { salonId: tenantId, phoneNumber: { in: phoneNumbers } },
      select: { phoneNumber: true },
    });
  }

  list(tenantId: string, search?: string, cursor?: { createdAt: Date; id: string }) {
    const q = search?.trim();
    return this.prisma.client.customer.findMany({
      where: {
        salonId: tenantId,
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { phoneNumber: { contains: q } },
              ],
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: CUSTOMER_SELECT,
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: CUSTOMER_LIST_LIMIT + 1,
    });
  }

  deleteById(tenantId: string, customerId: string, db: CustomerDb = this.prisma.client) {
    return db.customer.deleteMany({
      where: { id: customerId, salonId: tenantId },
    });
  }
}

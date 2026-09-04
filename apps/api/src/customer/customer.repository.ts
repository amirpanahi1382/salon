import { Injectable } from '@nestjs/common';
import type { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { CUSTOMER_SELECT } from './customer.mapper';

const LIST_LIMIT = 200;

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

  list(tenantId: string, search?: string) {
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
      },
      select: CUSTOMER_SELECT,
      orderBy: { createdAt: 'desc' as const },
      take: LIST_LIMIT,
    });
  }
}

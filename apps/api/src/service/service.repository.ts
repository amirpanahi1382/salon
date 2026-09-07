import { Injectable } from '@nestjs/common';
import type { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { SERVICE_SELECT } from './service.mapper';

export const SERVICE_LIST_LIMIT = 200;

type Db = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class ServiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tenantId: string, id: string, db: Db = this.prisma.client) {
    return db.service.findFirst({
      where: { id, salonId: tenantId },
      select: SERVICE_SELECT,
    });
  }

  list(
    tenantId: string,
    options: {
      includeInactive?: boolean;
      cursor?: { createdAt: Date; id: string };
    } = {},
  ) {
    return this.prisma.client.service.findMany({
      where: {
        salonId: tenantId,
        ...(options.includeInactive ? {} : { status: 'ACTIVE' }),
        ...(options.cursor
          ? {
              OR: [
                { createdAt: { lt: options.cursor.createdAt } },
                { createdAt: options.cursor.createdAt, id: { lt: options.cursor.id } },
              ],
            }
          : {}),
      },
      select: SERVICE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SERVICE_LIST_LIMIT + 1,
    });
  }
}

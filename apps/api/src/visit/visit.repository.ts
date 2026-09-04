import { Injectable } from '@nestjs/common';
import type { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VISIT_SELECT } from './visit.mapper';

const HISTORY_LIMIT = 200;

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
      take: HISTORY_LIMIT,
    });
  }
}

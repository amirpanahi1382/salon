import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { MESSAGE_SELECT } from './message.mapper';

export const MESSAGE_LIST_LIMIT = 200;

type MessageDb = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class MessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tenantId: string, id: string, db: MessageDb = this.prisma.client) {
    return db.messageDelivery.findFirst({
      where: { id, salonId: tenantId },
      select: MESSAGE_SELECT,
    });
  }

  listForCustomer(
    tenantId: string,
    customerId: string,
    cursor?: { createdAt: Date; id: string },
  ) {
    return this.prisma.client.messageDelivery.findMany({
      where: {
        salonId: tenantId,
        customerId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: MESSAGE_LIST_LIMIT + 1,
    });
  }
}

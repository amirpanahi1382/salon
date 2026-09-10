import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { ValidationError } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ADMIN_MESSAGE_SELECT } from './admin-message.mapper';
import type { MessageDeliveryMode, MessageRequestStatus } from '@salon/shared';

export const ADMIN_MESSAGE_LIST_LIMIT = 50;

type MessageDb = Prisma.TransactionClient | PrismaService['client'];

@Injectable()
export class AdminMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, db: MessageDb = this.prisma.client) {
    return db.messageRequest.findFirst({
      where: { id },
      select: ADMIN_MESSAGE_SELECT,
    });
  }

  list(filters: {
    status?: MessageRequestStatus;
    mode?: MessageDeliveryMode;
    salonId?: string;
    customerId?: string;
    cursor?: { requestedAt: Date; id: string };
  }) {
    return this.prisma.client.messageRequest.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.salonId ? { salonId: filters.salonId } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.mode
          ? { deliveries: { some: { mode: filters.mode } } }
          : {}),
        ...(filters.cursor
          ? {
              OR: [
                { requestedAt: { lt: filters.cursor.requestedAt } },
                { requestedAt: filters.cursor.requestedAt, id: { lt: filters.cursor.id } },
              ],
            }
          : {}),
      },
      select: ADMIN_MESSAGE_SELECT,
      orderBy: [{ requestedAt: 'desc' as const }, { id: 'desc' as const }],
      take: ADMIN_MESSAGE_LIST_LIMIT + 1,
    });
  }
}

export function parseAdminCursor(value: string | undefined): { requestedAt: Date; id: string } | undefined {
  if (!value) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    throw new ValidationError('Invalid cursor');
  }
  const parts = decoded.split('\n');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ValidationError('Invalid cursor');
  }
  const requestedAt = new Date(parts[0]);
  if (Number.isNaN(requestedAt.getTime())) {
    throw new ValidationError('Invalid cursor');
  }
  return { requestedAt, id: parts[1] };
}

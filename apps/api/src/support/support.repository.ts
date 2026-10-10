import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { createId, NotFoundError } from '@salon/shared';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
} from '../infrastructure/http/idempotency';
import { toListPage, type ListPage } from '../infrastructure/http/list-page';
import { supportMessageAuditMetadata, type SupportAuthorKind } from './support-audit';
import { decodeSupportCursor, encodeSupportCursor, type SupportCursor } from './support-cursor';
import {
  ADMIN_SUPPORT_MESSAGE_OPERATION,
  SALON_SUPPORT_MESSAGE_OPERATION,
  SUPPORT_PAGE_LIMIT,
} from './support.constants';

export type SupportMessageRecord = {
  id: string;
  body: string;
  createdAt: Date;
  authorKind: SupportAuthorKind;
  authorName: string | null;
};

export type SupportConversationRecord = {
  id: string;
  userName: string;
  userEmail: string;
  salonName: string;
  lastMessageAt: Date;
  awaitingSupportReply: boolean;
};

type MessageRow = {
  id: string;
  body: string;
  createdAt: Date;
  authorUserId: string | null;
  authorPlatformAdminId: string | null;
  authorUser: { name: string } | null;
  authorPlatformAdmin: { name: string } | null;
};

const messageSelect = {
  id: true,
  body: true,
  createdAt: true,
  authorUserId: true,
  authorPlatformAdminId: true,
  authorUser: { select: { name: true } },
  authorPlatformAdmin: { select: { name: true } },
} satisfies Prisma.SupportMessageSelect;

function olderThan(cursor: SupportCursor | undefined): Prisma.SupportMessageWhereInput {
  if (!cursor) {
    return {};
  }
  return {
    OR: [
      { createdAt: { lt: cursor.at } },
      { createdAt: cursor.at, id: { lt: cursor.id } },
    ],
  };
}

async function monotonicMessageTimestamp(
  tx: Prisma.TransactionClient,
  conversationId: string,
  salonId: string,
): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ at: Date | string }>>`
    SELECT GREATEST(
      date_trunc('milliseconds', clock_timestamp()),
      date_trunc('milliseconds', last_message_at) + interval '1 millisecond'
    ) AS at
    FROM support_conversations
    WHERE id = ${conversationId}::uuid
      AND salon_id = ${salonId}::uuid
  `;
  const value = rows[0]?.at;
  const at = value instanceof Date ? value : new Date(value ?? '');
  if (Number.isNaN(at.getTime())) {
    throw new NotFoundError('Support conversation not found');
  }
  return at;
}

function toMessage(row: MessageRow): SupportMessageRecord {
  const authorKind: SupportAuthorKind = row.authorUserId ? 'SALON_USER' : 'PLATFORM_ADMIN';
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    authorKind,
    authorName: row.authorUser?.name ?? row.authorPlatformAdmin?.name ?? null,
  };
}

@Injectable()
export class SupportRepository {
  async findOwnConversation(
    tx: Prisma.TransactionClient,
    salonId: string,
    userId: string,
  ): Promise<SupportConversationRecord | null> {
    const row = await tx.supportConversation.findFirst({
      where: { salonId, userId },
      select: {
        id: true,
        lastMessageAt: true,
        awaitingSupportReply: true,
        user: { select: { name: true, email: true } },
        salon: { select: { name: true } },
      },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userName: row.user.name,
      userEmail: row.user.email,
      salonName: row.salon.name,
      lastMessageAt: row.lastMessageAt,
      awaitingSupportReply: row.awaitingSupportReply,
    };
  }

  async listOwnMessages(
    tx: Prisma.TransactionClient,
    input: { salonId: string; userId: string; conversationId: string; cursor?: string },
  ): Promise<ListPage<SupportMessageRecord>> {
    const cursor = decodeSupportCursor(input.cursor);
    const rows = await tx.supportMessage.findMany({
      where: {
        conversationId: input.conversationId,
        salonId: input.salonId,
        conversation: { userId: input.userId, salonId: input.salonId },
        ...olderThan(cursor),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SUPPORT_PAGE_LIMIT + 1,
      select: messageSelect,
    });
    return toListPage(rows.map(toMessage), SUPPORT_PAGE_LIMIT, (row) =>
      encodeSupportCursor(row.createdAt, row.id),
    );
  }

  async listConversations(
    tx: Prisma.TransactionClient,
    cursorValue?: string,
  ): Promise<ListPage<SupportConversationRecord>> {
    const cursor = decodeSupportCursor(cursorValue);
    const rows = await tx.supportConversation.findMany({
      where: cursor
        ? {
            OR: [
              { lastMessageAt: { lt: cursor.at } },
              { lastMessageAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {},
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: SUPPORT_PAGE_LIMIT + 1,
      select: {
        id: true,
        lastMessageAt: true,
        awaitingSupportReply: true,
        user: { select: { name: true, email: true } },
        salon: { select: { name: true } },
      },
    });
    const items = rows.map((row) => ({
      id: row.id,
      userName: row.user.name,
      userEmail: row.user.email,
      salonName: row.salon.name,
      lastMessageAt: row.lastMessageAt,
      awaitingSupportReply: row.awaitingSupportReply,
    }));
    return toListPage(items, SUPPORT_PAGE_LIMIT, (row) =>
      encodeSupportCursor(row.lastMessageAt, row.id),
    );
  }

  async findConversation(
    tx: Prisma.TransactionClient,
    conversationId: string,
  ): Promise<SupportConversationRecord | null> {
    const row = await tx.supportConversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        lastMessageAt: true,
        awaitingSupportReply: true,
        user: { select: { name: true, email: true } },
        salon: { select: { name: true } },
      },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userName: row.user.name,
      userEmail: row.user.email,
      salonName: row.salon.name,
      lastMessageAt: row.lastMessageAt,
      awaitingSupportReply: row.awaitingSupportReply,
    };
  }

  async listConversationMessages(
    tx: Prisma.TransactionClient,
    conversationId: string,
    cursorValue?: string,
  ): Promise<ListPage<SupportMessageRecord>> {
    const cursor = decodeSupportCursor(cursorValue);
    const rows = await tx.supportMessage.findMany({
      where: {
        conversationId,
        ...olderThan(cursor),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SUPPORT_PAGE_LIMIT + 1,
      select: messageSelect,
    });
    return toListPage(rows.map(toMessage), SUPPORT_PAGE_LIMIT, (row) =>
      encodeSupportCursor(row.createdAt, row.id),
    );
  }

  async lockOrCreateOwn(
    tx: Prisma.TransactionClient,
    input: { salonId: string; userId: string },
  ): Promise<string> {
    const id = createId();
    await tx.$executeRaw`
      INSERT INTO support_conversations (
        id, salon_id, user_id, last_message_at, awaiting_support_reply, created_at, updated_at
      ) VALUES (
        ${id}::uuid,
        ${input.salonId}::uuid,
        ${input.userId}::uuid,
        clock_timestamp(),
        false,
        clock_timestamp(),
        clock_timestamp()
      )
      ON CONFLICT (user_id) DO NOTHING
    `;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM support_conversations
      WHERE user_id = ${input.userId}::uuid
        AND salon_id = ${input.salonId}::uuid
      FOR UPDATE
    `;
    const conversationId = rows[0]?.id;
    if (!conversationId) {
      throw new NotFoundError('Support conversation not found');
    }
    return conversationId;
  }

  async lockConversation(tx: Prisma.TransactionClient, conversationId: string): Promise<{
    id: string;
    salonId: string;
  }> {
    const rows = await tx.$queryRaw<Array<{ id: string; salon_id: string }>>`
      SELECT id, salon_id
      FROM support_conversations
      WHERE id = ${conversationId}::uuid
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundError('Support conversation not found');
    }
    return { id: row.id, salonId: row.salon_id };
  }

  async commitMessage(
    tx: Prisma.TransactionClient,
    input: {
      conversationId: string;
      salonId: string;
      actorId: string;
      tenantId: string;
      operation: string;
      idempotencyKey: string;
      requestHash: string;
      authorUserId: string | null;
      authorPlatformAdminId: string | null;
      body: string;
    },
  ): Promise<SupportMessageRecord> {
    const messageId = createId();
    const claim = await claimIdempotencyKey(tx, {
      id: createId(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      operation: input.operation,
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      resourceType: 'support_message',
      resourceId: messageId,
    });

    if (!claim.inserted) {
      const existing = await findIdempotencyRecord(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        operation: input.operation,
        key: input.idempotencyKey,
      });
      if (!existing || existing.resourceType !== 'support_message') {
        throw new NotFoundError('Support message not found');
      }
      assertSameIdempotentRequest(existing.requestHash, input.requestHash);
      const replay = await tx.supportMessage.findFirst({
        where: {
          id: existing.resourceId,
          conversationId: input.conversationId,
          salonId: input.salonId,
        },
        select: messageSelect,
      });
      if (!replay) {
        throw new NotFoundError('Support message not found');
      }
      return toMessage(replay);
    }

    const createdAt = await monotonicMessageTimestamp(tx, input.conversationId, input.salonId);
    await tx.supportMessage.create({
      data: {
        id: messageId,
        conversationId: input.conversationId,
        salonId: input.salonId,
        authorUserId: input.authorUserId,
        authorPlatformAdminId: input.authorPlatformAdminId,
        body: input.body,
        createdAt,
      },
    });

    const latest = await tx.supportMessage.findFirst({
      where: { conversationId: input.conversationId, salonId: input.salonId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true, authorUserId: true },
    });
    if (!latest) {
      throw new NotFoundError('Support message not found');
    }
    await tx.supportConversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: latest.createdAt,
        awaitingSupportReply: latest.authorUserId !== null,
      },
    });

    const authorKind: SupportAuthorKind = input.authorUserId ? 'SALON_USER' : 'PLATFORM_ADMIN';
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: input.salonId,
        actorId: input.actorId,
        action: 'SUPPORT_MESSAGE_RECORDED',
        resource: 'support_message',
        resourceId: messageId,
        result: 'SUCCESS',
        metadata: supportMessageAuditMetadata({
          conversationId: input.conversationId,
          messageId,
          authorKind,
        }),
      },
    });

    const created = await tx.supportMessage.findFirst({
      where: { id: messageId, salonId: input.salonId },
      select: messageSelect,
    });
    if (!created) {
      throw new NotFoundError('Support message not found');
    }
    return toMessage(created);
  }
}

export { SALON_SUPPORT_MESSAGE_OPERATION, ADMIN_SUPPORT_MESSAGE_OPERATION };

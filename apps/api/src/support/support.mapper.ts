import type { ListPage } from '../infrastructure/http/list-page';
import type { SupportAuthorKind } from './support-audit';
import type { SupportConversationRecord, SupportMessageRecord } from './support.repository';

export type SalonSupportMessageResponse = {
  id: string;
  body: string;
  createdAt: string;
  authorKind: SupportAuthorKind;
};

export type AdminSupportMessageResponse = SalonSupportMessageResponse & {
  authorName: string | null;
};

export type SupportConversationResponse = {
  id: string;
  userName: string;
  userEmail: string | null;
  salonName: string;
  lastMessageAt: string;
  awaitingSupportReply: boolean;
};

function iso(value: Date): string {
  return value.toISOString();
}

export function toSalonSupportMessage(row: SupportMessageRecord): SalonSupportMessageResponse {
  return {
    id: row.id,
    body: row.body,
    createdAt: iso(row.createdAt),
    authorKind: row.authorKind,
  };
}

export function toAdminSupportMessage(row: SupportMessageRecord): AdminSupportMessageResponse {
  return {
    ...toSalonSupportMessage(row),
    authorName: row.authorName,
  };
}

export function toSupportConversation(row: SupportConversationRecord): SupportConversationResponse {
  return {
    id: row.id,
    userName: row.userName,
    userEmail: row.userEmail,
    salonName: row.salonName,
    lastMessageAt: iso(row.lastMessageAt),
    awaitingSupportReply: row.awaitingSupportReply,
  };
}

export function toSalonThread(
  conversation: SupportConversationRecord | null,
  page: ListPage<SupportMessageRecord>,
) {
  return {
    conversation: conversation ? toSupportConversation(conversation) : null,
    items: page.items.map(toSalonSupportMessage),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

export function toAdminThread(
  conversation: SupportConversationRecord,
  page: ListPage<SupportMessageRecord>,
) {
  return {
    conversation: toSupportConversation(conversation),
    items: page.items.map(toAdminSupportMessage),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

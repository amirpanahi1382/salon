export type SupportAuthorKind = 'SALON_USER' | 'PLATFORM_ADMIN';

/** Audit metadata for a committed support message. Never includes message text. */
export function supportMessageAuditMetadata(input: {
  conversationId: string;
  messageId: string;
  authorKind: SupportAuthorKind;
}): { conversationId: string; messageId: string; authorKind: SupportAuthorKind } {
  return {
    conversationId: input.conversationId,
    messageId: input.messageId,
    authorKind: input.authorKind,
  };
}

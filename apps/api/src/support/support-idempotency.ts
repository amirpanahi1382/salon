import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';
import {
  ADMIN_SUPPORT_MESSAGE_OPERATION,
  SALON_SUPPORT_MESSAGE_OPERATION,
} from './support.constants';

export function salonSupportMessageHash(text: string): string {
  return hashIdempotencyPayload(SALON_SUPPORT_MESSAGE_OPERATION, text);
}

export function adminSupportMessageHash(conversationId: string, text: string): string {
  return hashIdempotencyPayload(
    ADMIN_SUPPORT_MESSAGE_OPERATION,
    `${conversationId}\n${text}`,
  );
}

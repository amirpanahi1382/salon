import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';

export const MESSAGE_SEND_OPERATION = 'OPPORTUNITY_MESSAGE_SEND';
export const MANUAL_OUTREACH_MESSAGE_SEND_OPERATION = 'MANUAL_OUTREACH_MESSAGE_SEND';
export const MESSAGE_MANUAL_SENT_OPERATION = 'MESSAGE_MANUAL_SENT';
export const MESSAGE_QUEUE_CANCEL_OPERATION = 'MESSAGE_QUEUE_CANCEL';

export function messageSendRequestHash(
  customerId: string,
  opportunityType: string,
  body: string,
): string {
  return hashIdempotencyPayload(
    MESSAGE_SEND_OPERATION,
    `${customerId}:${opportunityType}:${body}`,
  );
}

export function manualOutreachMessageRequestHash(customerId: string, body: string): string {
  return hashIdempotencyPayload(MANUAL_OUTREACH_MESSAGE_SEND_OPERATION, `${customerId}:${body}`);
}

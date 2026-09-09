import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';

export const MESSAGE_SEND_OPERATION = 'OPPORTUNITY_MESSAGE_SEND';

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

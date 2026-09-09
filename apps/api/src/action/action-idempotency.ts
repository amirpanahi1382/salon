import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';

export const ACTION_CREATE_OPERATION = 'OPPORTUNITY_ACTION_CREATE';

export function actionCreateRequestHash(customerId: string, opportunityType: string): string {
  return hashIdempotencyPayload(ACTION_CREATE_OPERATION, `${customerId}:${opportunityType}`);
}

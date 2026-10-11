import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';

export const VISIT_INTENTION_CREATE_CUSTOMER = 'VISIT_INTENTION_CREATE_CUSTOMER';
export const VISIT_INTENTION_CREATE_VIP_SALON = 'VISIT_INTENTION_CREATE_VIP_SALON';
export const VISIT_INTENTION_CREATE_VIP_ADMIN = 'VISIT_INTENTION_CREATE_VIP_ADMIN';
export const VISIT_INTENTION_UPDATE = 'VISIT_INTENTION_UPDATE';
export const VISIT_INTENTION_ARRIVE = 'VISIT_INTENTION_ARRIVE';
export const VISIT_INTENTION_LINK_VISIT = 'VISIT_INTENTION_LINK_VISIT';

export function visitIntentionRequestHash(operation: string, canonical: string): string {
  return hashIdempotencyPayload(operation, canonical);
}

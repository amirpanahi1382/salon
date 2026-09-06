import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';

export const VISIT_CREATE_OPERATION = 'VISIT_CREATE';

export {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
  normalizeIdempotencyKey,
} from '../infrastructure/http/idempotency';

export function visitCreateRequestHash(customerId: string, visitedAt: Date): string {
  return hashIdempotencyPayload('VISIT_CREATE', `${customerId}:${visitedAt.toISOString()}`);
}

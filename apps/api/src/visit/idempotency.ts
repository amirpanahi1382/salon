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

export const VISIT_COMPLETE_WITH_SALE_OPERATION = 'VISIT_COMPLETE_WITH_SALE';

export function visitCompleteWithSaleRequestHash(input: {
  customerId: string;
  visitedAt: string;
  serviceId: string;
  amount: string;
  currency: string;
}): string {
  return hashIdempotencyPayload(
    VISIT_COMPLETE_WITH_SALE_OPERATION,
    `${input.customerId}:${input.visitedAt}:${input.serviceId}:${input.amount}:${input.currency}`,
  );
}

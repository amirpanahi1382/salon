import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';

export const TRANSACTION_CREATE_OPERATION = 'TRANSACTION_CREATE';

export function transactionCreateRequestHash(input: {
  customerId: string;
  visitId: string | null;
  occurredAt: string;
  amount: string;
  currency: string;
  items: Array<{ serviceId: string; quantity: number; unitPrice: string }>;
}): string {
  const items = [...input.items]
    .map((item) => `${item.serviceId}:${item.quantity}:${item.unitPrice}`)
    .sort()
    .join(',');
  return hashIdempotencyPayload(
    TRANSACTION_CREATE_OPERATION,
    `${input.customerId}:${input.visitId ?? ''}:${input.occurredAt}:${input.amount}:${input.currency}:${items}`,
  );
}

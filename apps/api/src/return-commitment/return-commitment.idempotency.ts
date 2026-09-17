import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';

export const RETURN_COMMITMENT_CREATE_OPERATION = 'RETURN_COMMITMENT_CREATE';
export const RETURN_COMMITMENT_UPDATE_OPERATION = 'RETURN_COMMITMENT_UPDATE';
export const RETURN_COMMITMENT_ARRIVE_OPERATION = 'RETURN_COMMITMENT_ARRIVE';
export const RETURN_COMMITMENT_LINK_VISIT_OPERATION = 'RETURN_COMMITMENT_LINK_VISIT';

export function returnCommitmentCreateRequestHash(
  messageRequestId: string,
  expectedAt: Date,
): string {
  return hashIdempotencyPayload(
    RETURN_COMMITMENT_CREATE_OPERATION,
    `${messageRequestId}:${expectedAt.toISOString()}`,
  );
}

export function returnCommitmentUpdateRequestHash(
  commitmentId: string,
  expectedAt: Date,
  updatedAt: Date,
): string {
  return hashIdempotencyPayload(
    RETURN_COMMITMENT_UPDATE_OPERATION,
    `${commitmentId}:${expectedAt.toISOString()}:${updatedAt.toISOString()}`,
  );
}

export function returnCommitmentArriveRequestHash(input: {
  commitmentId: string;
  visitedAt: string;
  sale: { serviceId: string; amount: string; currency: string } | null;
}): string {
  const salePart = input.sale
    ? `${input.sale.serviceId}:${input.sale.amount}:${input.sale.currency}`
    : 'none';
  return hashIdempotencyPayload(
    RETURN_COMMITMENT_ARRIVE_OPERATION,
    `${input.commitmentId}:${input.visitedAt}:${salePart}`,
  );
}

export function returnCommitmentLinkVisitRequestHash(commitmentId: string, visitId: string): string {
  return hashIdempotencyPayload(RETURN_COMMITMENT_LINK_VISIT_OPERATION, `${commitmentId}:${visitId}`);
}

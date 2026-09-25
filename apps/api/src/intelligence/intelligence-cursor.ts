import {
  OPPORTUNITY_TYPES,
  ValidationError,
  type CustomerStatus,
  type OpportunityType,
} from '@salon/shared';
import {
  decodeCursor,
  encodeCursor,
  parseCursorInstant,
  parseCursorInteger,
  parseCursorUuid,
} from '../infrastructure/http/list-page';

export type SegmentPosition = { days: number; customerId: string };
export type OpportunityPosition = SegmentPosition & { type: OpportunityType };

export function parseSegmentCursor(cursor: string | undefined, status: CustomerStatus | undefined) {
  const parts = decodeCursor(cursor, [2, 4]);
  if (!parts) return { asOf: new Date(), position: undefined };
  const modern = parts.length === 4;
  if (modern && parts[1] !== (status ?? 'ALL')) throw new ValidationError('Invalid cursor');
  const asOf = modern ? parseCursorInstant(parts[0]!) : new Date();
  const days = parseSegmentDays(parts[modern ? 2 : 0]!);
  const customerId = parseCursorUuid(parts[modern ? 3 : 1]!);
  return { asOf, position: { days, customerId } };
}

export function parseOpportunityCursor(cursor: string | undefined, type: OpportunityType | undefined) {
  const parts = decodeCursor(cursor, [3, 5]);
  if (!parts) return { asOf: new Date(), position: undefined };
  const modern = parts.length === 5;
  if (modern && parts[1] !== (type ?? 'ALL')) throw new ValidationError('Invalid cursor');
  const asOf = modern ? parseCursorInstant(parts[0]!) : new Date();
  const days = parseCursorInteger(parts[modern ? 2 : 0]!);
  const customerId = parseCursorUuid(parts[modern ? 3 : 1]!);
  const opportunityType = parts[modern ? 4 : 2]!;
  if (!OPPORTUNITY_TYPES.includes(opportunityType as OpportunityType)) throw new ValidationError('Invalid cursor');
  return { asOf, position: { days, customerId, type: opportunityType as OpportunityType } };
}

export function segmentCursor(asOf: Date, status: CustomerStatus | undefined, position: SegmentPosition) {
  return encodeCursor([asOf.toISOString(), status ?? 'ALL', String(position.days), position.customerId]);
}

export function opportunityCursor(asOf: Date, type: OpportunityType | undefined, position: OpportunityPosition) {
  return encodeCursor([
    asOf.toISOString(), type ?? 'ALL', String(position.days), position.customerId, position.type,
  ]);
}

function parseSegmentDays(value: string): number {
  if (value === '-1') return -1;
  return parseCursorInteger(value);
}

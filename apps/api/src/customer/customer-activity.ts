import { ValidationError } from '@salon/shared';
import { decodeCursor, parseCursorInstant, parseCursorUuid } from '../infrastructure/http/list-page';

export const CUSTOMER_ACTIVITY_TYPES = [
  'VISIT',
  'TRANSACTION',
  'OPPORTUNITY_ACTION',
  'MANUAL_MESSAGE',
] as const;

export type CustomerActivityType = (typeof CUSTOMER_ACTIVITY_TYPES)[number];

export const CUSTOMER_ACTIVITY_LIST_LIMIT = 200;

export type CustomerActivityCursor = {
  occurredAt: Date;
  createdAt: Date;
  type: CustomerActivityType;
  id: string;
};

export type CustomerActivityRow = {
  id: string;
  type: CustomerActivityType;
  occurredAt: Date;
  createdAt: Date;
  status: string | null;
  opportunityType: string | null;
};

export function isCustomerActivityType(value: string): value is CustomerActivityType {
  return (CUSTOMER_ACTIVITY_TYPES as readonly string[]).includes(value);
}

export function parseCustomerActivityCursor(cursor?: string): CustomerActivityCursor | undefined {
  const parts = decodeCursor(cursor, 4);
  if (!parts) {
    return undefined;
  }
  const occurredAt = parseCursorInstant(parts[0]!);
  const createdAt = parseCursorInstant(parts[1]!);
  const type = parts[2] ?? '';
  const id = parseCursorUuid(parts[3]!);
  if (!isCustomerActivityType(type)) {
    throw new ValidationError('Invalid cursor');
  }
  return { occurredAt, createdAt, type, id };
}

export function compareActivityDesc(a: CustomerActivityRow, b: CustomerActivityRow): number {
  const occurred = b.occurredAt.getTime() - a.occurredAt.getTime();
  if (occurred !== 0) {
    return occurred;
  }
  const created = b.createdAt.getTime() - a.createdAt.getTime();
  if (created !== 0) {
    return created;
  }
  if (a.type !== b.type) {
    return a.type < b.type ? 1 : -1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? 1 : -1;
}

export function mergeCustomerActivity(
  sources: CustomerActivityRow[][],
  limit: number,
): CustomerActivityRow[] {
  return sources
    .flat()
    .sort(compareActivityDesc)
    .slice(0, limit + 1);
}

/** Keyset for DESC (occurredAt, createdAt, type, id). Bounded per source. */
export function activityKeysetOr(
  occurredField: 'visitedAt' | 'occurredAt' | 'createdAt' | 'requestedAt',
  branchType: CustomerActivityType,
  cursor?: CustomerActivityCursor,
): object | undefined {
  if (!cursor) {
    return undefined;
  }
  const occurredLt = { [occurredField]: { lt: cursor.occurredAt } };
  const occurredEqCreatedLt = {
    AND: [{ [occurredField]: cursor.occurredAt }, { createdAt: { lt: cursor.createdAt } }],
  };
  if (branchType > cursor.type) {
    return { OR: [occurredLt, occurredEqCreatedLt] };
  }
  const sameTime = {
    AND: [{ [occurredField]: cursor.occurredAt }, { createdAt: cursor.createdAt }],
  };
  if (branchType < cursor.type) {
    return { OR: [occurredLt, occurredEqCreatedLt, sameTime] };
  }
  return {
    OR: [occurredLt, occurredEqCreatedLt, { AND: [...sameTime.AND, { id: { lt: cursor.id } }] }],
  };
}

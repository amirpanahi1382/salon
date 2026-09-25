import { ValidationError } from '@salon/shared';
import { isAbsoluteInstant } from './date-input';

export type ListPage<T> = {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
};

export function toListPage<T>(
  rows: T[],
  limit: number,
  cursorOf?: (row: T) => string,
): ListPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last && cursorOf ? cursorOf(last) : null,
  };
}

export function encodeCursor(parts: string[]): string {
  return Buffer.from(parts.join('\n'), 'utf8').toString('base64url');
}

export function decodeCursor(value: string | undefined, expectedParts: number | readonly number[]): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ValidationError('Invalid cursor');
  }
  const bytes = Buffer.from(value, 'base64url');
  const decoded = bytes.toString('utf8');
  if (bytes.toString('base64url') !== value || Buffer.from(decoded, 'utf8').compare(bytes) !== 0) {
    throw new ValidationError('Invalid cursor');
  }
  const parts = decoded.split('\n');
  const acceptedLengths = typeof expectedParts === 'number' ? [expectedParts] : expectedParts;
  if (!acceptedLengths.includes(parts.length) || parts.some((part) => part.length === 0)) {
    throw new ValidationError('Invalid cursor');
  }
  return parts;
}

export function parseCursorInstant(value: string): Date {
  if (!isAbsoluteInstant(value)) throw new ValidationError('Invalid cursor');
  return new Date(value);
}

export function parseCursorUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError('Invalid cursor');
  }
  return value;
}

export function parseCursorInteger(value: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new ValidationError('Invalid cursor');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new ValidationError('Invalid cursor');
  return number;
}

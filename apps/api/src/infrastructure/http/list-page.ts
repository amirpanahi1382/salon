import { ValidationError } from '@salon/shared';

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

export function decodeCursor(value: string | undefined, expectedParts: number): string[] | undefined {
  if (!value) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    throw new ValidationError('Invalid cursor');
  }
  const parts = decoded.split('\n');
  if (parts.length !== expectedParts || parts.some((part) => part.length === 0)) {
    throw new ValidationError('Invalid cursor');
  }
  return parts;
}

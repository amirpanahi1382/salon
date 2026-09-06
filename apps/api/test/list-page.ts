export function listItems<T>(body: unknown): T[] {
  if (body && typeof body === 'object' && 'items' in body) {
    const items = (body as { items: unknown }).items;
    if (Array.isArray(items)) {
      return items as T[];
    }
  }
  throw new Error('Expected a list page with items');
}

export function listPage<T>(body: unknown): {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
} {
  if (body && typeof body === 'object' && 'items' in body && 'hasMore' in body) {
    const page = body as { items: unknown; hasMore: unknown; nextCursor?: unknown };
    if (Array.isArray(page.items) && typeof page.hasMore === 'boolean') {
      return {
        items: page.items as T[],
        hasMore: page.hasMore,
        nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null,
      };
    }
  }
  throw new Error('Expected a list page with items and hasMore');
}

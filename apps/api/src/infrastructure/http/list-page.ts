export type ListPage<T> = {
  items: T[];
  hasMore: boolean;
};

export function toListPage<T>(rows: T[], limit: number): ListPage<T> {
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    hasMore,
  };
}

import {
  compareVisitsDescending,
  type CandidateVisit,
  type ObservedReturnAssociation,
} from '@salon/shared';

export const OBSERVED_RETURN_LIST_LIMIT = 50;

export function isOlderVisitThanCursor(visit: CandidateVisit, cursor: CandidateVisit): boolean {
  return compareVisitsDescending(visit, cursor) > 0;
}

export function pageObservedReturns(
  newestFirst: ObservedReturnAssociation[],
  cursor: CandidateVisit | undefined,
  limit: number = OBSERVED_RETURN_LIST_LIMIT,
): ObservedReturnAssociation[] {
  const afterCursor = cursor
    ? newestFirst.filter((row) => isOlderVisitThanCursor(row.returnVisit, cursor))
    : newestFirst;
  return afterCursor.slice(0, limit + 1);
}

import { DEFAULT_EXPECTED_RETURN_DAYS } from './thresholds.js';

const MS_PER_DAY = 86_400_000;

export type CustomerBehavior = {
  visitCount: number;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  daysSinceLastVisit: number | null;
  averageReturnIntervalDays: number | null;
  expectedReturnIntervalDays: number;
};

export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

export function deriveCustomerBehavior(visitDates: Date[], asOf: Date): CustomerBehavior {
  const sorted = [...visitDates].sort((a, b) => a.getTime() - b.getTime());
  const visitCount = sorted.length;

  if (visitCount === 0) {
    return {
      visitCount: 0,
      firstVisitAt: null,
      lastVisitAt: null,
      daysSinceLastVisit: null,
      averageReturnIntervalDays: null,
      expectedReturnIntervalDays: DEFAULT_EXPECTED_RETURN_DAYS,
    };
  }

  const firstVisitAt = sorted[0]!;
  const lastVisitAt = sorted[visitCount - 1]!;
  const daysSinceLastVisit = wholeDaysBetween(lastVisitAt, asOf);

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = wholeDaysBetween(sorted[i - 1]!, sorted[i]!);
    if (gap > 0) {
      gaps.push(gap);
    }
  }

  const averageReturnIntervalDays =
    gaps.length > 0
      ? Math.max(1, Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length))
      : null;

  return {
    visitCount,
    firstVisitAt,
    lastVisitAt,
    daysSinceLastVisit,
    averageReturnIntervalDays,
    expectedReturnIntervalDays: averageReturnIntervalDays ?? DEFAULT_EXPECTED_RETURN_DAYS,
  };
}

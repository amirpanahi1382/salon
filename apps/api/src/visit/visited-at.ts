import { ValidationError } from '@salon/shared';

const FUTURE_SKEW_MS = 2 * 60 * 1000;

/** Completed visits are historical facts, not scheduled bookings. */
export function parseCompletedVisitedAt(value: string, now = new Date()): Date {
  const visitedAt = new Date(value);
  if (Number.isNaN(visitedAt.getTime())) {
    throw new ValidationError('visitedAt must be a valid timestamp');
  }
  if (visitedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    throw new ValidationError('visitedAt must be a completed visit time, not a future booking');
  }
  return visitedAt;
}

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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseVisitDateFilter(date: string): { from: Date; to: Date } {
  if (!DAY.test(date)) {
    throw new ValidationError('date must be YYYY-MM-DD');
  }
  const from = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime())) {
    throw new ValidationError('date must be YYYY-MM-DD');
  }
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

export function parseVisitInstantRange(fromValue: string, toValue: string): { from: Date; to: Date } {
  const from = new Date(fromValue);
  const to = new Date(toValue);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError('from and to must be valid timestamps');
  }
  if (from.getTime() >= to.getTime()) {
    throw new ValidationError('from must be earlier than to');
  }
  return { from, to };
}

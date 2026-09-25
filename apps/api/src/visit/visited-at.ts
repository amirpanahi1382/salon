import { ValidationError } from '@salon/shared';
import { isUtcDate, parseAbsoluteInstant } from '../infrastructure/http/date-input';

const FUTURE_SKEW_MS = 2 * 60 * 1000;

/** Completed visits are historical facts, not scheduled bookings. */
export function parseCompletedVisitedAt(value: string, now = new Date()): Date {
  const visitedAt = parseAbsoluteInstant(value, 'visitedAt');
  if (visitedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    throw new ValidationError('visitedAt must be a completed visit time, not a future booking');
  }
  return visitedAt;
}

export function parseVisitDateFilter(date: string): { from: Date; to: Date } {
  if (!isUtcDate(date)) {
    throw new ValidationError('date must be YYYY-MM-DD');
  }
  const from = new Date(`${date}T00:00:00.000Z`);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

export function parseVisitInstantRange(fromValue: string, toValue: string): { from: Date; to: Date } {
  const from = parseAbsoluteInstant(fromValue, 'from');
  const to = parseAbsoluteInstant(toValue, 'to');
  if (from.getTime() >= to.getTime()) {
    throw new ValidationError('from must be earlier than to');
  }
  return { from, to };
}

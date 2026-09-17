import { ValidationError } from '@salon/shared';

/** API query bound only. Not a domain/business maximum for expectedAt. */
export const RETURN_COMMITMENT_UPCOMING_DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** API query bound only. Not a domain/business maximum for expectedAt. */
export const RETURN_COMMITMENT_UPCOMING_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

export const RETURN_COMMITMENT_LIST_LIMIT = 50;

export function resolveUpcomingWindow(
  fromValue: string | undefined,
  toValue: string | undefined,
  now = new Date(),
): { from: Date; to: Date } {
  if ((fromValue && !toValue) || (!fromValue && toValue)) {
    throw new ValidationError('from and to are both required when filtering upcoming commitments');
  }

  const from = fromValue ? new Date(fromValue) : now;
  const to = toValue
    ? new Date(toValue)
    : new Date(from.getTime() + RETURN_COMMITMENT_UPCOMING_DEFAULT_WINDOW_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError('from and to must be valid timestamps');
  }
  if (from.getTime() >= to.getTime()) {
    throw new ValidationError('from must be earlier than to');
  }
  if (to.getTime() - from.getTime() > RETURN_COMMITMENT_UPCOMING_MAX_WINDOW_MS) {
    throw new ValidationError('upcoming window cannot exceed 31 days');
  }
  return { from, to };
}

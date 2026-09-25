import { ValidationError } from '@salon/shared';
import { parseAbsoluteInstant } from '../infrastructure/http/date-input';

/** Same clock-skew window as completed Visit writes; applied to the past, not the future. */
export const RETURN_COMMITMENT_CLOCK_SKEW_MS = 2 * 60 * 1000;

export function parseReturnCommitmentExpectedAt(
  value: string,
  submittedAt: Date,
  now = new Date(),
): Date {
  const expectedAt = parseAbsoluteInstant(value, 'expectedAt');
  if (expectedAt.getTime() <= submittedAt.getTime()) {
    throw new ValidationError('expectedAt must be after the source message was sent');
  }
  if (expectedAt.getTime() < now.getTime() - RETURN_COMMITMENT_CLOCK_SKEW_MS) {
    throw new ValidationError('expectedAt must be a future return time');
  }
  return expectedAt;
}

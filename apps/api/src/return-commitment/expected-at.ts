import { ValidationError } from '@salon/shared';

/** Same clock-skew window as completed Visit writes; applied to the past, not the future. */
export const RETURN_COMMITMENT_CLOCK_SKEW_MS = 2 * 60 * 1000;

export function parseReturnCommitmentExpectedAt(
  value: string,
  submittedAt: Date,
  now = new Date(),
): Date {
  const expectedAt = new Date(value);
  if (Number.isNaN(expectedAt.getTime())) {
    throw new ValidationError('expectedAt must be a valid timestamp');
  }
  if (expectedAt.getTime() <= submittedAt.getTime()) {
    throw new ValidationError('expectedAt must be after the source message was sent');
  }
  if (expectedAt.getTime() < now.getTime() - RETURN_COMMITMENT_CLOCK_SKEW_MS) {
    throw new ValidationError('expectedAt must be a future return time');
  }
  return expectedAt;
}

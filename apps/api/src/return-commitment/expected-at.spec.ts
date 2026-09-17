import { ValidationError } from '@salon/shared';
import { parseReturnCommitmentExpectedAt } from './expected-at';

describe('parseReturnCommitmentExpectedAt', () => {
  const submittedAt = new Date('2026-09-16T10:00:00.000Z');
  const now = new Date('2026-09-16T12:00:00.000Z');

  it('accepts a future instant after submittedAt', () => {
    expect(
      parseReturnCommitmentExpectedAt('2026-09-16T16:00:00.000Z', submittedAt, now).toISOString(),
    ).toBe('2026-09-16T16:00:00.000Z');
  });

  it('rejects expectedAt at or before submittedAt', () => {
    expect(() =>
      parseReturnCommitmentExpectedAt('2026-09-16T10:00:00.000Z', submittedAt, now),
    ).toThrow(ValidationError);
    expect(() =>
      parseReturnCommitmentExpectedAt('2026-09-16T09:00:00.000Z', submittedAt, now),
    ).toThrow(ValidationError);
  });

  it('rejects a past expectedAt beyond clock skew', () => {
    expect(() =>
      parseReturnCommitmentExpectedAt('2026-09-16T11:00:00.000Z', submittedAt, now),
    ).toThrow(ValidationError);
  });

  it('allows expectedAt within two minutes before now', () => {
    expect(
      parseReturnCommitmentExpectedAt('2026-09-16T11:59:00.000Z', submittedAt, now).toISOString(),
    ).toBe('2026-09-16T11:59:00.000Z');
  });
});

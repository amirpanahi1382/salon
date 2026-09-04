import { ValidationError } from '@salon/shared';
import { parseCompletedVisitedAt } from './visited-at';

describe('parseCompletedVisitedAt', () => {
  const now = new Date('2026-09-04T12:00:00.000Z');

  it('accepts a completed historical timestamp', () => {
    expect(parseCompletedVisitedAt('2026-09-01T10:00:00.000Z', now).toISOString()).toBe(
      '2026-09-01T10:00:00.000Z',
    );
  });

  it('rejects a future booking-like timestamp', () => {
    expect(() => parseCompletedVisitedAt('2026-09-10T10:00:00.000Z', now)).toThrow(ValidationError);
  });
});

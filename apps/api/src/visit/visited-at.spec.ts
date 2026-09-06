import { ValidationError } from '@salon/shared';
import { parseCompletedVisitedAt, parseVisitDateFilter, parseVisitInstantRange } from './visited-at';

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

describe('visit list date filters', () => {
  it('maps YYYY-MM-DD to an inclusive UTC calendar day', () => {
    const range = parseVisitDateFilter('2026-09-05');
    expect(range.from.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });

  it('accepts an explicit from/to window', () => {
    const range = parseVisitInstantRange('2026-09-05T00:00:00.000Z', '2026-09-06T00:00:00.000Z');
    expect(range.from.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });
});

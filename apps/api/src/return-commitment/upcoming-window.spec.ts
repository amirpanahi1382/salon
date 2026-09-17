import { ValidationError } from '@salon/shared';
import { resolveUpcomingWindow } from './upcoming-window';

describe('resolveUpcomingWindow', () => {
  const now = new Date('2026-09-16T12:00:00.000Z');

  it('defaults to a 14-day query window from now', () => {
    expect(resolveUpcomingWindow(undefined, undefined, now)).toEqual({
      from: now,
      to: new Date('2026-09-30T12:00:00.000Z'),
    });
  });

  it('rejects windows longer than the 31-day API bound', () => {
    expect(() =>
      resolveUpcomingWindow('2026-09-01T00:00:00.000Z', '2026-10-10T00:00:00.000Z', now),
    ).toThrow(ValidationError);
  });

  it('rejects a half-specified range', () => {
    expect(() => resolveUpcomingWindow('2026-09-16T12:00:00.000Z', undefined, now)).toThrow(
      ValidationError,
    );
  });
});

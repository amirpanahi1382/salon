import {
  OWNER_REPORTING_TIMEZONE,
  isOwnerBusinessWeekStart,
  ownerBusinessWeekContaining,
  resolveOwnerBusinessWeek,
  shiftOwnerBusinessWeek,
  tehranLocalToUtc,
  tehranZonedParts,
} from './owner-business-week';

describe('owner business week (Asia/Tehran, Saturday start)', () => {
  const saturdayStart = new Date('2026-09-11T20:30:00.000Z');
  const nextSaturdayStart = new Date('2026-09-18T20:30:00.000Z');

  it('maps Saturday 00:00 Tehran to the UTC instant 20:30 previous UTC day', () => {
    expect(tehranLocalToUtc(2026, 9, 12).toISOString()).toBe(saturdayStart.toISOString());
    expect(tehranZonedParts(saturdayStart)).toMatchObject({
      weekday: 'Saturday',
      year: 2026,
      month: 9,
      day: 12,
      hour: 0,
      minute: 0,
      second: 0,
    });
  });

  it('uses a half-open week [Saturday 00:00, next Saturday 00:00)', () => {
    const week = ownerBusinessWeekContaining(saturdayStart);
    expect(week.timezone).toBe(OWNER_REPORTING_TIMEZONE);
    expect(week.start.toISOString()).toBe(saturdayStart.toISOString());
    expect(week.end.toISOString()).toBe(nextSaturdayStart.toISOString());
    expect(isOwnerBusinessWeekStart(saturdayStart)).toBe(true);
    expect(isOwnerBusinessWeekStart(new Date('2026-09-11T20:30:00.001Z'))).toBe(false);
  });

  it('includes the exact start and places the instant one millisecond before start in the previous week', () => {
    const before = new Date(saturdayStart.getTime() - 1);
    const previous = ownerBusinessWeekContaining(before);
    const current = ownerBusinessWeekContaining(saturdayStart);
    expect(previous.end.toISOString()).toBe(current.start.toISOString());
    expect(previous.start.toISOString()).toBe(new Date('2026-09-04T20:30:00.000Z').toISOString());
  });

  it('excludes the exact end instant from the week that starts at Saturday', () => {
    const atEnd = nextSaturdayStart;
    const next = ownerBusinessWeekContaining(atEnd);
    const current = ownerBusinessWeekContaining(saturdayStart);
    expect(next.start.toISOString()).toBe(current.end.toISOString());
  });

  it('does not use process.env.TZ for week boundaries', () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const week = ownerBusinessWeekContaining(new Date('2026-09-16T18:00:00.000Z'));
      expect(week.start.toISOString()).toBe(saturdayStart.toISOString());
      expect(week.end.toISOString()).toBe(nextSaturdayStart.toISOString());
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it('rejects a weekStart that is not Saturday 00:00 Tehran', () => {
    expect(() => resolveOwnerBusinessWeek('2026-09-12T00:00:00.000Z', saturdayStart)).toThrow(
      'weekStart must be Saturday 00:00 Asia/Tehran',
    );
  });

  it('accepts an omitted weekStart as the week containing now', () => {
    const week = resolveOwnerBusinessWeek(undefined, new Date('2026-09-15T10:00:00.000Z'));
    expect(week.start.toISOString()).toBe(saturdayStart.toISOString());
  });

  it('shifts by whole Tehran weeks', () => {
    const current = ownerBusinessWeekContaining(saturdayStart);
    const previous = shiftOwnerBusinessWeek(current, -1);
    expect(previous.end.toISOString()).toBe(current.start.toISOString());
  });
});

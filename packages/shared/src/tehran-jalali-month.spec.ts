import {
  comparableJalaliMonthWindows,
  jalaliToGregorian,
  TEHRAN_JALALI_TIMEZONE,
  tehranJalaliParts,
  tehranJalaliToUtc,
} from './tehran-jalali-month';

describe('Tehran Jalali comparable month windows', () => {
  it('converts Jalali midnight to an instant whose Intl parts match', () => {
    const instant = tehranJalaliToUtc(1404, 1, 1);
    expect(tehranJalaliParts(instant)).toMatchObject({
      year: 1404,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
    const gregorian = jalaliToGregorian(1404, 1, 1);
    expect(gregorian).toEqual({ year: 2025, month: 3, day: 21 });
  });

  it('uses equal elapsed windows on a mid-month Tehran instant', () => {
    const now = tehranJalaliToUtc(1404, 6, 20, 15, 30, 0);
    const windows = comparableJalaliMonthWindows(now);
    expect(windows.timezone).toBe(TEHRAN_JALALI_TIMEZONE);
    expect(tehranJalaliParts(windows.currentStart)).toMatchObject({
      year: 1404,
      month: 6,
      day: 1,
      hour: 0,
    });
    expect(tehranJalaliParts(windows.previousStart)).toMatchObject({
      year: 1404,
      month: 5,
      day: 1,
      hour: 0,
    });
    expect(tehranJalaliParts(windows.previousEndInclusive)).toMatchObject({
      year: 1404,
      month: 5,
      day: 20,
      hour: 15,
      minute: 30,
      second: 0,
    });
    expect(windows.previousEndExclusive.getTime()).toBe(windows.previousEndInclusive.getTime() + 1);
    expect(windows.now.getTime()).toBe(now.getTime());
  });

  it('on the first day of a Jalali month, previous window matches elapsed clock time that day', () => {
    const now = tehranJalaliToUtc(1404, 2, 1, 12, 0, 0);
    const windows = comparableJalaliMonthWindows(now);
    expect(tehranJalaliParts(windows.currentStart)).toMatchObject({
      year: 1404,
      month: 2,
      day: 1,
      hour: 0,
    });
    expect(tehranJalaliParts(windows.previousEndInclusive)).toMatchObject({
      year: 1404,
      month: 1,
      day: 1,
      hour: 12,
      minute: 0,
      second: 0,
    });
  });

  it('clamps previous equivalent when current elapsed day does not exist in previous month', () => {
    const now = tehranJalaliToUtc(1404, 1, 31, 10, 0, 0);
    const windows = comparableJalaliMonthWindows(now);
    expect(tehranJalaliParts(windows.previousStart)).toMatchObject({
      year: 1403,
      month: 12,
      day: 1,
    });
    expect(windows.previousEndExclusive.getTime()).toBe(windows.currentStart.getTime());
    const lastPrevious = tehranJalaliParts(windows.previousEndInclusive);
    expect(lastPrevious.year).toBe(1403);
    expect(lastPrevious.month).toBe(12);
    expect(lastPrevious.day).toBeGreaterThanOrEqual(29);
  });

  it('handles year transition from Farvardin back to Esfand', () => {
    const now = tehranJalaliToUtc(1404, 1, 10, 8, 0, 0);
    const windows = comparableJalaliMonthWindows(now);
    expect(tehranJalaliParts(windows.previousStart)).toMatchObject({
      year: 1403,
      month: 12,
      day: 1,
      hour: 0,
    });
    expect(tehranJalaliParts(windows.previousEndInclusive)).toMatchObject({
      year: 1403,
      month: 12,
      day: 10,
      hour: 8,
    });
  });

  it('does not use process.env.TZ for month boundaries', () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const now = tehranJalaliToUtc(1404, 7, 15, 23, 59, 59);
      const windows = comparableJalaliMonthWindows(now);
      expect(tehranJalaliParts(windows.currentStart)).toMatchObject({
        year: 1404,
        month: 7,
        day: 1,
        hour: 0,
      });
      expect(tehranJalaliParts(now)).toMatchObject({
        year: 1404,
        month: 7,
        day: 15,
        hour: 23,
        minute: 59,
        second: 59,
      });
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it('places an instant one millisecond before current month start in the previous month', () => {
    const currentStart = tehranJalaliToUtc(1404, 4, 1);
    const previousLastMs = new Date(currentStart.getTime() - 1);
    expect(tehranJalaliParts(previousLastMs).month).toBe(3);
    const windows = comparableJalaliMonthWindows(currentStart);
    expect(windows.previousEndInclusive.getTime()).toBe(windows.previousStart.getTime());
    expect(windows.previousEndExclusive.getTime()).toBe(windows.previousStart.getTime() + 1);
  });
});

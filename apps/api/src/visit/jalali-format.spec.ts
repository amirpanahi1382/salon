import { formatJalaliDateTimeTehran, tehranJalaliParts, toPersianDigits } from './jalali-format';

describe('Jalali Excel presentation', () => {
  it('converts digits for display only', () => {
    expect(toPersianDigits('1405/06/16 14:30')).toBe('۱۴۰۵/۰۶/۱۶ ۱۴:۳۰');
  });

  it('maps a known Tehran instant (31 Aug 2026 13:30) to Shahrivar 1405', () => {
    const instant = new Date('2026-08-31T10:00:00.000Z');
    expect(tehranJalaliParts(instant)).toEqual({
      year: 1405,
      month: 6,
      day: 9,
      hour: 13,
      minute: 30,
    });
    expect(formatJalaliDateTimeTehran(instant)).toBe('۱۴۰۵/۰۶/۰۹ ۱۳:۳۰');
  });

  it('keeps the Tehran civil date across a UTC midnight boundary', () => {
    const justBeforeUtcMidnight = new Date('2026-09-07T20:29:00.000Z');
    const justAfterUtcMidnight = new Date('2026-09-07T20:31:00.000Z');
    expect(tehranJalaliParts(justBeforeUtcMidnight)).toMatchObject({
      year: 1405,
      month: 6,
      day: 16,
      hour: 23,
      minute: 59,
    });
    expect(tehranJalaliParts(justAfterUtcMidnight)).toMatchObject({
      year: 1405,
      month: 6,
      day: 17,
      hour: 0,
      minute: 1,
    });
  });

  it('formats Farvardin 1 of 1405', () => {
    const instant = new Date('2026-03-21T00:00:00.000Z');
    const parts = tehranJalaliParts(instant);
    expect(parts.year).toBe(1405);
    expect(parts.month).toBe(1);
    expect(parts.day).toBe(1);
  });

  it('formats the last day of a 29-day Esfand', () => {
    const instant = new Date('2026-03-20T12:00:00.000Z');
    expect(tehranJalaliParts(instant)).toMatchObject({
      year: 1404,
      month: 12,
      day: 29,
    });
  });

  it('formats leap-year Esfand 30 (1403)', () => {
    const instant = new Date('2025-03-20T12:00:00.000Z');
    expect(tehranJalaliParts(instant)).toMatchObject({
      year: 1403,
      month: 12,
      day: 30,
    });
  });
});

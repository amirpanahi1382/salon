import { OWNER_REPORTING_TIMEZONE, tehranLocalToUtc } from './owner-business-week.js';

/** Business calendar for comparable-month visit windows. Stored instants remain UTC. */
export const TEHRAN_JALALI_TIMEZONE = OWNER_REPORTING_TIMEZONE;

export type TehranJalaliParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type ComparableJalaliMonthWindows = {
  timezone: typeof TEHRAN_JALALI_TIMEZONE;
  now: Date;
  currentStart: Date;
  previousStart: Date;
  /** Inclusive end of the previous comparable window (clamped to last instant of previous month). */
  previousEndInclusive: Date;
  /** Exclusive end of the previous comparable window. */
  previousEndExclusive: Date;
};

const jalaliTehranFormatter = () =>
  new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: TEHRAN_JALALI_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

function numericPart(value: string | undefined): number {
  const digits = (value ?? '').replace(/\D/g, '');
  return Number(digits);
}

export function tehranJalaliParts(instant: Date): TehranJalaliParts {
  const map: Record<string, string> = {};
  for (const part of jalaliTehranFormatter().formatToParts(instant)) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  return {
    year: numericPart(map.year),
    month: numericPart(map.month),
    day: numericPart(map.day),
    hour: numericPart(map.hour),
    minute: numericPart(map.minute),
    second: numericPart(map.second),
  };
}

function shiftJalaliMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const absolute = year * 12 + (month - 1) + delta;
  return { year: Math.floor(absolute / 12), month: (absolute % 12) + 1 };
}

/**
 * Instant at which Asia/Tehran Jalali wall-clock equals the given civil date/time.
 * Uses Intl persian calendar + existing Tehran offset conversion.
 */
export function tehranJalaliToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  const gregorian = jalaliToGregorian(year, month, day);
  return tehranLocalToUtc(gregorian.year, gregorian.month, gregorian.day, hour, minute, second, millisecond);
}

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Converts Jalali civil date to Gregorian civil date (jalaali algorithm). */
export function jalaliToGregorian(
  jy: number,
  jm: number,
  jd: number,
): { year: number; month: number; day: number } {
  const jy1 = jy - 979;
  const jm1 = jm - 1;
  const jd1 = jd - 1;
  let jDayNo = 365 * jy1 + div(jy1, 33) * 8 + div((jy1 % 33) + 3, 4);
  const monthDays = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  for (let i = 0; i < jm1; i += 1) {
    jDayNo += monthDays[i]!;
  }
  jDayNo += jd1;

  let gDayNo = jDayNo + 79;
  const gy = 1600 + 400 * div(gDayNo, 146097);
  gDayNo %= 146097;

  let leap = true;
  let gyAdj = gy;
  let rem = gDayNo;
  if (rem >= 36525) {
    rem -= 1;
    gyAdj += 100 * div(rem, 36524);
    rem %= 36524;
    if (rem >= 365) {
      rem += 1;
    } else {
      leap = false;
    }
  }
  gyAdj += 4 * div(rem, 1461);
  rem %= 1461;
  if (rem >= 366) {
    leap = false;
    rem -= 1;
    gyAdj += div(rem, 365);
    rem %= 365;
  }
  const gd = rem + 1;
  const sal_a = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  let remaining = gd;
  for (let i = 1; i <= 12; i += 1) {
    const v = sal_a[i]!;
    if (remaining <= v) {
      gm = i;
      break;
    }
    remaining -= v;
  }
  return { year: gyAdj, month: gm, day: remaining };
}

/**
 * Equal-elapsed Jalali month windows in Asia/Tehran.
 *
 * Current: [start of current Jalali month, now] inclusive.
 * Previous: [start of previous Jalali month, equivalent elapsed instant],
 * clamped to the last instant of the previous month when the current day/time
 * does not exist there.
 */
export function comparableJalaliMonthWindows(now: Date): ComparableJalaliMonthWindows {
  const parts = tehranJalaliParts(now);
  const currentStart = tehranJalaliToUtc(parts.year, parts.month, 1);
  const previousMonth = shiftJalaliMonth(parts.year, parts.month, -1);
  const previousStart = tehranJalaliToUtc(previousMonth.year, previousMonth.month, 1);
  const elapsedMs = now.getTime() - currentStart.getTime();
  const unclampedEquivalent = new Date(previousStart.getTime() + elapsedMs);
  const lastPreviousMs = new Date(currentStart.getTime() - 1);
  const previousEndInclusive =
    unclampedEquivalent.getTime() <= lastPreviousMs.getTime()
      ? unclampedEquivalent
      : lastPreviousMs;
  const previousEndExclusive = new Date(previousEndInclusive.getTime() + 1);
  return {
    timezone: TEHRAN_JALALI_TIMEZONE,
    now,
    currentStart,
    previousStart,
    previousEndInclusive,
    previousEndExclusive,
  };
}

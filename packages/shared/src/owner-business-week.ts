import { ValidationError } from './errors.js';

/** Owner recovery reporting timezone. Stored timestamps remain UTC instants. */
export const OWNER_REPORTING_TIMEZONE = 'Asia/Tehran' as const;

const DAYS_FROM_SATURDAY: Record<string, number> = {
  Saturday: 0,
  Sunday: 1,
  Monday: 2,
  Tuesday: 3,
  Wednesday: 4,
  Thursday: 5,
  Friday: 6,
};

export type OwnerBusinessWeek = {
  timezone: typeof OWNER_REPORTING_TIMEZONE;
  start: Date;
  end: Date;
};

type TehranParts = {
  weekday: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function tehranPartsFormatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: OWNER_REPORTING_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function numericPart(value: string | undefined): number {
  const digits = (value ?? '').replace(/\D/g, '');
  return Number(digits);
}

export function tehranZonedParts(instant: Date): TehranParts {
  const map: Record<string, string> = {};
  for (const part of tehranPartsFormatter().formatToParts(instant)) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  const weekday = map.weekday ?? '';
  if (!(weekday in DAYS_FROM_SATURDAY)) {
    throw new Error(`Unexpected Tehran weekday: ${weekday}`);
  }
  return {
    weekday,
    year: numericPart(map.year),
    month: numericPart(map.month),
    day: numericPart(map.day),
    hour: numericPart(map.hour),
    minute: numericPart(map.minute),
    second: numericPart(map.second),
  };
}

function addGregorianDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Instant at which Asia/Tehran wall-clock equals the given Gregorian local time.
 * Uses Intl so Iran offset (including historical DST) is not hard-coded.
 */
export function tehranLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - 3.5 * 3_600_000;
  for (let step = 0; step < 8; step += 1) {
    const parts = tehranZonedParts(new Date(utcMs));
    const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const want = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = want - got;
    if (
      delta === 0 &&
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute &&
      parts.second === second
    ) {
      return new Date(utcMs);
    }
    utcMs += delta;
  }
  throw new Error('Unable to convert Asia/Tehran local time to UTC');
}

export function ownerBusinessWeekContaining(instant: Date): OwnerBusinessWeek {
  const parts = tehranZonedParts(instant);
  const daysFromSaturday = DAYS_FROM_SATURDAY[parts.weekday]!;
  const startLocal = addGregorianDays(parts.year, parts.month, parts.day, -daysFromSaturday);
  const endLocal = addGregorianDays(startLocal.year, startLocal.month, startLocal.day, 7);
  return {
    timezone: OWNER_REPORTING_TIMEZONE,
    start: tehranLocalToUtc(startLocal.year, startLocal.month, startLocal.day),
    end: tehranLocalToUtc(endLocal.year, endLocal.month, endLocal.day),
  };
}

export function shiftOwnerBusinessWeek(week: OwnerBusinessWeek, weekDelta: number): OwnerBusinessWeek {
  const startParts = tehranZonedParts(week.start);
  const shifted = addGregorianDays(startParts.year, startParts.month, startParts.day, weekDelta * 7);
  return ownerBusinessWeekContaining(tehranLocalToUtc(shifted.year, shifted.month, shifted.day, 12));
}

export function isOwnerBusinessWeekStart(instant: Date): boolean {
  const week = ownerBusinessWeekContaining(instant);
  return week.start.getTime() === instant.getTime();
}

export function resolveOwnerBusinessWeek(
  weekStartIso: string | undefined,
  now: Date,
): OwnerBusinessWeek {
  if (!weekStartIso) {
    return ownerBusinessWeekContaining(now);
  }
  const weekStart = new Date(weekStartIso);
  if (Number.isNaN(weekStart.getTime())) {
    throw new ValidationError('weekStart must be a valid timestamp');
  }
  if (!isOwnerBusinessWeekStart(weekStart)) {
    throw new ValidationError(
      'weekStart must be Saturday 00:00 Asia/Tehran (the inclusive start of an owner business week)',
    );
  }
  return ownerBusinessWeekContaining(weekStart);
}

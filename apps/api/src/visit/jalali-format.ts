const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** Presentation timezone for Iranian salon Excel. Canonical stored values remain UTC. */
export const VISIT_EXPORT_DISPLAY_TIMEZONE = 'Asia/Tehran';

export function toPersianDigits(value: string): string {
  return value.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]!);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function numericPart(value: string | undefined): number {
  const digits = (value ?? '').replace(/\D/g, '');
  return Number(digits);
}

/**
 * Formats an instant as Jalali date+time in Asia/Tehran for Excel display.
 * Does not change stored UTC timestamps or day-count arithmetic.
 */
export function formatJalaliDateTimeTehran(instant: Date): string {
  const parts = tehranJalaliParts(instant);
  return toPersianDigits(
    `${parts.year}/${pad2(parts.month)}/${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`,
  );
}

export function tehranJalaliParts(instant: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const map: Record<string, string> = {};
  for (const part of jalaliTehranFormatter.formatToParts(instant)) {
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
  };
}

const jalaliTehranFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  timeZone: VISIT_EXPORT_DISPLAY_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

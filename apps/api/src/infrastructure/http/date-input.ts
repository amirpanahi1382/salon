import { ValidationError } from '@salon/shared';
import { isISO8601, ValidateBy } from 'class-validator';

const ABSOLUTE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const UTC_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isAbsoluteInstant(value: unknown): value is string {
  return typeof value === 'string' && ABSOLUTE_INSTANT.test(value) &&
    isISO8601(value, { strict: true, strictSeparator: true }) &&
    !Number.isNaN(new Date(value).getTime());
}

export function parseAbsoluteInstant(value: unknown, field: string): Date {
  if (!isAbsoluteInstant(value)) throw new ValidationError(`${field} must be a valid ISO-8601 instant with a timezone`);
  return new Date(value);
}

export function isUtcDate(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function IsAbsoluteInstant() {
  return ValidateBy({
    name: 'isAbsoluteInstant',
    validator: {
      validate: isAbsoluteInstant,
      defaultMessage: () => 'must be a valid ISO-8601 instant with a timezone',
    },
  });
}

export function IsUtcDate() {
  return ValidateBy({
    name: 'isUtcDate',
    validator: {
      validate: isUtcDate,
      defaultMessage: () => 'must be a valid YYYY-MM-DD calendar date',
    },
  });
}

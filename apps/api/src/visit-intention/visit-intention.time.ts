import { ValidationError, isUsableCustomerPhone, sanitizeCustomerNamePart } from '@salon/shared';
import { isUtcDate, parseAbsoluteInstant } from '../infrastructure/http/date-input';

export type VisitIntentionTimeInput = {
  precision?: string;
  agreedDate?: string;
  agreedInstant?: string;
};

export type ParsedVisitIntentionTime =
  | { precision: 'UNKNOWN'; agreedDate: null; agreedInstant: null }
  | { precision: 'DATE'; agreedDate: string; agreedInstant: null }
  | { precision: 'INSTANT'; agreedDate: null; agreedInstant: Date };

export function parseVisitIntentionTime(input: VisitIntentionTimeInput): ParsedVisitIntentionTime {
  const precision = input.precision;
  const hasDate = input.agreedDate !== undefined;
  const hasInstant = input.agreedInstant !== undefined;
  if (precision === 'UNKNOWN') {
    if (hasDate || hasInstant) {
      throw new ValidationError('Unknown visit time must not include a date or clock time');
    }
    return { precision: 'UNKNOWN', agreedDate: null, agreedInstant: null };
  }
  if (precision === 'DATE') {
    if (!hasDate || hasInstant) {
      throw new ValidationError('Date-only visit time requires agreedDate and no clock time');
    }
    if (!isUtcDate(input.agreedDate)) {
      throw new ValidationError('agreedDate must be a real YYYY-MM-DD calendar date');
    }
    return { precision: 'DATE', agreedDate: input.agreedDate, agreedInstant: null };
  }
  if (precision === 'INSTANT') {
    if (hasDate || !hasInstant) {
      throw new ValidationError('A clock time requires agreedInstant and no separate date');
    }
    return {
      precision: 'INSTANT',
      agreedDate: null,
      agreedInstant: parseAbsoluteInstant(input.agreedInstant, 'agreedInstant'),
    };
  }
  throw new ValidationError('time.precision must be UNKNOWN, DATE, or INSTANT');
}

export function timeCanonical(time: ParsedVisitIntentionTime): string {
  if (time.precision === 'UNKNOWN') return 'UNKNOWN';
  if (time.precision === 'DATE') return `DATE:${time.agreedDate}`;
  return `INSTANT:${time.agreedInstant.toISOString()}`;
}

export function agreedDateAsUtcNoon(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function formatAgreedDate(value: Date | null): string | null {
  if (!value) return null;
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDisclosedDisplayName(value: string | undefined): string | null {
  if (value === undefined) return null;
  const name = sanitizeCustomerNamePart(value);
  if (!name) {
    throw new ValidationError('disclosedDisplayName is invalid');
  }
  return name;
}

export function parseDisclosedPhone(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!isUsableCustomerPhone(value)) {
    throw new ValidationError('disclosedPhone must be exactly 11 digits starting with 09');
  }
  return value;
}

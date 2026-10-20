import { AgreementPhoneUnverifiedError, ValidationError } from '@salon/shared';
import { normalizeIranianMobile } from '../auth/signup-phone';
import type { DeclaredAgreementFields } from './contract-document';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FILL_MARK = '[توسط سفارش';
const ZWNJ = '\u200c';

/**
 * Persian name letters only (plus آ). Excludes Urdu-specific and other
 * Arabic-script letters that `\p{Script=Arabic}` would otherwise admit.
 */
const PERSIAN_NAME_LETTERS = new Set(
  Array.from('ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیآ'),
);

/** Map common Arabic keyboard letter forms to Persian equivalents. */
const ARABIC_TO_PERSIAN_LETTER: Record<string, string> = {
  '\u064A': '\u06CC', // ي → ی
  '\u0643': '\u06A9', // ك → ک
  '\u0629': '\u0647', // ة → ه (common salon/name typing)
};

export function normalizeDeclaredFields(
  input: { fullName: string; nationalId: string; salonName: string; phone: string },
  verifiedPhone: string,
): DeclaredAgreementFields {
  const fullName = normalizeDeclaredFullName(input.fullName);
  if (!fullName) {
    throw new ValidationError('Enter a Persian full name.');
  }
  const nationalIdResult = parseIranianNationalId(input.nationalId);
  if (nationalIdResult.status === 'empty') {
    throw new ValidationError('Enter a 10-digit national ID.');
  }
  if (nationalIdResult.status === 'format') {
    throw new ValidationError('National ID must be exactly 10 digits.');
  }
  if (nationalIdResult.status === 'checksum') {
    throw new ValidationError('National ID checksum is invalid.');
  }
  const salonName = normalizeDeclaredSalonName(input.salonName);
  if (!salonName) {
    throw new ValidationError('Enter the salon name.');
  }
  const phone = normalizeIranianMobile(input.phone);
  if (!phone) {
    throw new ValidationError('Enter an Iranian mobile number.');
  }
  if (phone !== verifiedPhone) {
    throw new AgreementPhoneUnverifiedError();
  }
  return { fullName, nationalId: nationalIdResult.value, salonName, phone };
}

export function normalizeDeclaredFullName(input: string): string | null {
  const compacted = normalizeWhitespaceAndHalfSpace(input);
  if (!compacted || compacted.length > 80 || compacted.includes(FILL_MARK)) {
    return null;
  }
  if (/[\u0000-\u001F\u007F]/.test(compacted)) {
    return null;
  }
  let normalized = '';
  for (const char of compacted) {
    if (char === ' ' || char === ZWNJ) {
      normalized += char;
      continue;
    }
    const mapped = ARABIC_TO_PERSIAN_LETTER[char] ?? char;
    if (!isPersianNameLetter(mapped)) {
      return null;
    }
    normalized += mapped;
  }
  if (!hasPersianLetter(normalized) || !separatorsOnlyBetweenLetters(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeDeclaredSalonName(input: string): string | null {
  const compacted = normalizeWhitespaceAndHalfSpace(input);
  if (!compacted || compacted.length > 120) {
    return null;
  }
  if (/[\u0000-\u001F\u007F]/.test(compacted) || compacted.includes(FILL_MARK)) {
    return null;
  }
  if (/\p{Extended_Pictographic}/u.test(compacted)) {
    return null;
  }
  let normalized = '';
  for (const char of compacted) {
    normalized += ARABIC_TO_PERSIAN_LETTER[char] ?? char;
  }
  // Persian and English letters (and mixed names) must be accepted.
  if (!/\p{L}/u.test(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeIranianNationalId(input: string): string | null {
  const parsed = parseIranianNationalId(input);
  return parsed.status === 'ok' ? parsed.value : null;
}

type NationalIdParse =
  | { status: 'ok'; value: string }
  | { status: 'empty' }
  | { status: 'format' }
  | { status: 'checksum' };

export function parseIranianNationalId(input: string): NationalIdParse {
  const digits = toAsciiDigits(input).replace(/\s/g, '');
  if (!digits) {
    return { status: 'empty' };
  }
  if (!/^\d+$/.test(digits)) {
    return { status: 'format' };
  }
  if (digits.length !== 10 || /^(\d)\1{9}$/.test(digits)) {
    return { status: 'format' };
  }
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(digits[index]) * (10 - index);
  }
  const remainder = sum % 11;
  const check = remainder < 2 ? remainder : 11 - remainder;
  if (check !== Number(digits[9])) {
    return { status: 'checksum' };
  }
  return { status: 'ok', value: digits };
}

function normalizeWhitespaceAndHalfSpace(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/(?:\u200c){2,}/g, ZWNJ)
    .trim();
}

function isPersianNameLetter(char: string): boolean {
  return PERSIAN_NAME_LETTERS.has(char);
}

function hasPersianLetter(value: string): boolean {
  for (const char of value) {
    if (isPersianNameLetter(char)) {
      return true;
    }
  }
  return false;
}

/** Spaces and half-spaces are allowed only between two Persian letters. */
function separatorsOnlyBetweenLetters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== ' ' && char !== ZWNJ) {
      continue;
    }
    const prev = value[index - 1];
    const next = value[index + 1];
    if (!prev || !next || !isPersianNameLetter(prev) || !isPersianNameLetter(next)) {
      return false;
    }
  }
  return true;
}

function toAsciiDigits(input: string): string {
  return input.trim().replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = PERSIAN_DIGITS.indexOf(digit);
    if (persian >= 0) {
      return String(persian);
    }
    return String(ARABIC_DIGITS.indexOf(digit));
  });
}

import { AgreementPhoneUnverifiedError, ValidationError } from '@salon/shared';
import { normalizeIranianMobile } from '../auth/signup-phone';
import type { DeclaredAgreementFields } from './contract-document';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FILL_MARK = '[توسط سفارش';

export function normalizeDeclaredFields(
  input: { fullName: string; nationalId: string; salonName: string; phone: string },
  verifiedPhone: string,
): DeclaredAgreementFields {
  const fullName = normalizeDeclaredText(input.fullName, 80);
  if (!fullName) {
    throw new ValidationError('Enter the full name.');
  }
  const nationalId = normalizeIranianNationalId(input.nationalId);
  if (!nationalId) {
    throw new ValidationError('Enter a 10-digit national ID.');
  }
  const salonName = normalizeDeclaredText(input.salonName, 120);
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
  return { fullName, nationalId, salonName, phone };
}

export function normalizeIranianNationalId(input: string): string | null {
  const digits = toAsciiDigits(input).replace(/\s/g, '');
  if (!/^\d{10}$/.test(digits) || /^(\d)\1{9}$/.test(digits)) {
    return null;
  }
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(digits[index]) * (10 - index);
  }
  const remainder = sum % 11;
  const check = remainder < 2 ? remainder : 11 - remainder;
  return check === Number(digits[9]) ? digits : null;
}

function normalizeDeclaredText(input: string, max: number): string | null {
  const normalized = input.normalize('NFC').replace(/[ \t\u00a0]+/g, ' ').trim();
  if (!normalized || normalized.length > max) {
    return null;
  }
  if (/[\u0000-\u001F\u007F]/.test(normalized) || normalized.includes(FILL_MARK)) {
    return null;
  }
  return normalized;
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

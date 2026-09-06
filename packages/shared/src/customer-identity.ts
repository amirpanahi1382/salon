export const CUSTOMER_NAME_MAX_LENGTH = 80;
export const CUSTOMER_PHONE_PATTERN = /^09\d{9}$/;
export const CUSTOMER_PHONE_RULE_MESSAGE =
  'Phone number must be exactly 11 digits and start with 09.';

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

/**
 * Canonical salon phone identity. Manual create and Excel import must share this.
 * Accepted format only: exactly 11 digits starting with 09, for example 09121111111.
 * Alternative forms are rejected, not converted.
 */
export function normalizeCustomerPhone(phone: string): string {
  return typeof phone === 'string' ? phone : '';
}

export function isUsableCustomerPhone(phone: string): boolean {
  return typeof phone === 'string' && CUSTOMER_PHONE_PATTERN.test(phone);
}

/** Trimmed name part, or null when the value is invalid. Empty string is allowed for lastName. */
export function sanitizeCustomerNamePart(raw: string): string | null {
  if (typeof raw !== 'string' || hasControlChars(raw)) {
    return null;
  }
  const name = raw.trim();
  if (name.length > CUSTOMER_NAME_MAX_LENGTH) {
    return null;
  }
  if (hasControlChars(name)) {
    return null;
  }
  return name;
}

/** Maps the Excel "Name" column onto firstName / lastName. */
export function splitCustomerDisplayName(
  raw: string,
): { firstName: string; lastName: string } | null {
  if (typeof raw !== 'string' || hasControlChars(raw)) {
    return null;
  }
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) {
    return null;
  }

  const space = name.indexOf(' ');
  if (space === -1) {
    const firstName = sanitizeCustomerNamePart(name);
    if (!firstName) {
      return null;
    }
    return { firstName, lastName: '' };
  }

  const firstName = sanitizeCustomerNamePart(name.slice(0, space));
  const lastName = sanitizeCustomerNamePart(name.slice(space + 1));
  if (!firstName || lastName === null) {
    return null;
  }
  return { firstName, lastName };
}

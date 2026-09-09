import { CUSTOMER_PHONE_PATTERN, isUsableCustomerPhone } from './customer-identity.js';

export const MESSAGE_DELIVERY_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'FAILED'] as const;
export type MessageDeliveryStatus = (typeof MESSAGE_DELIVERY_STATUSES)[number];

export const MESSAGE_PROVIDERS = ['BALE_SAFIR'] as const;
export type MessageProvider = (typeof MESSAGE_PROVIDERS)[number];

export const MESSAGE_CHANNELS = ['TEXT'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_FAILURE_CODES = [
  'PROVIDER_TEMPORARY',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_AUTH',
  'PROVIDER_INVALID_REQUEST',
  'PROVIDER_RECIPIENT_UNAVAILABLE',
  'PROVIDER_UNKNOWN',
  'NOT_CONFIGURED',
] as const;
export type MessageFailureCode = (typeof MESSAGE_FAILURE_CODES)[number];

/** Application limit. Provider maximum text length is UNVERIFIED. */
export const MESSAGE_BODY_MAX_LENGTH = 4096;

const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Maps stored salon phones (`09` + 9 digits) to Safir's documented destination format:
 * `98` + 10-digit national number, no separators.
 * Official docs also show a `+98…` example with a likely missing digit; we send the curl form.
 */
export function toSafirPhoneNumber(phone: string): string | null {
  if (!isUsableCustomerPhone(phone)) {
    return null;
  }
  return `98${phone.slice(1)}`;
}

export function maskCustomerPhone(phone: string): string {
  if (!CUSTOMER_PHONE_PATTERN.test(phone)) {
    return '09*******';
  }
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}

export function normalizeMessageBody(raw: string): string | null {
  if (typeof raw !== 'string' || CONTROL_EXCEPT_NEWLINE.test(raw)) {
    return null;
  }
  const text = raw.trim();
  if (text.length < 1 || text.length > MESSAGE_BODY_MAX_LENGTH) {
    return null;
  }
  return text;
}

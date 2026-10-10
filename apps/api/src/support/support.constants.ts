export const SUPPORT_PAGE_LIMIT = 30;
export const SUPPORT_TEXT_MAX_LENGTH = 2000;

export const SALON_SUPPORT_MESSAGE_OPERATION = 'support.salon_message';
export const ADMIN_SUPPORT_MESSAGE_OPERATION = 'support.admin_message';

const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/;

/** Trimmed support text, or null when empty, too long, or containing control characters. */
export function normalizeSupportText(raw: string): string | null {
  if (typeof raw !== 'string' || CONTROL_EXCEPT_NEWLINE.test(raw)) {
    return null;
  }
  const text = raw.trim();
  if (text.length < 1 || text.length > SUPPORT_TEXT_MAX_LENGTH) {
    return null;
  }
  return text;
}

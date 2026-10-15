import { createHash } from 'node:crypto';
import { AGREEMENT_VERSION_KEY, CONTRACT_V1_TEXT } from './CONTRACT_V1';

/** SHA-256 of the exact CONTRACT_V1 UTF-8 bytes. A different text needs a new version key. */
export const CONTRACT_V1_DIGEST = '1a702e024f540b9b76a2b554ccd745df5923ffdaee3b1f4a5cc8145e79351156';

const FILL_IN = '[توسط سفارش‌دهنده تکمیل می‌شود]';
const PHONE_FILL = '[توسط سفارش‌دهنده تکمیل و با رمز یک‌بارمصرف تأیید می‌شود]';
const AMOUNT_PHRASE = '۵۰٬۰۰۰٬۰۰۰ ریال، معادل ۵٬۰۰۰٬۰۰۰ تومان';
const RECIPIENT_PHRASE = '۵۰۰ ارسال قابل‌احتساب به ۵۰۰ مخاطب یکتای واجد شرایط';
const DURATION_PHRASE = '۳۰ روز تقویمی';
const BUTTON_WORDING = 'تأیید قرارداد و ادامه به راهنمای واریز';

const FIELD_ORDER = ['fullName', 'nationalId', 'salonName'] as const;

export type AgreementFieldName = (typeof FIELD_ORDER)[number] | 'phone';

export type AgreementSegment =
  | { type: 'text'; text: string }
  | { type: 'field'; field: AgreementFieldName };

export type DeclaredAgreementFields = {
  fullName: string;
  nationalId: string;
  salonName: string;
  phone: string;
};

export type AgreementScopeSnapshot = {
  currency: 'IRR';
  amountIrr: '50000000.00';
  amountPhrase: typeof AMOUNT_PHRASE;
  countedRecipientObligation: 500;
  countedRecipientPhrase: typeof RECIPIENT_PHRASE;
  durationCalendarDays: 30;
  durationPhrase: typeof DURATION_PHRASE;
};

export type ContractV1Parts = {
  versionKey: typeof AGREEMENT_VERSION_KEY;
  templateDigest: string;
  canonicalText: string;
  segments: AgreementSegment[];
  checkboxWording: string;
  buttonWording: typeof BUTTON_WORDING;
  scope: AgreementScopeSnapshot;
};

export function sha256Utf8(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

export function sha256Bytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Fails closed when the source bytes and the locked digest disagree. */
export function assertContractV1Intact(): ContractV1Parts {
  const templateDigest = sha256Utf8(CONTRACT_V1_TEXT);
  if (templateDigest !== CONTRACT_V1_DIGEST) {
    throw new Error(
      'CONTRACT_V1 bytes do not match its locked digest. Publish a new version instead of editing it.',
    );
  }
  if (!CONTRACT_V1_TEXT.includes(AMOUNT_PHRASE)) {
    throw new Error('CONTRACT_V1 is missing its amount phrase.');
  }
  if (!CONTRACT_V1_TEXT.includes(RECIPIENT_PHRASE)) {
    throw new Error('CONTRACT_V1 is missing its recipient obligation.');
  }
  if (!CONTRACT_V1_TEXT.includes(DURATION_PHRASE)) {
    throw new Error('CONTRACT_V1 is missing its duration phrase.');
  }
  const checkboxWording = extractCheckboxWording(CONTRACT_V1_TEXT);
  const buttonWording = extractButtonWording(CONTRACT_V1_TEXT);
  if (buttonWording !== BUTTON_WORDING) {
    throw new Error('CONTRACT_V1 confirmation button wording does not match the approved text.');
  }
  return {
    versionKey: AGREEMENT_VERSION_KEY,
    templateDigest,
    canonicalText: CONTRACT_V1_TEXT,
    segments: segmentContract(CONTRACT_V1_TEXT),
    checkboxWording,
    buttonWording,
    scope: {
      currency: 'IRR',
      amountIrr: '50000000.00',
      amountPhrase: AMOUNT_PHRASE,
      countedRecipientObligation: 500,
      countedRecipientPhrase: RECIPIENT_PHRASE,
      durationCalendarDays: 30,
      durationPhrase: DURATION_PHRASE,
    },
  };
}

export function segmentContract(template: string): AgreementSegment[] {
  const segments: AgreementSegment[] = [];
  let rest = template;
  for (const field of FIELD_ORDER) {
    const index = rest.indexOf(FILL_IN);
    if (index < 0) {
      throw new Error('CONTRACT_V1 is missing a fill-in field.');
    }
    if (index > 0) {
      segments.push({ type: 'text', text: rest.slice(0, index) });
    }
    segments.push({ type: 'field', field });
    rest = rest.slice(index + FILL_IN.length);
  }
  const phoneIndex = rest.indexOf(PHONE_FILL);
  if (phoneIndex < 0) {
    throw new Error('CONTRACT_V1 is missing the phone fill-in.');
  }
  if (phoneIndex > 0) {
    segments.push({ type: 'text', text: rest.slice(0, phoneIndex) });
  }
  segments.push({ type: 'field', field: 'phone' });
  rest = rest.slice(phoneIndex + PHONE_FILL.length);
  if (rest.includes(FILL_IN) || rest.includes(PHONE_FILL)) {
    throw new Error('CONTRACT_V1 has an unexpected fill-in.');
  }
  if (rest.length > 0) {
    segments.push({ type: 'text', text: rest });
  }
  return segments;
}

export function renderContract(template: string, fields: DeclaredAgreementFields): string {
  const values: Record<AgreementFieldName, string> = fields;
  return segmentContract(template)
    .map((segment) => (segment.type === 'text' ? segment.text : values[segment.field]))
    .join('');
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Display copy. The digest is of the canonical text bytes, not this HTML. */
export function agreementHtmlDocument(canonicalDocument: string): string {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><title>${AGREEMENT_VERSION_KEY}</title></head>
<body><pre>${escapeHtml(canonicalDocument)}</pre></body>
</html>`;
}

function extractCheckboxWording(template: string): string {
  const line = template.split('\n').find((item) => item.startsWith('☐ '));
  if (!line) {
    throw new Error('CONTRACT_V1 is missing the unchecked confirmation line.');
  }
  return line.slice('☐ '.length);
}

function extractButtonWording(template: string): string {
  const line = template.split('\n').find((item) => item.startsWith('**[') && item.endsWith(']**'));
  if (!line) {
    throw new Error('CONTRACT_V1 is missing the confirmation button.');
  }
  return line.slice(3, -3);
}

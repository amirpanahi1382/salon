import { createHash } from 'node:crypto';

/**
 * Server-owned destination for the manual transfer screen.
 * These values are not served unless MANUAL_TRANSFER_ENABLED is on.
 * Confirm them again before any live rollout. This is not an authorization
 * to request real payments, and it is not an online payment gateway.
 */
export const MANUAL_TRANSFER_CARD_NUMBER = '5859471121191492';
export const MANUAL_TRANSFER_CARDHOLDER_NAME = 'امیر محمد پناهی';
export const CONTRACT_PAYMENT_AMOUNT_IRR = '50000000.00';
export const CONTRACT_PAYMENT_AMOUNT_LABEL = '۵۰٬۰۰۰٬۰۰۰ ریال';

export const PAYMENT_REVIEW_NOTICE =
  'ثبت تصویر فیش به‌تنهایی به معنی تأیید واریز نیست. مدیر پلتفرم واریز بانکی را بررسی می‌کند.';

/** Exact sentence a platform admin must send to attest a manual bank check. */
export const BANK_TRANSFER_ATTESTATION =
  'واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export type PaymentInstructionSnapshot = {
  cardNumber: string;
  cardholderName: string;
  amountIrr: string;
  amountLabel: string;
  currency: 'IRR';
  agreementAcceptanceId: string;
  agreementVersionId: string;
  agreementVersionKey: string;
  notice: string;
};

export function formatIrrAmountLabel(amountIrr: string): string | null {
  if (!/^\d+\.\d{2}$/.test(amountIrr)) {
    return null;
  }
  const whole = amountIrr.slice(0, -3);
  if (!/^\d+$/.test(whole) || whole.length > 17) {
    return null;
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  const persian = grouped.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit);
  return `${persian} ریال`;
}

/** Amount and destination come from the server and the accepted contract, never the client. */
export function paymentInstructionsForAcceptance(input: {
  amountIrr: string;
  versionKey: string;
  acceptanceId: string;
  versionId: string;
}): PaymentInstructionSnapshot | null {
  if (input.versionKey !== 'CONTRACT_V1' || input.amountIrr !== CONTRACT_PAYMENT_AMOUNT_IRR) {
    return null;
  }
  const amountLabel = formatIrrAmountLabel(input.amountIrr);
  if (amountLabel !== CONTRACT_PAYMENT_AMOUNT_LABEL) {
    return null;
  }
  return {
    cardNumber: MANUAL_TRANSFER_CARD_NUMBER,
    cardholderName: MANUAL_TRANSFER_CARDHOLDER_NAME,
    amountIrr: input.amountIrr,
    amountLabel,
    currency: 'IRR',
    agreementAcceptanceId: input.acceptanceId,
    agreementVersionId: input.versionId,
    agreementVersionKey: input.versionKey,
    notice: PAYMENT_REVIEW_NOTICE,
  };
}

export function instructionDigest(snapshot: PaymentInstructionSnapshot): string {
  const canonical = JSON.stringify({
    agreementAcceptanceId: snapshot.agreementAcceptanceId,
    agreementVersionId: snapshot.agreementVersionId,
    agreementVersionKey: snapshot.agreementVersionKey,
    amountIrr: snapshot.amountIrr,
    amountLabel: snapshot.amountLabel,
    cardNumber: snapshot.cardNumber,
    cardholderName: snapshot.cardholderName,
    currency: snapshot.currency,
    notice: snapshot.notice,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function readStoredPaymentSnapshot(
  value: unknown,
  amountIrr: string,
): PaymentInstructionSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  const amountLabel = formatIrrAmountLabel(amountIrr);
  if (!amountLabel) {
    return null;
  }
  if (
    row.amountIrr !== amountIrr ||
    row.amountLabel !== amountLabel ||
    row.currency !== 'IRR' ||
    typeof row.cardNumber !== 'string' ||
    !/^\d{16}$/.test(row.cardNumber) ||
    typeof row.cardholderName !== 'string' ||
    row.cardholderName.trim().length < 3 ||
    row.cardholderName.length > 80 ||
    typeof row.agreementAcceptanceId !== 'string' ||
    typeof row.agreementVersionId !== 'string' ||
    typeof row.agreementVersionKey !== 'string' ||
    typeof row.notice !== 'string'
  ) {
    return null;
  }
  return {
    cardNumber: row.cardNumber,
    cardholderName: row.cardholderName,
    amountIrr,
    amountLabel,
    currency: 'IRR',
    agreementAcceptanceId: row.agreementAcceptanceId,
    agreementVersionId: row.agreementVersionId,
    agreementVersionKey: row.agreementVersionKey,
    notice: row.notice,
  };
}

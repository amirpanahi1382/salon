import { ValidationError } from './errors.js';

export const MONEY_CURRENCY_IRR = 'IRR' as const;

const MONEY_PATTERN = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

/** Parse an API money string into minor units (1/100 of IRR). Rejects JS numbers. */
export function parseMoneyString(value: string): bigint {
  if (typeof value !== 'string' || !MONEY_PATTERN.test(value.trim())) {
    throw new ValidationError('amount must be a non-negative decimal string with at most 2 fraction digits');
  }
  const [whole = '0', fraction = ''] = value.trim().split('.');
  const frac = `${fraction}00`.slice(0, 2);
  return BigInt(whole) * 100n + BigInt(frac);
}

export function formatMoneyString(minorUnits: bigint): string {
  if (minorUnits < 0n) {
    throw new ValidationError('amount cannot be negative');
  }
  const whole = minorUnits / 100n;
  const fraction = minorUnits % 100n;
  return `${whole.toString()}.${fraction.toString().padStart(2, '0')}`;
}

export function multiplyMoney(unitMinor: bigint, quantity: number): bigint {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9_999) {
    throw new ValidationError('quantity must be an integer from 1 to 9999');
  }
  return unitMinor * BigInt(quantity);
}

export function addMoney(values: bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

export function assertCurrencyIrr(value: string | undefined): typeof MONEY_CURRENCY_IRR {
  const currency = value ?? MONEY_CURRENCY_IRR;
  if (currency !== MONEY_CURRENCY_IRR) {
    throw new ValidationError('Only IRR is supported');
  }
  return MONEY_CURRENCY_IRR;
}

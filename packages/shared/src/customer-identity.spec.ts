import { isUsableCustomerPhone, normalizeCustomerPhone } from './customer-identity';

describe('customer identity', () => {
  it('trims phone numbers for salon-scoped identity', () => {
    expect(normalizeCustomerPhone('  09121234567  ')).toBe('09121234567');
  });

  it('rejects too-short phone values', () => {
    expect(isUsableCustomerPhone('123')).toBe(false);
    expect(isUsableCustomerPhone('09121234567')).toBe(true);
  });
});

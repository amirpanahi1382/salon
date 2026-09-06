import {
  CUSTOMER_PHONE_RULE_MESSAGE,
  isUsableCustomerPhone,
  normalizeCustomerPhone,
  sanitizeCustomerNamePart,
  splitCustomerDisplayName,
} from './customer-identity';

describe('customer identity', () => {
  it('accepts only the canonical 11-digit 09 phone format', () => {
    expect(isUsableCustomerPhone('09121111111')).toBe(true);
    expect(normalizeCustomerPhone('09121111111')).toBe('09121111111');
    expect(CUSTOMER_PHONE_RULE_MESSAGE).toContain('11 digits');
  });

  it('rejects leading or trailing whitespace instead of trimming it', () => {
    expect(isUsableCustomerPhone(' 09121111111')).toBe(false);
    expect(isUsableCustomerPhone('09121111111 ')).toBe(false);
    expect(normalizeCustomerPhone(' 09121111111')).toBe(' 09121111111');
    expect(normalizeCustomerPhone('09121111111 ')).toBe('09121111111 ');
  });

  it('rejects alternative phone forms instead of converting them', () => {
    const invalid = [
      '9121111111',
      '+989121111111',
      '00989121111111',
      '0912 111 1111',
      '0912-111-1111',
      '0912111111',
      '091211111111',
      '981211111111',
      '12345678901',
      ' 09121111111',
      '09121111111 ',
      '۰۹۱۲۱۱۱۱۱۱۱',
      '',
    ];
    for (const phone of invalid) {
      expect(isUsableCustomerPhone(phone)).toBe(false);
      expect(normalizeCustomerPhone(phone)).toBe(phone);
    }
    expect(isUsableCustomerPhone(null as unknown as string)).toBe(false);
  });

  it('sanitizes name parts without restricting Persian or Latin letters', () => {
    expect(sanitizeCustomerNamePart('  Sara  ')).toBe('Sara');
    expect(sanitizeCustomerNamePart('سارا')).toBe('سارا');
    expect(sanitizeCustomerNamePart('   ')).toBe('');
    expect(sanitizeCustomerNamePart('Sara\u0007')).toBeNull();
    expect(sanitizeCustomerNamePart('A'.repeat(81))).toBeNull();
  });

  it('splits a display name on the first space', () => {
    expect(splitCustomerDisplayName('  Sara   Ahmadi  ')).toEqual({
      firstName: 'Sara',
      lastName: 'Ahmadi',
    });
    expect(splitCustomerDisplayName('Maryam')).toEqual({
      firstName: 'Maryam',
      lastName: '',
    });
    expect(splitCustomerDisplayName('مریم احمدی')).toEqual({
      firstName: 'مریم',
      lastName: 'احمدی',
    });
    expect(splitCustomerDisplayName('   ')).toBeNull();
    expect(splitCustomerDisplayName('Sara\u0001 Ahmadi')).toBeNull();
  });
});

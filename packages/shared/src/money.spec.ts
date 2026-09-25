import { parseMoneyString, formatMoneyString, multiplyMoney, addMoney, assertStoredMoneyRange } from './money';

describe('money strings', () => {
  it('parses and formats two-decimal IRR amounts without floating point', () => {
    expect(formatMoneyString(parseMoneyString('1500000'))).toBe('1500000.00');
    expect(formatMoneyString(parseMoneyString('1500000.5'))).toBe('1500000.50');
    expect(formatMoneyString(parseMoneyString('0.09'))).toBe('0.09');
    expect(formatMoneyString(multiplyMoney(parseMoneyString('10.00'), 3))).toBe('30.00');
    expect(formatMoneyString(addMoney([parseMoneyString('1.10'), parseMoneyString('2.20')]))).toBe(
      '3.30',
    );
  });

  it('rejects invalid money strings', () => {
    expect(() => parseMoneyString('-1.00')).toThrow();
    expect(() => parseMoneyString('1.001')).toThrow();
    expect(() => parseMoneyString('01.00')).toThrow();
    expect(() => parseMoneyString('')).toThrow();
    for (const value of [' 1.00', '1.00 ', '1e3', 'NaN', 'Infinity', '1,000.00', '+1.00', '1.001']) {
      expect(() => parseMoneyString(value)).toThrow();
    }
    expect(() => parseMoneyString(1 as unknown as string)).toThrow();
  });

  it('accepts the NUMERIC(19,2) maximum and rejects one cent more or aggregate overflow', () => {
    expect(parseMoneyString('99999999999999999.99')).toBe(9_999_999_999_999_999_999n);
    expect(() => parseMoneyString('100000000000000000.00')).toThrow();
    expect(() => multiplyMoney(parseMoneyString('50000000000000000.00'), 2)).toThrow();
    expect(() => assertStoredMoneyRange(addMoney([
      parseMoneyString('50000000000000000.00'),
      parseMoneyString('50000000000000000.00'),
    ]))).toThrow();
  });
});

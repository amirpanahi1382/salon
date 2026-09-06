import { parseMoneyString, formatMoneyString, multiplyMoney, addMoney } from './money';

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
  });
});

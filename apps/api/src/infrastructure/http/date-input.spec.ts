import { isAbsoluteInstant, isUtcDate, parseAbsoluteInstant } from './date-input';

describe('date input', () => {
  it('accepts leap days and explicit offsets while preserving the instant', () => {
    expect(isUtcDate('2024-02-29')).toBe(true);
    expect(parseAbsoluteInstant('2024-02-29T12:30:00+03:30', 'at').toISOString())
      .toBe('2024-02-29T09:00:00.000Z');
  });

  it.each(['2023-02-29', '2026-04-31', '2026-13-01', '2026-00-01'])
  ('rejects impossible date %s', (value) => expect(isUtcDate(value)).toBe(false));

  it.each([
    '2023-02-29T10:00:00Z', '2026-04-31T10:00:00Z',
    '2026-09-01T10:00:00', '2026-09-01 10:00:00Z',
    'not-a-date', null, {},
  ])('rejects invalid instant %s', (value) => {
    expect(isAbsoluteInstant(value)).toBe(false);
    expect(() => parseAbsoluteInstant(value, 'at')).toThrow();
  });
});

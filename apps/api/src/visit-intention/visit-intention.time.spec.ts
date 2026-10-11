import { ValidationError } from '@salon/shared';
import { formatAgreedDate, parseVisitIntentionTime } from './visit-intention.time';

describe('visit intention time', () => {
  it('accepts an unknown time without inventing a date or instant', () => {
    expect(parseVisitIntentionTime({ precision: 'UNKNOWN' })).toEqual({
      precision: 'UNKNOWN',
      agreedDate: null,
      agreedInstant: null,
    });
  });

  it('rejects a date or clock time attached to an unknown precision', () => {
    expect(() =>
      parseVisitIntentionTime({ precision: 'UNKNOWN', agreedDate: '2026-10-10' }),
    ).toThrow(ValidationError);
    expect(() =>
      parseVisitIntentionTime({
        precision: 'UNKNOWN',
        agreedInstant: '2026-10-10T12:00:00.000Z',
      }),
    ).toThrow(ValidationError);
  });

  it('keeps a date-only value as a calendar date', () => {
    expect(parseVisitIntentionTime({ precision: 'DATE', agreedDate: '2026-10-10' })).toEqual({
      precision: 'DATE',
      agreedDate: '2026-10-10',
      agreedInstant: null,
    });
    expect(formatAgreedDate(new Date('2026-10-10T00:00:00.000Z'))).toBe('2026-10-10');
  });

  it('rejects an impossible calendar date and a date that also has a clock time', () => {
    expect(() => parseVisitIntentionTime({ precision: 'DATE', agreedDate: '2026-02-31' })).toThrow(
      ValidationError,
    );
    expect(() =>
      parseVisitIntentionTime({
        precision: 'DATE',
        agreedDate: '2026-10-10',
        agreedInstant: '2026-10-10T00:00:00.000Z',
      }),
    ).toThrow(ValidationError);
  });

  it('requires an explicit timezone for a clock time', () => {
    const parsed = parseVisitIntentionTime({
      precision: 'INSTANT',
      agreedInstant: '2026-10-10T15:30:00.000+03:30',
    });
    if (parsed.precision !== 'INSTANT') {
      throw new Error('expected an instant');
    }
    expect(parsed.agreedInstant.toISOString()).toBe('2026-10-10T12:00:00.000Z');
    expect(() =>
      parseVisitIntentionTime({ precision: 'INSTANT', agreedInstant: '2026-10-10T15:30:00' }),
    ).toThrow(ValidationError);
  });
});

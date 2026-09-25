import { decodeCursor, encodeCursor, parseCursorInstant, parseCursorInteger, parseCursorUuid, toListPage } from './list-page';

describe('toListPage', () => {
  it('sets hasMore when the extra probe row is present', () => {
    expect(toListPage([1, 2, 3], 2, (row) => String(row))).toEqual({
      items: [1, 2],
      hasMore: true,
      nextCursor: '2',
    });
    expect(toListPage([1, 2], 2, (row) => String(row))).toEqual({
      items: [1, 2],
      hasMore: false,
      nextCursor: null,
    });
  });
});

describe('cursor validation', () => {
  const id = '01a0d899-d762-7352-a5fb-79449cdb0da7';

  it('round trips a valid tuple', () => {
    expect(decodeCursor(encodeCursor(['2024-02-29T10:00:00.000Z', id]), 2))
      .toEqual(['2024-02-29T10:00:00.000Z', id]);
    expect(decodeCursor(undefined, 2)).toBeUndefined();
  });

  it.each(['', '@@@', 'a', 'A'.repeat(513), Buffer.from('one').toString('base64url')])
    ('rejects malformed encoding or structure: %s', (value) => {
      expect(() => decodeCursor(value, 2)).toThrow('Invalid cursor');
    });

  it.each(['2024-02-30T10:00:00Z', '2024-02-29T10:00:00', 'nonsense'])
    ('rejects invalid cursor instant: %s', (value) => {
      expect(() => parseCursorInstant(value)).toThrow('Invalid cursor');
    });

  it.each(['not-a-uuid', '001', ''])('rejects invalid cursor identifier: %s', (value) => {
    expect(() => parseCursorUuid(value)).toThrow('Invalid cursor');
  });

  it.each(['-1', '1.5', '01', '1e3', '9007199254740992'])
    ('rejects invalid cursor integer: %s', (value) => {
      expect(() => parseCursorInteger(value)).toThrow('Invalid cursor');
    });
  it('accepts the lower integer boundary', () => {
    expect(parseCursorInteger('0')).toBe(0);
  });
});

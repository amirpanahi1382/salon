import { firstHeaderValue, isSafeRequestId } from './request-id';

describe('isSafeRequestId', () => {
  it('accepts UUID v4/v7 shaped values', () => {
    expect(isSafeRequestId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isSafeRequestId('018f3a2b-8c4d-7e1f-9a0b-123456789abc')).toBe(true);
  });

  it('rejects empty, injected, or oversized values', () => {
    expect(isSafeRequestId('')).toBe(false);
    expect(isSafeRequestId('not-a-uuid')).toBe(false);
    expect(isSafeRequestId('x\nAuthorization: Bearer abc')).toBe(false);
    expect(isSafeRequestId(['550e8400-e29b-41d4-a716-446655440000'])).toBe(false);
  });
});

describe('firstHeaderValue', () => {
  it('reads a string or first array entry', () => {
    expect(firstHeaderValue('abc')).toBe('abc');
    expect(firstHeaderValue(['a', 'b'])).toBe('a');
    expect(firstHeaderValue(undefined)).toBeUndefined();
  });
});

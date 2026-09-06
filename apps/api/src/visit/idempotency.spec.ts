import { ConflictError, ValidationError } from '@salon/shared';
import {
  assertSameIdempotentRequest,
  normalizeIdempotencyKey,
  visitCompleteWithSaleRequestHash,
  visitCreateRequestHash,
} from './idempotency';

describe('visit idempotency helpers', () => {
  it('accepts UUID-shaped keys and rejects short or unsafe keys', () => {
    expect(normalizeIdempotencyKey('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toHaveLength(36);
    expect(normalizeIdempotencyKey(undefined)).toBeUndefined();
    expect(normalizeIdempotencyKey('')).toBeUndefined();
    expect(() => normalizeIdempotencyKey('short')).toThrow(ValidationError);
    expect(() => normalizeIdempotencyKey('has space!!')).toThrow(ValidationError);
  });

  it('hashes customer and visitedAt, not the opaque key', () => {
    const at = new Date('2026-09-01T10:00:00.000Z');
    const a = visitCreateRequestHash('c1', at);
    const b = visitCreateRequestHash('c1', at);
    const c = visitCreateRequestHash('c2', at);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });

  it('hashes combined visit-with-sale payload fields', () => {
    const base = {
      customerId: 'c1',
      visitedAt: '2026-08-01T10:00:00.000Z',
      serviceId: 'svc1',
      amount: '8000000.00',
      currency: 'IRR',
    };
    expect(visitCompleteWithSaleRequestHash(base)).toBe(visitCompleteWithSaleRequestHash(base));
    expect(visitCompleteWithSaleRequestHash(base)).not.toBe(
      visitCompleteWithSaleRequestHash({ ...base, amount: '100.00' }),
    );
  });

  it('rejects reused keys with a different fingerprint', () => {
    expect(() => assertSameIdempotentRequest('aaa', 'bbb')).toThrow(ConflictError);
    expect(() => assertSameIdempotentRequest('aaa', 'aaa')).not.toThrow();
  });
});

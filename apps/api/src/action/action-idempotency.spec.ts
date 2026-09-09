import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';
import { ACTION_CREATE_OPERATION, actionCreateRequestHash } from './action-idempotency';

describe('actionCreateRequestHash', () => {
  it('fingerprints tenant-independent customer and opportunity identity', () => {
    expect(actionCreateRequestHash('c1', 'REACTIVATION')).toBe(
      hashIdempotencyPayload(ACTION_CREATE_OPERATION, 'c1:REACTIVATION'),
    );
    expect(actionCreateRequestHash('c1', 'REACTIVATION')).not.toBe(
      actionCreateRequestHash('c1', 'CUSTOMER_RETURN'),
    );
  });
});

import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';
import { MESSAGE_SEND_OPERATION, messageSendRequestHash } from './message-idempotency';

describe('messageSendRequestHash', () => {
  it('changes when the message body changes', () => {
    const a = messageSendRequestHash('c1', 'REVENUE_DECLINE', 'سلام');
    const b = messageSendRequestHash('c1', 'REVENUE_DECLINE', 'سلام ۲');
    expect(a).not.toBe(b);
    expect(a).toBe(hashIdempotencyPayload(MESSAGE_SEND_OPERATION, 'c1:REVENUE_DECLINE:سلام'));
  });
});

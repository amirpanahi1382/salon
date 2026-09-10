import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';
import {
  MANUAL_OUTREACH_MESSAGE_SEND_OPERATION,
  MESSAGE_SEND_OPERATION,
  manualOutreachMessageRequestHash,
  messageSendRequestHash,
} from './message-idempotency';

describe('messageSendRequestHash', () => {
  it('changes when the message body changes', () => {
    const a = messageSendRequestHash('c1', 'REVENUE_DECLINE', 'سلام');
    const b = messageSendRequestHash('c1', 'REVENUE_DECLINE', 'سلام ۲');
    expect(a).not.toBe(b);
    expect(a).toBe(hashIdempotencyPayload(MESSAGE_SEND_OPERATION, 'c1:REVENUE_DECLINE:سلام'));
  });

  it('hashes manual outreach without an opportunity type', () => {
    const a = manualOutreachMessageRequestHash('c1', 'سلام');
    const b = manualOutreachMessageRequestHash('c1', 'سلام ۲');
    expect(a).not.toBe(b);
    expect(a).toBe(hashIdempotencyPayload(MANUAL_OUTREACH_MESSAGE_SEND_OPERATION, 'c1:سلام'));
  });
});

import {
  ordinaryRequestedMessageQuantityExcludingCancelled,
  ordinaryRequestedMessageQuantityIncludingCancelled,
  recordedSendCount,
  vipRequestedMessageQuantity,
  vipRequestedMessageQuantityIncludingOpenDrafts,
  type OrdinaryRequestFact,
  type RecordedSendFact,
  type VipRequestQuantityFact,
} from './message-quantity';

const vipRequests: VipRequestQuantityFact[] = [
  { status: 'AWAITING_SAMPLE_WORK', requestedCount: 30 },
  { status: 'SUBMITTED', requestedCount: 50 },
  { status: 'BALE_NOT_IMPLEMENTED', requestedCount: 30 },
  { status: 'MANUAL_QUEUED', requestedCount: 50 },
  { status: 'CANCELLED', requestedCount: 30 },
];

const ordinaryRequests: OrdinaryRequestFact[] = [
  { status: 'SENT' },
  { status: 'SENT' },
  { status: 'QUEUED' },
  { status: 'CANCELLED' },
];

const vipDeliveries: RecordedSendFact[] = [
  { status: 'SENT', submittedAt: new Date('2026-10-01T00:00:00Z'), attempts: 3 },
  { status: 'SENT', submittedAt: null, attempts: 1 },
  { status: 'FAILED', submittedAt: null, attempts: 2 },
  { status: 'PENDING', submittedAt: null, attempts: 0 },
];

describe('message quantity oracle', () => {
  it('counts VIP messages from the salon-selected quantity after submit', () => {
    expect(vipRequestedMessageQuantity(vipRequests)).toBe(130);
  });

  it('keeps the open-draft choice separate from the proposed denominator', () => {
    expect(vipRequestedMessageQuantityIncludingOpenDrafts(vipRequests)).toBe(160);
  });

  it('does not count a VIP list or a request batch as the message quantity', () => {
    expect(vipRequestedMessageQuantity(vipRequests)).not.toBe(vipRequests.length);
    expect(vipRequestedMessageQuantity(vipRequests)).not.toBe(1);
  });

  it('shows both ordinary cancellation choices', () => {
    expect(ordinaryRequestedMessageQuantityIncludingCancelled(ordinaryRequests)).toBe(4);
    expect(ordinaryRequestedMessageQuantityExcludingCancelled(ordinaryRequests)).toBe(3);
  });

  it('counts one recorded send for a retried delivery and ignores an unsubmitted SENT row', () => {
    expect(recordedSendCount(vipDeliveries)).toBe(1);
  });
});

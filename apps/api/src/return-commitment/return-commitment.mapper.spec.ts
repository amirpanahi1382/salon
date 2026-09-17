import { toAssociatedRevenue, toCommitmentBackedReturn, toReturnCommitmentResponse } from './return-commitment.mapper';

describe('return commitment read mapper', () => {
  const row = {
    id: 'rc1',
    customerId: 'c1',
    sourceMessageRequestId: 'req1',
    sourceMessageDeliveryId: 'del1',
    expectedAt: new Date('2026-09-16T16:00:00.000Z'),
    actualVisitId: 'v1',
    createdByUserId: 'u1',
    updatedByUserId: 'u1',
    createdAt: new Date('2026-09-10T10:00:00.000Z'),
    updatedAt: new Date('2026-09-16T16:22:00.000Z'),
  };

  it('keeps expectedAt distinct from actual visitedAt and records 0.00 vs none', () => {
    const visit = { id: 'v1', visitedAt: new Date('2026-09-16T16:22:00.000Z') };
    const none = toReturnCommitmentResponse(row, toCommitmentBackedReturn(visit, undefined));
    expect(none.expectedAt).toBe('2026-09-16T16:00:00.000Z');
    expect(none.commitmentBackedReturn?.actualVisit.visitedAt).toBe('2026-09-16T16:22:00.000Z');
    expect(none.commitmentBackedReturn?.associatedRevenue).toEqual({
      recorded: false,
      currency: 'IRR',
      amount: null,
    });
    expect(toAssociatedRevenue(0n)).toEqual({ recorded: true, currency: 'IRR', amount: '0.00' });
    expect(toAssociatedRevenue(123n)).toEqual({ recorded: true, currency: 'IRR', amount: '1.23' });
  });
});

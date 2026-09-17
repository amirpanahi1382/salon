import { toObservedReturnResponse } from './observed-outcome.mapper';
import type { ObservedReturnAssociation } from '@salon/shared';

const row: ObservedReturnAssociation = {
  intervention: {
    deliveryId: 'd1',
    requestId: 'r1',
    submittedAt: new Date('2026-09-05T10:00:00.000Z'),
    createdAt: new Date('2026-09-05T10:00:00.000Z'),
    requestedAt: new Date('2026-09-05T08:00:00.000Z'),
    origin: 'MANUAL',
    opportunityType: null,
    actionId: null,
    sourceVisitId: null,
  },
  returnVisit: {
    id: 'v1',
    visitedAt: new Date('2026-09-08T10:00:00.000Z'),
    createdAt: new Date('2026-09-08T10:00:00.000Z'),
  },
};

describe('toObservedReturnResponse', () => {
  it('keeps no recorded revenue distinct from recorded 0.00', () => {
    const none = toObservedReturnResponse(row, { recorded: false, amountMinor: null });
    expect(none.associatedRevenue).toEqual({ recorded: false, currency: 'IRR', amount: null });
    expect(none.associationKind).toBe('OBSERVED');
    expect(none.intervention.kind).toBe('MESSAGE');
    expect(none.intervention.occurredAt).toBe('2026-09-05T10:00:00.000Z');
    expect(none.observedReturn.occurredAt).toBe('2026-09-08T10:00:00.000Z');

    const zero = toObservedReturnResponse(row, { recorded: true, amountMinor: 0n });
    expect(zero.associatedRevenue).toEqual({ recorded: true, currency: 'IRR', amount: '0.00' });
  });
});

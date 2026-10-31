import {
  agreedOperationalCount,
  openReturnCommitments,
  openVisitIntentions,
  type CommitmentFact,
  type IntentionFact,
} from './agreed-time';

const commitments: CommitmentFact[] = [
  {
    id: 'c-open-salon',
    customerId: 'customer-1',
    sourceMessageRequestId: 'message-1',
    actualVisitId: null,
    operationallySettled: false,
    createdBy: 'SALON_USER',
  },
  {
    id: 'c-open-admin',
    customerId: 'customer-1',
    sourceMessageRequestId: 'message-2',
    actualVisitId: null,
    operationallySettled: false,
    createdBy: 'PLATFORM_ADMIN',
  },
  {
    id: 'c-linked',
    customerId: 'customer-2',
    sourceMessageRequestId: 'message-3',
    actualVisitId: 'visit-1',
    operationallySettled: false,
    createdBy: 'SALON_USER',
  },
  {
    id: 'c-settled',
    customerId: 'customer-3',
    sourceMessageRequestId: 'message-4',
    actualVisitId: null,
    operationallySettled: true,
    createdBy: 'PLATFORM_ADMIN',
  },
];

const intentions: IntentionFact[] = [
  {
    id: 'i-unknown',
    subject: 'CUSTOMER',
    customerId: 'customer-1',
    sourceMessageRequestId: 'message-1',
    timePrecision: 'UNKNOWN',
    linkedVisitId: null,
    createdBy: 'SALON_USER',
  },
  {
    id: 'i-date',
    subject: 'VIP_PROSPECT',
    customerId: null,
    sourceMessageRequestId: null,
    timePrecision: 'DATE',
    linkedVisitId: null,
    createdBy: 'PLATFORM_ADMIN',
  },
  {
    id: 'i-instant',
    subject: 'CUSTOMER',
    customerId: 'customer-4',
    sourceMessageRequestId: null,
    timePrecision: 'INSTANT',
    linkedVisitId: null,
    createdBy: 'SALON_USER',
  },
  {
    id: 'i-linked',
    subject: 'VIP_PROSPECT',
    customerId: null,
    sourceMessageRequestId: null,
    timePrecision: 'INSTANT',
    linkedVisitId: 'visit-9',
    createdBy: 'SALON_USER',
  },
];

describe('agreed operational population', () => {
  it('keeps every open commitment, including two for one customer', () => {
    expect(openReturnCommitments(commitments).map((row) => row.id)).toEqual([
      'c-open-salon',
      'c-open-admin',
    ]);
  });

  it('keeps untimed, date-only, and exact-time intentions until a Visit is linked', () => {
    expect(openVisitIntentions(intentions).map((row) => row.id)).toEqual([
      'i-unknown',
      'i-date',
      'i-instant',
    ]);
  });

  it('keeps historical, open, and operational totals distinct', () => {
    const historical = commitments.length;
    const open = openReturnCommitments(commitments).length;
    const operational = agreedOperationalCount(commitments, intentions);
    expect(historical).toBe(4);
    expect(open).toBe(2);
    expect(operational).toBe(5);
    expect(new Set([historical, open, operational]).size).toBe(3);
  });

  it('adds the two models without merging a shared customer or source message', () => {
    expect(agreedOperationalCount(commitments, intentions)).toBe(5);
    const openCommitments = openReturnCommitments(commitments);
    const openIntentions = openVisitIntentions(intentions);
    expect(
      openIntentions.some((intention) =>
        openCommitments.some(
          (commitment) =>
            commitment.customerId === intention.customerId
            && commitment.sourceMessageRequestId === intention.sourceMessageRequestId,
        ),
      ),
    ).toBe(true);
  });
});

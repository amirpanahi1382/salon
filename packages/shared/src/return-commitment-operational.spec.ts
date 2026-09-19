import {
  isOperationallyOpenReturnCommitment,
  visitQualifiesAsOperationalReturnEvidence,
} from './return-commitment-operational.js';

const submittedAt = new Date('2026-09-10T10:00:00.000Z');

describe('operational ReturnCommitment openness', () => {
  it('requires visitedAt strictly after source submittedAt', () => {
    expect(
      visitQualifiesAsOperationalReturnEvidence({
        sourceSubmittedAt: submittedAt,
        visitVisitedAt: submittedAt,
      }),
    ).toBe(false);
    expect(
      visitQualifiesAsOperationalReturnEvidence({
        sourceSubmittedAt: submittedAt,
        visitVisitedAt: new Date('2026-09-10T09:59:59.999Z'),
      }),
    ).toBe(false);
    expect(
      visitQualifiesAsOperationalReturnEvidence({
        sourceSubmittedAt: submittedAt,
        visitVisitedAt: new Date('2026-09-10T10:00:00.001Z'),
      }),
    ).toBe(true);
    expect(
      visitQualifiesAsOperationalReturnEvidence({
        sourceSubmittedAt: null,
        visitVisitedAt: new Date('2026-09-11T00:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('treats explicit actualVisitId as settled regardless of other visits', () => {
    expect(
      isOperationallyOpenReturnCommitment({
        actualVisitId: 'v1',
        sourceSubmittedAt: submittedAt,
        visits: [],
      }),
    ).toBe(false);
  });

  it('settles unlinked commitments when a later visit exists, without requiring expectedAt', () => {
    expect(
      isOperationallyOpenReturnCommitment({
        actualVisitId: null,
        sourceSubmittedAt: submittedAt,
        visits: [{ visitedAt: new Date('2026-09-10T12:00:00.000Z') }],
      }),
    ).toBe(false);
    expect(
      isOperationallyOpenReturnCommitment({
        actualVisitId: null,
        sourceSubmittedAt: submittedAt,
        visits: [{ visitedAt: submittedAt }],
      }),
    ).toBe(true);
  });
});

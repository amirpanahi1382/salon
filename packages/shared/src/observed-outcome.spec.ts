import {
  associateObservedReturns,
  classifyPreferredVisitEvidence,
  COMMITMENT_BACKED_ASSOCIATION_KIND,
  compareVisitsAscending,
  INTERVENTION_KIND_MESSAGE,
  interventionOriginFromRequest,
  isEligibleCustomerMessageIntervention,
  isLaterLastTouch,
  lastTouchInterventionForVisit,
  OBSERVED_ASSOCIATION_KIND,
  OBSERVED_ASSOCIATION_RULE,
  type CandidateVisit,
  type EligibleMessageIntervention,
  type ObservedReturnAssociation,
} from './observed-outcome';

function at(iso: string): Date {
  return new Date(iso);
}

function visit(id: string, visitedAt: string, createdAt = visitedAt): CandidateVisit {
  return { id, visitedAt: at(visitedAt), createdAt: at(createdAt) };
}

function message(
  deliveryId: string,
  submittedAt: string,
  extras: Partial<Omit<EligibleMessageIntervention, 'deliveryId' | 'submittedAt'>> = {},
): EligibleMessageIntervention {
  const submitted = at(submittedAt);
  return {
    deliveryId,
    requestId: extras.requestId ?? `req-${deliveryId}`,
    submittedAt: submitted,
    createdAt: extras.createdAt ?? submitted,
    requestedAt: extras.requestedAt ?? submitted,
    origin: extras.origin ?? 'MANUAL',
    opportunityType: extras.opportunityType ?? null,
    actionId: extras.actionId ?? null,
    sourceVisitId: extras.sourceVisitId ?? null,
  };
}

function assertUniqueness(rows: ObservedReturnAssociation[]): void {
  const visits = new Set<string>();
  const deliveries = new Set<string>();
  for (const row of rows) {
    expect(visits.has(row.returnVisit.id)).toBe(false);
    expect(deliveries.has(row.intervention.deliveryId)).toBe(false);
    visits.add(row.returnVisit.id);
    deliveries.add(row.intervention.deliveryId);
  }
}

describe('observed outcome vocabulary', () => {
  it('names observed association, not attribution', () => {
    expect(OBSERVED_ASSOCIATION_KIND).toBe('OBSERVED');
    expect(INTERVENTION_KIND_MESSAGE).toBe('MESSAGE');
    expect(OBSERVED_ASSOCIATION_RULE).toContain('OBSERVED_LAST_TOUCH');
    expect(OBSERVED_ASSOCIATION_RULE).not.toMatch(/ATTRIBUT|CAUSAL|GENERATED/i);
  });
});

describe('classifyPreferredVisitEvidence', () => {
  it('prefers COMMITMENT_BACKED over OBSERVED for the same visit and never double-counts', () => {
    const classified = classifyPreferredVisitEvidence([
      { visitId: 'v1', kind: OBSERVED_ASSOCIATION_KIND },
      { visitId: 'v1', kind: COMMITMENT_BACKED_ASSOCIATION_KIND },
      { visitId: 'v2', kind: OBSERVED_ASSOCIATION_KIND },
    ]);
    expect(classified).toEqual([
      { visitId: 'v1', kind: COMMITMENT_BACKED_ASSOCIATION_KIND },
      { visitId: 'v2', kind: OBSERVED_ASSOCIATION_KIND },
    ]);
    expect(new Set(classified.map((row) => row.visitId)).size).toBe(classified.length);
  });

  it('does not treat COMMITMENT_BACKED as causal attribution vocabulary', () => {
    expect(COMMITMENT_BACKED_ASSOCIATION_KIND).toBe('COMMITMENT_BACKED');
    expect(COMMITMENT_BACKED_ASSOCIATION_KIND).not.toMatch(/ATTRIBUT|INCREMENTAL|GENERATED/i);
  });
});

describe('associateObservedReturns', () => {
  it('does not associate a visit at or before submittedAt', () => {
    const a = message('A', '2026-09-05T10:00:00.000Z');
    expect(
      associateObservedReturns(
        [visit('v-eq', '2026-09-05T10:00:00.000Z'), visit('v-before', '2026-09-05T09:59:59.000Z')],
        [a],
      ),
    ).toEqual([]);
  });

  it('associates the first visit strictly after submittedAt', () => {
    const a = message('A', '2026-09-05T10:00:00.000Z');
    const rows = associateObservedReturns(
      [visit('v1', '2026-09-05T10:00:00.001Z'), visit('v2', '2026-09-06T10:00:00.000Z')],
      [a],
    );
    assertUniqueness(rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.intervention.deliveryId).toBe('A');
    expect(rows[0]?.returnVisit.id).toBe('v1');
  });

  it('does not treat a visit between requestedAt and submittedAt as a return', () => {
    const a = message('A', '2026-09-05T18:00:00.000Z', {
      requestedAt: at('2026-09-05T08:00:00.000Z'),
    });
    expect(
      associateObservedReturns([visit('v-mid', '2026-09-05T12:00:00.000Z')], [a]),
    ).toEqual([]);
  });

  it('A then B then Visit associates B only', () => {
    const a = message('A', '2026-09-01T10:00:00.000Z');
    const b = message('B', '2026-09-05T10:00:00.000Z');
    const rows = associateObservedReturns([visit('v1', '2026-09-08T10:00:00.000Z')], [a, b]);
    assertUniqueness(rows);
    expect(rows.map((row) => [row.intervention.deliveryId, row.returnVisit.id])).toEqual([
      ['B', 'v1'],
    ]);
  });

  it('A then B then Visit1 then Visit2 associates B -> Visit1 only', () => {
    const a = message('A', '2026-09-01T10:00:00.000Z');
    const b = message('B', '2026-09-05T10:00:00.000Z');
    const rows = associateObservedReturns(
      [visit('v1', '2026-09-08T10:00:00.000Z'), visit('v2', '2026-09-09T10:00:00.000Z')],
      [a, b],
    );
    assertUniqueness(rows);
    expect(rows.map((row) => [row.intervention.deliveryId, row.returnVisit.id])).toEqual([
      ['B', 'v1'],
    ]);
  });

  it('A then Visit1 then B then Visit2 associates A->Visit1 and B->Visit2', () => {
    const a = message('A', '2026-09-01T10:00:00.000Z');
    const b = message('B', '2026-09-05T10:00:00.000Z');
    const rows = associateObservedReturns(
      [visit('v1', '2026-09-03T10:00:00.000Z'), visit('v2', '2026-09-08T10:00:00.000Z')],
      [a, b],
    );
    assertUniqueness(rows);
    expect(rows.map((row) => [row.intervention.deliveryId, row.returnVisit.id])).toEqual([
      ['A', 'v1'],
      ['B', 'v2'],
    ]);
  });

  it('A then Visit1 then Visit2 associates A -> Visit1 only', () => {
    const a = message('A', '2026-09-01T10:00:00.000Z');
    const rows = associateObservedReturns(
      [visit('v1', '2026-09-03T10:00:00.000Z'), visit('v2', '2026-09-08T10:00:00.000Z')],
      [a],
    );
    assertUniqueness(rows);
    expect(rows.map((row) => [row.intervention.deliveryId, row.returnVisit.id])).toEqual([
      ['A', 'v1'],
    ]);
  });

  it('breaks identical submittedAt with createdAt then deliveryId', () => {
    const earlyCreated = message('aaa', '2026-09-05T10:00:00.000Z', {
      createdAt: at('2026-09-05T09:00:00.000Z'),
    });
    const laterCreated = message('zzz', '2026-09-05T10:00:00.000Z', {
      createdAt: at('2026-09-05T11:00:00.000Z'),
    });
    expect(isLaterLastTouch(laterCreated, earlyCreated)).toBe(true);
    const rows = associateObservedReturns(
      [visit('v1', '2026-09-06T10:00:00.000Z')],
      [earlyCreated, laterCreated],
    );
    expect(rows[0]?.intervention.deliveryId).toBe('zzz');

    const lowId = message('aaa', '2026-09-05T10:00:00.000Z', {
      createdAt: at('2026-09-05T11:00:00.000Z'),
    });
    const highId = message('zzz', '2026-09-05T10:00:00.000Z', {
      createdAt: at('2026-09-05T11:00:00.000Z'),
    });
    const tied = associateObservedReturns([visit('v1', '2026-09-06T10:00:00.000Z')], [lowId, highId]);
    expect(tied[0]?.intervention.deliveryId).toBe('zzz');
  });

  it('breaks identical visitedAt with createdAt then id', () => {
    const a = message('A', '2026-09-01T10:00:00.000Z');
    const firstRecorded = visit('v-late-id', '2026-09-08T10:00:00.000Z', '2026-09-08T11:00:00.000Z');
    const earlierRecorded = visit('v-early-id', '2026-09-08T10:00:00.000Z', '2026-09-08T10:30:00.000Z');
    expect(compareVisitsAscending(earlierRecorded, firstRecorded)).toBeLessThan(0);
    const rows = associateObservedReturns([firstRecorded, earlierRecorded], [a]);
    expect(rows[0]?.returnVisit.id).toBe('v-early-id');
  });

  it('does not use sourceVisitId as the observed return', () => {
    const a = message('A', '2026-09-05T10:00:00.000Z', { sourceVisitId: 'source' });
    const rows = associateObservedReturns(
      [visit('source', '2026-09-06T10:00:00.000Z'), visit('later', '2026-09-07T10:00:00.000Z')],
      [a],
    );
    expect(lastTouchInterventionForVisit(visit('source', '2026-09-06T10:00:00.000Z'), [a])).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.returnVisit.id).toBe('later');
  });
});

describe('isEligibleCustomerMessageIntervention', () => {
  const sent = {
    requestCustomerId: 'c1',
    requestVipRequestId: null as string | null,
    deliveryCustomerId: 'c1',
    deliveryStatus: 'SENT',
    submittedAt: at('2026-09-05T10:00:00.000Z'),
  };

  it('accepts SENT customer messages for manual and opportunity origins', () => {
    expect(isEligibleCustomerMessageIntervention(sent)).toBe(true);
    expect(isEligibleCustomerMessageIntervention(sent, 'c1')).toBe(true);
    expect(interventionOriginFromRequest(null, null)).toBe('MANUAL');
    expect(interventionOriginFromRequest('a1', 'REACTIVATION')).toBe('OPPORTUNITY');
  });

  it('rejects VIP, mismatched customers, missing submittedAt, and non-SENT status', () => {
    expect(isEligibleCustomerMessageIntervention({ ...sent, requestVipRequestId: 'vip' })).toBe(false);
    expect(isEligibleCustomerMessageIntervention({ ...sent, requestCustomerId: null })).toBe(false);
    expect(isEligibleCustomerMessageIntervention({ ...sent, deliveryCustomerId: 'c2' })).toBe(false);
    expect(isEligibleCustomerMessageIntervention(sent, 'c2')).toBe(false);
    expect(isEligibleCustomerMessageIntervention({ ...sent, submittedAt: null })).toBe(false);
    expect(isEligibleCustomerMessageIntervention({ ...sent, deliveryStatus: 'QUEUED' })).toBe(false);
    expect(isEligibleCustomerMessageIntervention({ ...sent, deliveryStatus: 'FAILED' })).toBe(false);
  });
});

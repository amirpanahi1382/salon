/**
 * Observed (associated) retention outcomes. Not causal attribution.
 *
 * V1 intervention kind is MESSAGE only. Association uses interventionAt /
 * returnedAt timestamps. Duration fields, if added by a presentation layer,
 * are not part of association correctness.
 */
export const OBSERVED_ASSOCIATION_KIND = 'OBSERVED' as const;

export const OBSERVED_ASSOCIATION_RULE =
  'OBSERVED_LAST_TOUCH_SENT_SUBMITTED_AT_STRICT_LT_FIRST_VISIT_NO_MAX_WINDOW' as const;

export const COMMITMENT_BACKED_ASSOCIATION_KIND = 'COMMITMENT_BACKED' as const;

export const COMMITMENT_BACKED_ASSOCIATION_RULE =
  'COMMITMENT_BACKED_EXPLICIT_RETURN_COMMITMENT_ACTUAL_VISIT' as const;

export type ReturnEvidenceKind =
  | typeof COMMITMENT_BACKED_ASSOCIATION_KIND
  | typeof OBSERVED_ASSOCIATION_KIND;

export type VisitReturnEvidence = {
  visitId: string;
  kind: ReturnEvidenceKind;
};

function evidenceRank(kind: ReturnEvidenceKind): number {
  return kind === COMMITMENT_BACKED_ASSOCIATION_KIND ? 2 : 1;
}

/**
 * Future reporting helper: one Visit is one economic win.
 * COMMITMENT_BACKED outranks OBSERVED for the same visitId.
 * Does not mutate Phase 4A OBSERVED factual reads.
 */
export function classifyPreferredVisitEvidence(
  rows: readonly VisitReturnEvidence[],
): VisitReturnEvidence[] {
  const preferred = new Map<string, VisitReturnEvidence>();
  for (const row of rows) {
    const current = preferred.get(row.visitId);
    if (!current || evidenceRank(row.kind) > evidenceRank(current.kind)) {
      preferred.set(row.visitId, { visitId: row.visitId, kind: row.kind });
    }
  }
  return [...preferred.values()];
}

export const INTERVENTION_KIND_MESSAGE = 'MESSAGE' as const;

export const INTERVENTION_ORIGINS = ['OPPORTUNITY', 'MANUAL'] as const;
export type InterventionOrigin = (typeof INTERVENTION_ORIGINS)[number];

/** Facts needed to decide V1 message-intervention eligibility. Not an association. */
export type MessageInterventionEligibilityInput = {
  requestCustomerId: string | null;
  requestVipRequestId: string | null;
  deliveryCustomerId: string | null;
  deliveryStatus: string;
  submittedAt: Date | null;
};

/**
 * Eligible V1 customer message intervention: salon customer (non-VIP), SENT delivery,
 * submittedAt present, request/delivery customer ids match.
 */
export function isEligibleCustomerMessageIntervention(
  input: MessageInterventionEligibilityInput,
  expectedCustomerId?: string,
): boolean {
  if (input.requestVipRequestId) {
    return false;
  }
  if (!input.requestCustomerId || !input.deliveryCustomerId || !input.submittedAt) {
    return false;
  }
  if (input.deliveryCustomerId !== input.requestCustomerId) {
    return false;
  }
  if (expectedCustomerId && input.requestCustomerId !== expectedCustomerId) {
    return false;
  }
  return input.deliveryStatus === 'SENT';
}

export function interventionOriginFromRequest(
  actionId: string | null,
  opportunityType: string | null,
): InterventionOrigin {
  if (actionId && opportunityType) {
    return 'OPPORTUNITY';
  }
  return 'MANUAL';
}

export type EligibleMessageIntervention = {
  deliveryId: string;
  requestId: string;
  submittedAt: Date;
  createdAt: Date;
  requestedAt: Date;
  origin: InterventionOrigin;
  opportunityType: string | null;
  actionId: string | null;
  sourceVisitId: string | null;
};

export type CandidateVisit = {
  id: string;
  visitedAt: Date;
  createdAt: Date;
};

export type ObservedReturnAssociation = {
  intervention: EligibleMessageIntervention;
  returnVisit: CandidateVisit;
};

function visitOrderKey(visit: CandidateVisit): [number, number, string] {
  return [visit.visitedAt.getTime(), visit.createdAt.getTime(), visit.id];
}

export function compareVisitsAscending(a: CandidateVisit, b: CandidateVisit): number {
  const [aAt, aCreated, aId] = visitOrderKey(a);
  const [bAt, bCreated, bId] = visitOrderKey(b);
  if (aAt !== bAt) {
    return aAt < bAt ? -1 : 1;
  }
  if (aCreated !== bCreated) {
    return aCreated < bCreated ? -1 : 1;
  }
  if (aId === bId) {
    return 0;
  }
  return aId < bId ? -1 : 1;
}

export function compareVisitsDescending(a: CandidateVisit, b: CandidateVisit): number {
  return compareVisitsAscending(b, a);
}

/** Later last-touch wins: submittedAt DESC, createdAt DESC, deliveryId DESC. */
export function isLaterLastTouch(
  candidate: EligibleMessageIntervention,
  incumbent: EligibleMessageIntervention,
): boolean {
  const submittedDelta = candidate.submittedAt.getTime() - incumbent.submittedAt.getTime();
  if (submittedDelta !== 0) {
    return submittedDelta > 0;
  }
  const createdDelta = candidate.createdAt.getTime() - incumbent.createdAt.getTime();
  if (createdDelta !== 0) {
    return createdDelta > 0;
  }
  return candidate.deliveryId > incumbent.deliveryId;
}

export function lastTouchInterventionForVisit(
  visit: CandidateVisit,
  interventions: readonly EligibleMessageIntervention[],
): EligibleMessageIntervention | null {
  let best: EligibleMessageIntervention | null = null;
  for (const intervention of interventions) {
    if (intervention.submittedAt.getTime() >= visit.visitedAt.getTime()) {
      continue;
    }
    if (intervention.sourceVisitId === visit.id) {
      continue;
    }
    if (!best || isLaterLastTouch(intervention, best)) {
      best = intervention;
    }
  }
  return best;
}

/**
 * Visit-centric last-touch, then first unclaimed return.
 *
 * Invariants:
 * - Each visit is considered once → at most one intervention per return visit.
 * - Each deliveryId is claimed at most once → at most one return per intervention.
 * - Chronological visit order means the first visit that last-touches I is the
 *   first qualifying return for I (later visits that last-touch the same I skip).
 */
export function associateObservedReturns(
  visits: readonly CandidateVisit[],
  interventions: readonly EligibleMessageIntervention[],
): ObservedReturnAssociation[] {
  const claimedDeliveryIds = new Set<string>();
  const associations: ObservedReturnAssociation[] = [];

  for (const visit of [...visits].sort(compareVisitsAscending)) {
    const lastTouch = lastTouchInterventionForVisit(visit, interventions);
    if (!lastTouch) {
      continue;
    }
    if (claimedDeliveryIds.has(lastTouch.deliveryId)) {
      continue;
    }
    claimedDeliveryIds.add(lastTouch.deliveryId);
    associations.push({ intervention: lastTouch, returnVisit: visit });
  }

  return associations;
}

export function isOlderVisitThanCursor(
  visit: CandidateVisit,
  cursor: CandidateVisit,
): boolean {
  return compareVisitsDescending(visit, cursor) > 0;
}

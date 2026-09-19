/**
 * Operational follow-up vs explicit ReturnCommitment attribution.
 *
 * These are different questions:
 * - Operational: should the salon still treat this customer as agreed-to-return
 *   but not yet recorded as having returned after the source outreach?
 * - Attribution: do we have explicit evidence that this Visit fulfilled this
 *   ReturnCommitment? That is only `actualVisitId` (arrive / link-visit).
 *
 * A later authoritative Visit can settle operational follow-up without writing
 * `actualVisitId` and without becoming COMMITMENT_BACKED.
 *
 * Chronology uses MessageDelivery.submittedAt, not ReturnCommitment.createdAt
 * or expectedAt. Equality does not count: visitedAt must be strictly later.
 */
export function visitQualifiesAsOperationalReturnEvidence(input: {
  sourceSubmittedAt: Date | null;
  visitVisitedAt: Date;
}): boolean {
  if (input.sourceSubmittedAt == null) {
    return false;
  }
  return input.visitVisitedAt.getTime() > input.sourceSubmittedAt.getTime();
}

export function isOperationallyOpenReturnCommitment(input: {
  actualVisitId: string | null;
  sourceSubmittedAt: Date | null;
  visits: readonly { visitedAt: Date }[];
}): boolean {
  if (input.actualVisitId != null) {
    return false;
  }
  return !input.visits.some((visit) =>
    visitQualifiesAsOperationalReturnEvidence({
      sourceSubmittedAt: input.sourceSubmittedAt,
      visitVisitedAt: visit.visitedAt,
    }),
  );
}

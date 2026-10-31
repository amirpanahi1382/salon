/**
 * Independent population for «وقت توافق‌شده».
 *
 * A recorded intention counts whether or not a date or time was supplied.
 * ReturnCommitment and VisitIntention do not share an agreement id.
 * Matching customer, phone, name, time, or source message does not merge them.
 * These functions therefore add the qualifying rows and do not collapse them.
 */

export type CommitmentFact = {
  id: string;
  customerId: string;
  sourceMessageRequestId: string;
  /** Set only by arrive or link-visit. */
  actualVisitId: string | null;
  /** True when a later Visit settles follow-up without actualVisitId. */
  operationallySettled: boolean;
  createdBy: 'SALON_USER' | 'PLATFORM_ADMIN';
};

export type IntentionFact = {
  id: string;
  subject: 'CUSTOMER' | 'VIP_PROSPECT';
  customerId: string | null;
  sourceMessageRequestId: string | null;
  timePrecision: 'UNKNOWN' | 'DATE' | 'INSTANT';
  linkedVisitId: string | null;
  createdBy: 'SALON_USER' | 'PLATFORM_ADMIN';
};

/** Operationally open commitments. Author and expected time do not exclude a row. */
export function openReturnCommitments(rows: readonly CommitmentFact[]): CommitmentFact[] {
  return rows.filter((row) => row.actualVisitId == null && !row.operationallySettled);
}

/** Intentions with no explicit Visit link. Unknown time stays included. */
export function openVisitIntentions(rows: readonly IntentionFact[]): IntentionFact[] {
  return rows.filter((row) => row.linkedVisitId == null);
}

/**
 * Dashboard population. The two models stay separate even when a customer
 * or a source message appears in both lists.
 */
export function agreedOperationalCount(
  commitments: readonly CommitmentFact[],
  intentions: readonly IntentionFact[],
): number {
  return openReturnCommitments(commitments).length + openVisitIntentions(intentions).length;
}

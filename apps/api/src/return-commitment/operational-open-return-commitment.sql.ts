import { Prisma } from '@salon/database';

/**
 * SQL predicate for an OPERATIONALLY OPEN ReturnCommitment.
 *
 * Requires aliases:
 * - `rc` → return_commitments
 * - `md` → message_deliveries for rc.source_message_delivery_id (same salon)
 *
 * Not the same as `rc.actual_visit_id IS NULL`. A later Visit for the same
 * salon+customer with visited_at > md.submitted_at settles follow-up without
 * writing actual_visit_id.
 */
export const operationallyOpenReturnCommitmentSql = Prisma.sql`
  rc.actual_visit_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM visits v
    WHERE v.salon_id = rc.salon_id
      AND v.customer_id = rc.customer_id
      AND md.submitted_at IS NOT NULL
      AND v.visited_at > md.submitted_at
  )
`;

/**
 * A VisitIntention stays operational until an explicit Visit link.
 * There is no cancelled status. UNKNOWN, DATE, and INSTANT all qualify.
 * The alias must be `vi`. Subject and tenant filters stay with the caller.
 * A ReturnCommitment is not the same row and is not subtracted here.
 */
export const openVisitIntentionSql = Prisma.sql`vi.linked_visit_id IS NULL`;

/** Inverse of operational openness for unlinked rows (attribution still null). */
export const operationallySettledUnlinkedReturnCommitmentSql = Prisma.sql`
  rc.actual_visit_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM visits v
    WHERE v.salon_id = rc.salon_id
      AND v.customer_id = rc.customer_id
      AND md.submitted_at IS NOT NULL
      AND v.visited_at > md.submitted_at
  )
`;

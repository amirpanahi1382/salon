import { Prisma } from '@salon/database';

/** Eligible V1 customer SENT deliveries. Canonical non-VIP customer-bound intervention set. */
export function eligibleCustomerSentDeliverySql(tenantId: string) {
  return Prisma.sql`
  SELECT
    d.id AS delivery_id,
    d.created_at AS delivery_created_at,
    d.submitted_at,
    d.customer_id,
    r.id AS request_id,
    r.requested_at,
    r.action_id,
    r.opportunity_type,
    a.source_visit_id
  FROM message_deliveries d
  INNER JOIN message_requests r
    ON r.id = d.message_request_id AND r.salon_id = d.salon_id
  LEFT JOIN opportunity_actions a
    ON a.id = r.action_id AND a.salon_id = r.salon_id
  WHERE d.salon_id = ${tenantId}::uuid
    AND d.status = 'SENT'::"MessageDeliveryStatus"
    AND d.submitted_at IS NOT NULL
    AND r.vip_request_id IS NULL
    AND r.customer_id IS NOT NULL
    AND d.customer_id IS NOT NULL
    AND d.customer_id = r.customer_id
`;
}

/** Requires aliases c (commitment), d (delivery), and r (request), all joined in one salon. */
export const validCommitmentSourceSql = Prisma.sql`
  d.message_request_id = r.id
  AND c.customer_id = r.customer_id
  AND c.customer_id = d.customer_id
  AND r.vip_request_id IS NULL
  AND d.status = 'SENT'::"MessageDeliveryStatus"
  AND d.submitted_at IS NOT NULL
`;

/** Raw last-touch / first-claim selection, then effective COMMITMENT_BACKED visit precedence. */
export function observedReturnCtes(tenantId: string) {
  return Prisma.sql`
  eligible AS (
    ${eligibleCustomerSentDeliverySql(tenantId)}
  ),
  last_touch AS (
    SELECT DISTINCT ON (v.id)
      v.id AS visit_id,
      v.created_at AS visit_created_at,
      v.visited_at,
      v.customer_id,
      e.delivery_id,
      e.request_id,
      e.submitted_at,
      e.action_id,
      e.opportunity_type
    FROM visits v
    INNER JOIN eligible e
      ON e.customer_id = v.customer_id
     AND e.submitted_at < v.visited_at
     AND (e.source_visit_id IS NULL OR e.source_visit_id <> v.id)
    WHERE v.salon_id = ${tenantId}::uuid
    ORDER BY v.id, e.submitted_at DESC, e.delivery_created_at DESC, e.delivery_id DESC
  ),
  claimed AS (
    SELECT
      last_touch.*,
      ROW_NUMBER() OVER (
        PARTITION BY delivery_id
        ORDER BY visited_at ASC, visit_created_at ASC, visit_id ASC
      ) AS claim_rank
    FROM last_touch
  ),
  observed AS (
    SELECT
      visit_id,
      visit_created_at,
      visited_at,
      customer_id,
      delivery_id,
      request_id,
      submitted_at,
      action_id,
      opportunity_type
    FROM claimed
    WHERE claim_rank = 1
      AND NOT EXISTS (
        SELECT 1
        FROM return_commitments c
        INNER JOIN message_deliveries d
          ON d.id = c.source_message_delivery_id
         AND d.salon_id = c.salon_id
        INNER JOIN message_requests r
          ON r.id = c.source_message_request_id
         AND r.salon_id = c.salon_id
        WHERE c.salon_id = ${tenantId}::uuid
          AND c.actual_visit_id = claimed.visit_id
          AND c.customer_id = claimed.customer_id
          AND ${validCommitmentSourceSql}
      )
  )
`;
}

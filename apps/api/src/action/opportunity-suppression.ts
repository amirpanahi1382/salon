import { Prisma, type OpportunityActionType } from '@salon/database';

type SqlClient = {
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
};

export function suppressedOpportunityKey(customerId: string, type: string): string {
  return `${customerId}:${type}`;
}

export async function findLastVisitId(
  db: SqlClient,
  tenantId: string,
  customerId: string,
): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM visits
    WHERE salon_id = ${tenantId}::uuid AND customer_id = ${customerId}::uuid
    ORDER BY visited_at DESC, created_at DESC, id DESC
    LIMIT 1
  `);
  return rows[0]?.id ?? null;
}

export async function loadSuppressedOpportunityKeys(
  db: SqlClient,
  tenantId: string,
): Promise<Set<string>> {
  const rows = await db.$queryRaw<Array<{ customerId: string; opportunityType: string }>>(Prisma.sql`
    WITH last_visits AS (
      SELECT DISTINCT ON (customer_id) customer_id, id
      FROM visits
      WHERE salon_id = ${tenantId}::uuid
      ORDER BY customer_id, visited_at DESC, created_at DESC, id DESC
    )
    SELECT a.customer_id AS "customerId", a.opportunity_type::text AS "opportunityType"
    FROM opportunity_actions a
    LEFT JOIN last_visits lv ON lv.customer_id = a.customer_id
    WHERE a.salon_id = ${tenantId}::uuid
      AND a.status IN ('COMPLETED'::"OpportunityActionStatus", 'DISMISSED'::"OpportunityActionStatus")
      AND a.source_visit_id IS NOT DISTINCT FROM lv.id
  `);
  return new Set(
    rows.map((row) => suppressedOpportunityKey(row.customerId, row.opportunityType)),
  );
}

export async function isOpportunitySuppressed(
  db: SqlClient,
  tenantId: string,
  customerId: string,
  type: OpportunityActionType,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ present: number }>>(Prisma.sql`
    WITH last_visit AS (
      SELECT id
      FROM visits
      WHERE salon_id = ${tenantId}::uuid AND customer_id = ${customerId}::uuid
      ORDER BY visited_at DESC, created_at DESC, id DESC
      LIMIT 1
    )
    SELECT 1 AS present
    FROM opportunity_actions a
    LEFT JOIN last_visit lv ON true
    WHERE a.salon_id = ${tenantId}::uuid
      AND a.customer_id = ${customerId}::uuid
      AND a.opportunity_type = CAST(${type} AS "OpportunityActionType")
      AND a.status IN ('COMPLETED'::"OpportunityActionStatus", 'DISMISSED'::"OpportunityActionStatus")
      AND a.source_visit_id IS NOT DISTINCT FROM lv.id
    LIMIT 1
  `);
  return rows.length > 0;
}

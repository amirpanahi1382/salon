import { Prisma, type PrismaClient } from '@salon/database';
import {
  DEFAULT_EXPECTED_RETURN_DAYS,
  wholeDaysBetween,
  type CustomerBehavior,
} from '@salon/shared';
import type { CustomerIdentity } from './intelligence.mapper';

export const INTELLIGENCE_SCAN_BATCH_SIZE = 500;

export type SalonBehaviorRow = {
  customer: CustomerIdentity;
  behavior: CustomerBehavior;
};

type AggregateRow = {
  id: string;
  firstName: string;
  lastName: string;
  visitCount: number;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  averageReturnIntervalDays: number | null;
};

export function behaviorFromAggregate(
  row: {
    visitCount: number;
    firstVisitAt: Date | null;
    lastVisitAt: Date | null;
    averageReturnIntervalDays: number | null;
  },
  asOf: Date,
): CustomerBehavior {
  const visitCount = Number(row.visitCount);
  return {
    visitCount,
    firstVisitAt: row.firstVisitAt,
    lastVisitAt: row.lastVisitAt,
    daysSinceLastVisit: row.lastVisitAt ? wholeDaysBetween(row.lastVisitAt, asOf) : null,
    averageReturnIntervalDays: row.averageReturnIntervalDays,
    expectedReturnIntervalDays: row.averageReturnIntervalDays ?? DEFAULT_EXPECTED_RETURN_DAYS,
  };
}

type CreatedCursor = { createdAt: Date; id: string };
type RankCursor = { days: number; id: string; inclusive?: boolean };

type MetricRow = {
  customerId: string;
  visitCount: number;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  averageReturnIntervalDays: number | null;
};

/** Summary traversal follows the indexed customer creation order, not a result rank. */
export async function loadSalonBehaviorChunk(
  prisma: PrismaClient,
  tenantId: string,
  asOf: Date,
  after?: CreatedCursor,
): Promise<{ rows: SalonBehaviorRow[]; next: CreatedCursor | undefined }> {
  const customers = await prisma.customer.findMany({
    where: {
      salonId: tenantId,
      ...(after ? { OR: [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, id: { lt: after.id } },
      ] } : {}),
    },
    select: { id: true, firstName: true, lastName: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: INTELLIGENCE_SCAN_BATCH_SIZE,
  });
  if (customers.length === 0) return { rows: [], next: undefined };
  const ids = customers.map((customer) => customer.id);

  const metrics = await prisma.$queryRaw<MetricRow[]>(Prisma.sql`
    SELECT
      customer_id AS "customerId",
      COUNT(*)::int AS "visitCount",
      MIN(visited_at) AS "firstVisitAt",
      MAX(visited_at) AS "lastVisitAt",
      CASE
        WHEN COUNT(*) FILTER (WHERE gap_days > 0) = 0 THEN NULL
        ELSE GREATEST(1, ROUND((AVG(gap_days) FILTER (WHERE gap_days > 0))::numeric))::int
      END AS "averageReturnIntervalDays"
    FROM (
      SELECT
        customer_id,
        visited_at,
        FLOOR(
          EXTRACT(EPOCH FROM (
            visited_at - LAG(visited_at) OVER (
              PARTITION BY customer_id
              ORDER BY visited_at ASC, id ASC
            )
          )) / 86400
        ) AS gap_days
      FROM visits
      WHERE salon_id = ${tenantId}::uuid
        AND customer_id = ANY(ARRAY[${Prisma.join(ids)}]::uuid[])
    ) gaps
    GROUP BY customer_id
  `);

  const byCustomer = new Map(metrics.map((row) => [row.customerId, row]));
  return {
    next: { createdAt: customers.at(-1)!.createdAt, id: customers.at(-1)!.id },
    rows: customers.map((customer) => {
      const metric = byCustomer.get(customer.id);
      return {
        customer,
        behavior: behaviorFromAggregate(
          {
            visitCount: metric?.visitCount ?? 0,
            firstVisitAt: metric?.firstVisitAt ?? null,
            lastVisitAt: metric?.lastVisitAt ?? null,
            averageReturnIntervalDays: metric?.averageReturnIntervalDays ?? null,
          },
          asOf,
        ),
      };
    }),
  };
}

type RankedAggregateRow = AggregateRow & { rankDays: number };

/** SQL ranks the full tenant population; only one bounded batch crosses into Node. */
export async function loadRankedSalonBehaviorChunk(
  prisma: PrismaClient,
  tenantId: string,
  asOf: Date,
  noVisitRank: -1 | 0,
  after?: RankCursor,
): Promise<Array<SalonBehaviorRow & { rankDays: number }>> {
  const rows = await prisma.$queryRaw<RankedAggregateRow[]>(Prisma.sql`
    WITH last_visits AS (
      SELECT customer_id, MAX(visited_at) AS last_visit_at
      FROM visits
      WHERE salon_id = ${tenantId}::uuid
      GROUP BY customer_id
    ), ranked AS (
      SELECT c.id, c.first_name AS "firstName", c.last_name AS "lastName",
        CASE WHEN lv.last_visit_at IS NULL THEN ${noVisitRank}::int
          ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
            ${asOf}::timestamptz - lv.last_visit_at
          )) / 86400))::int END AS "rankDays"
      FROM customers c
      LEFT JOIN last_visits lv ON lv.customer_id = c.id
      WHERE c.salon_id = ${tenantId}::uuid
    ), selected AS MATERIALIZED (
      SELECT * FROM ranked
      WHERE true
        ${after ? Prisma.sql`AND (
          "rankDays" < ${after.days}::int OR
          ("rankDays" = ${after.days}::int AND id ${after.inclusive ? Prisma.sql`<=` : Prisma.sql`<`} ${after.id}::uuid)
        )` : Prisma.empty}
      ORDER BY "rankDays" DESC, id DESC
      LIMIT ${INTELLIGENCE_SCAN_BATCH_SIZE}
    ), gaps AS (
      SELECT v.customer_id, v.visited_at,
        FLOOR(EXTRACT(EPOCH FROM (
          v.visited_at - LAG(v.visited_at) OVER (
            PARTITION BY v.customer_id ORDER BY v.visited_at ASC, v.id ASC
          )
        )) / 86400) AS gap_days
      FROM visits v
      INNER JOIN selected s ON s.id = v.customer_id
      WHERE v.salon_id = ${tenantId}::uuid
    ), metrics AS (
      SELECT customer_id, COUNT(*)::int AS visit_count,
        MIN(visited_at) AS first_visit_at,
        MAX(visited_at) AS last_visit_at,
        CASE WHEN COUNT(*) FILTER (WHERE gap_days > 0) = 0 THEN NULL
          ELSE GREATEST(1, ROUND((AVG(gap_days) FILTER (WHERE gap_days > 0))::numeric))::int
        END AS average_return_interval_days
      FROM gaps GROUP BY customer_id
    )
    SELECT s.id, s."firstName", s."lastName", s."rankDays",
      COALESCE(m.visit_count, 0)::int AS "visitCount",
      m.first_visit_at AS "firstVisitAt", m.last_visit_at AS "lastVisitAt",
      m.average_return_interval_days AS "averageReturnIntervalDays"
    FROM selected s
    LEFT JOIN metrics m ON m.customer_id = s.id
    ORDER BY s."rankDays" DESC, s.id DESC
  `);
  return rows.map((row) => ({
    customer: { id: row.id, firstName: row.firstName, lastName: row.lastName },
    behavior: behaviorFromAggregate(row, asOf),
    rankDays: Number(row.rankDays),
  }));
}

export async function loadCustomerBehaviorRow(
  prisma: PrismaClient,
  tenantId: string,
  customerId: string,
  asOf: Date,
): Promise<SalonBehaviorRow | null> {
  const rows = await prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
    WITH selected AS (
      SELECT id, first_name, last_name
      FROM customers
      WHERE salon_id = ${tenantId}::uuid AND id = ${customerId}::uuid
    ),
    metrics AS (
      SELECT
        customer_id,
        COUNT(*)::int AS visit_count,
        MIN(visited_at) AS first_visit_at,
        MAX(visited_at) AS last_visit_at,
        CASE
          WHEN COUNT(*) FILTER (WHERE gap_days > 0) = 0 THEN NULL
          ELSE GREATEST(1, ROUND((AVG(gap_days) FILTER (WHERE gap_days > 0))::numeric))::int
        END AS average_return_interval_days
      FROM (
        SELECT
          v.customer_id,
          v.visited_at,
          FLOOR(
            EXTRACT(EPOCH FROM (
              v.visited_at - LAG(v.visited_at) OVER (
                PARTITION BY v.customer_id
                ORDER BY v.visited_at ASC, v.id ASC
              )
            )) / 86400
          ) AS gap_days
        FROM visits v
        INNER JOIN selected c ON c.id = v.customer_id
        WHERE v.salon_id = ${tenantId}::uuid
      ) gaps
      GROUP BY customer_id
    )
    SELECT
      c.id,
      c.first_name AS "firstName",
      c.last_name AS "lastName",
      COALESCE(m.visit_count, 0)::int AS "visitCount",
      m.first_visit_at AS "firstVisitAt",
      m.last_visit_at AS "lastVisitAt",
      m.average_return_interval_days AS "averageReturnIntervalDays"
    FROM selected c
    LEFT JOIN metrics m ON m.customer_id = c.id
  `);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    customer: { id: row.id, firstName: row.firstName, lastName: row.lastName },
    behavior: behaviorFromAggregate(row, asOf),
  };
}

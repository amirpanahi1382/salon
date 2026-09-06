import { Prisma, type PrismaClient } from '@salon/database';
import {
  DEFAULT_EXPECTED_RETURN_DAYS,
  wholeDaysBetween,
  type CustomerBehavior,
} from '@salon/shared';
import { INTELLIGENCE_CUSTOMER_CAP } from '../customer/customer.repository';
import type { CustomerIdentity } from './intelligence.mapper';

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

export async function loadSalonBehaviorRows(
  prisma: PrismaClient,
  tenantId: string,
  asOf: Date,
): Promise<{ truncated: boolean; rows: SalonBehaviorRow[] }> {
  const customers = await prisma.customer.findMany({
    where: { salonId: tenantId },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: INTELLIGENCE_CUSTOMER_CAP + 1,
  });
  const truncated = customers.length > INTELLIGENCE_CUSTOMER_CAP;
  const selected = truncated ? customers.slice(0, INTELLIGENCE_CUSTOMER_CAP) : customers;

  type MetricRow = {
    customerId: string;
    visitCount: number;
    firstVisitAt: Date | null;
    lastVisitAt: Date | null;
    averageReturnIntervalDays: number | null;
  };

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
    ) gaps
    GROUP BY customer_id
  `);

  const byCustomer = new Map(metrics.map((row) => [row.customerId, row]));
  return {
    truncated,
    rows: selected.map((customer) => {
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

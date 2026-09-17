import { Prisma } from '@salon/database';
import {
  COMMITMENT_BACKED_ASSOCIATION_KIND,
  COMMITMENT_BACKED_ASSOCIATION_RULE,
  INTERVENTION_KIND_MESSAGE,
  OBSERVED_ASSOCIATION_KIND,
  OBSERVED_ASSOCIATION_RULE,
  interventionOriginFromRequest,
  parseMoneyString,
  type InterventionOrigin,
  type OwnerBusinessWeek,
} from '@salon/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { toAssociatedRevenue } from '../return-commitment/return-commitment.mapper';
import type { AssociatedRevenueDto } from '../observed-outcome/observed-outcome.dto';
import type { RecoveryOutcomeReturnItemDto } from './recovery-outcomes.dto';

export const RECOVERY_OUTCOME_RETURN_LIST_LIMIT = 50;

type CountRow = { count: number };
type LatencyRow = { sentCount: number; medianMs: number | null };
type MoneyRow = {
  visitCount: number;
  completedCount: number;
  total: string | null;
};
type OutcomeVisitRow = {
  visitId: string;
  visitedAt: Date;
  visitCreatedAt: Date;
  customerId: string;
  firstName: string;
  lastName: string;
  expectedAt: Date | null;
  commitmentId: string | null;
  submittedAt: Date;
  requestId: string;
  deliveryId: string;
  actionId: string | null;
  opportunityType: string | null;
  amount: string | null;
  completedCount: number;
};

const eligibleDeliverySql = (tenantId: string) => Prisma.sql`
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

const observedCtes = (tenantId: string) => Prisma.sql`
  eligible AS (
    ${eligibleDeliverySql(tenantId)}
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
      AND NOT EXISTS (
        SELECT 1
        FROM return_commitments claimed_visit
        WHERE claimed_visit.salon_id = ${tenantId}::uuid
          AND claimed_visit.actual_visit_id = v.id
      )
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
  )
`

@Injectable()
export class RecoveryOutcomesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countSentFollowUps(tenantId: string, week: OwnerBusinessWeek): Promise<LatencyRow> {
    const rows = await this.prisma.client.$queryRaw<LatencyRow[]>(Prisma.sql`
      WITH eligible AS (
        ${eligibleDeliverySql(tenantId)}
      )
      SELECT
        COUNT(*)::int AS "sentCount",
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (submitted_at - requested_at)) * 1000
        ) AS "medianMs"
      FROM eligible
      WHERE submitted_at >= ${week.start} AND submitted_at < ${week.end}
    `);
    const row = rows[0];
    return {
      sentCount: Number(row?.sentCount ?? 0),
      medianMs: row?.medianMs == null ? null : Math.round(Number(row.medianMs)),
    };
  }

  async countReturnCommitmentsRecorded(tenantId: string, week: OwnerBusinessWeek): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM return_commitments
      WHERE salon_id = ${tenantId}::uuid
        AND created_at >= ${week.start}
        AND created_at < ${week.end}
    `);
    return Number(rows[0]?.count ?? 0);
  }

  async commitmentBackedRevenue(tenantId: string, week: OwnerBusinessWeek): Promise<{
    visitCount: number;
    revenue: AssociatedRevenueDto;
  }> {
    const rows = await this.prisma.client.$queryRaw<MoneyRow[]>(Prisma.sql`
      WITH eligible_visits AS (
        SELECT DISTINCT v.id AS visit_id, v.customer_id
        FROM return_commitments c
        INNER JOIN visits v
          ON v.id = c.actual_visit_id AND v.salon_id = c.salon_id
        INNER JOIN message_deliveries d
          ON d.id = c.source_message_delivery_id AND d.salon_id = c.salon_id
        WHERE c.salon_id = ${tenantId}::uuid
          AND c.actual_visit_id IS NOT NULL
          AND d.submitted_at IS NOT NULL
          AND v.visited_at >= ${week.start}
          AND v.visited_at < ${week.end}
          AND v.visited_at > d.submitted_at
      )
      SELECT
        (SELECT COUNT(*)::int FROM eligible_visits) AS "visitCount",
        COUNT(*) FILTER (WHERE t.status = 'COMPLETED'::"TransactionStatus")::int AS "completedCount",
        COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'COMPLETED'::"TransactionStatus"), 0)::numeric(19,2)::text AS total
      FROM eligible_visits ev
      LEFT JOIN transactions t
        ON t.salon_id = ${tenantId}::uuid
       AND t.visit_id = ev.visit_id
       AND t.customer_id = ev.customer_id
    `);
    const row = rows[0];
    const visitCount = Number(row?.visitCount ?? 0);
    const completedCount = Number(row?.completedCount ?? 0);
    if (completedCount < 1) {
      return {
        visitCount,
        revenue: toAssociatedRevenue(undefined),
      };
    }
    return {
      visitCount,
      revenue: toAssociatedRevenue(parseMoneyString(row?.total ?? '0.00')),
    };
  }

  async countObservedOnlyReturns(tenantId: string, week: OwnerBusinessWeek): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<CountRow[]>(Prisma.sql`
      WITH ${observedCtes(tenantId)}
      SELECT COUNT(*)::int AS count
      FROM observed o
      WHERE o.visited_at >= ${week.start}
        AND o.visited_at < ${week.end}
        AND NOT EXISTS (
          SELECT 1
          FROM return_commitments c
          WHERE c.salon_id = ${tenantId}::uuid
            AND c.actual_visit_id = o.visit_id
        )
    `);
    return Number(rows[0]?.count ?? 0);
  }

  async listCommitmentBackedReturns(
    tenantId: string,
    week: OwnerBusinessWeek,
    cursor?: { visitedAt: Date; visitId: string },
  ): Promise<RecoveryOutcomeReturnItemDto[]> {
    const cursorFilter = cursor
      ? Prisma.sql`AND (
          v.visited_at < ${cursor.visitedAt}
          OR (v.visited_at = ${cursor.visitedAt} AND v.id < ${cursor.visitId}::uuid)
        )`
      : Prisma.empty;
    const rows = await this.prisma.client.$queryRaw<OutcomeVisitRow[]>(Prisma.sql`
      SELECT
        v.id AS "visitId",
        v.visited_at AS "visitedAt",
        v.created_at AS "visitCreatedAt",
        v.customer_id AS "customerId",
        cust.first_name AS "firstName",
        cust.last_name AS "lastName",
        c.expected_at AS "expectedAt",
        c.id AS "commitmentId",
        d.submitted_at AS "submittedAt",
        c.source_message_request_id AS "requestId",
        c.source_message_delivery_id AS "deliveryId",
        r.action_id AS "actionId",
        r.opportunity_type::text AS "opportunityType",
        COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'COMPLETED'::"TransactionStatus"), 0)::numeric(19,2)::text AS amount,
        COUNT(*) FILTER (WHERE t.status = 'COMPLETED'::"TransactionStatus")::int AS "completedCount"
      FROM return_commitments c
      INNER JOIN visits v
        ON v.id = c.actual_visit_id AND v.salon_id = c.salon_id
      INNER JOIN customers cust
        ON cust.id = v.customer_id AND cust.salon_id = v.salon_id
      INNER JOIN message_deliveries d
        ON d.id = c.source_message_delivery_id AND d.salon_id = c.salon_id
      INNER JOIN message_requests r
        ON r.id = c.source_message_request_id AND r.salon_id = c.salon_id
      LEFT JOIN transactions t
        ON t.salon_id = ${tenantId}::uuid
       AND t.visit_id = v.id
       AND t.customer_id = v.customer_id
      WHERE c.salon_id = ${tenantId}::uuid
        AND c.actual_visit_id IS NOT NULL
        AND d.submitted_at IS NOT NULL
        AND v.visited_at >= ${week.start}
        AND v.visited_at < ${week.end}
        AND v.visited_at > d.submitted_at
        ${cursorFilter}
      GROUP BY
        v.id, v.visited_at, v.created_at, v.customer_id, cust.first_name, cust.last_name,
        c.expected_at, c.id, d.submitted_at, c.source_message_request_id,
        c.source_message_delivery_id, r.action_id, r.opportunity_type
      ORDER BY v.visited_at DESC, v.id DESC
      LIMIT ${RECOVERY_OUTCOME_RETURN_LIST_LIMIT + 1}
    `);
    return rows.map((row) => this.toItem(row, COMMITMENT_BACKED_ASSOCIATION_KIND));
  }

  async listObservedOnlyReturns(
    tenantId: string,
    week: OwnerBusinessWeek,
    cursor?: { visitedAt: Date; visitId: string },
  ): Promise<RecoveryOutcomeReturnItemDto[]> {
    const cursorFilter = cursor
      ? Prisma.sql`AND (
          o.visited_at < ${cursor.visitedAt}
          OR (o.visited_at = ${cursor.visitedAt} AND o.visit_id < ${cursor.visitId}::uuid)
        )`
      : Prisma.empty;
    const rows = await this.prisma.client.$queryRaw<OutcomeVisitRow[]>(Prisma.sql`
      WITH ${observedCtes(tenantId)}
      SELECT
        o.visit_id AS "visitId",
        o.visited_at AS "visitedAt",
        o.visit_created_at AS "visitCreatedAt",
        o.customer_id AS "customerId",
        cust.first_name AS "firstName",
        cust.last_name AS "lastName",
        NULL::timestamptz AS "expectedAt",
        NULL::uuid AS "commitmentId",
        o.submitted_at AS "submittedAt",
        o.request_id AS "requestId",
        o.delivery_id AS "deliveryId",
        o.action_id AS "actionId",
        o.opportunity_type::text AS "opportunityType",
        COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'COMPLETED'::"TransactionStatus"), 0)::numeric(19,2)::text AS amount,
        COUNT(*) FILTER (WHERE t.status = 'COMPLETED'::"TransactionStatus")::int AS "completedCount"
      FROM observed o
      INNER JOIN customers cust
        ON cust.id = o.customer_id AND cust.salon_id = ${tenantId}::uuid
      LEFT JOIN transactions t
        ON t.salon_id = ${tenantId}::uuid
       AND t.visit_id = o.visit_id
       AND t.customer_id = o.customer_id
      WHERE o.visited_at >= ${week.start}
        AND o.visited_at < ${week.end}
        AND NOT EXISTS (
          SELECT 1
          FROM return_commitments c
          WHERE c.salon_id = ${tenantId}::uuid
            AND c.actual_visit_id = o.visit_id
        )
        ${cursorFilter}
      GROUP BY
        o.visit_id, o.visited_at, o.visit_created_at, o.customer_id, cust.first_name, cust.last_name,
        o.submitted_at, o.request_id, o.delivery_id, o.action_id, o.opportunity_type
      ORDER BY o.visited_at DESC, o.visit_id DESC
      LIMIT ${RECOVERY_OUTCOME_RETURN_LIST_LIMIT + 1}
    `);
    return rows.map((row) => this.toItem(row, OBSERVED_ASSOCIATION_KIND));
  }

  private toItem(
    row: OutcomeVisitRow,
    kind: typeof COMMITMENT_BACKED_ASSOCIATION_KIND | typeof OBSERVED_ASSOCIATION_KIND,
  ): RecoveryOutcomeReturnItemDto {
    const origin: InterventionOrigin = interventionOriginFromRequest(row.actionId, row.opportunityType);
    const revenue =
      Number(row.completedCount) < 1
        ? toAssociatedRevenue(undefined)
        : toAssociatedRevenue(parseMoneyString(row.amount ?? '0.00'));
    return {
      associationKind: kind,
      associationRule:
        kind === COMMITMENT_BACKED_ASSOCIATION_KIND
          ? COMMITMENT_BACKED_ASSOCIATION_RULE
          : OBSERVED_ASSOCIATION_RULE,
      customer: {
        id: row.customerId,
        name: `${row.firstName} ${row.lastName}`.trim(),
      },
      visitId: row.visitId,
      visitedAt: row.visitedAt.toISOString(),
      expectedAt: row.expectedAt ? row.expectedAt.toISOString() : null,
      commitmentId: row.commitmentId,
      interventionKind: INTERVENTION_KIND_MESSAGE,
      interventionOrigin: origin,
      submittedAt: row.submittedAt.toISOString(),
      associatedRevenue: revenue,
    };
  }
}

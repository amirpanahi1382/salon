import { Prisma } from '@salon/database';
import { Injectable } from '@nestjs/common';
import type { ComparableJalaliMonthWindows, OpportunityWorkspaceFilter } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { observedReturnCtes } from '../recovery-outcomes/eligible-message-evidence.sql';

export const OPPORTUNITY_WORKSPACE_LIMIT = 50;

export type OpportunityWorkspaceSqlRow = {
  rowKind: 'SALON_CUSTOMER' | 'VIP_RECIPIENT';
  stableSubject: string;
  customerId: string | null;
  displayName: string;
  phoneNumber: string | null;
  messageRequestId: string | null;
  requestedAt: Date | null;
  requestStatus: string | null;
  deliveryStatus: string | null;
  submittedAt: Date | null;
  hasReturnCommitment: boolean;
  commitmentExpectedAt: Date | null;
  returnEvidenceKind: 'COMMITMENT_BACKED' | 'OBSERVED' | null;
  previousVisitAt: Date | null;
  sortAt: Date;
};

@Injectable()
export class OpportunitiesWorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  listMessaging(
    tenantId: string,
    filter: Exclude<OpportunityWorkspaceFilter, 'REVENUE_DROP'>,
    cursor?: { sortAt: Date; stableId: string },
  ): Promise<OpportunityWorkspaceSqlRow[]> {
    const includeOrdinary = filter !== 'VIP';
    const includeVip = filter !== 'SALON_MESSAGES';
    const cursorSql = cursor
      ? Prisma.sql`AND (
          sort_at < ${cursor.sortAt}
          OR (sort_at = ${cursor.sortAt} AND stable_id < ${cursor.stableId})
        )`
      : Prisma.empty;

    return this.prisma.client.$queryRaw<OpportunityWorkspaceSqlRow[]>(Prisma.sql`
      WITH ${observedReturnCtes(tenantId)},
      ordinary_latest AS (
        SELECT DISTINCT ON (r.customer_id)
          r.id AS request_id,
          r.customer_id,
          r.requested_at,
          r.status AS request_status
        FROM message_requests r
        WHERE r.salon_id = ${tenantId}::uuid
          AND r.customer_id IS NOT NULL
          AND r.vip_request_id IS NULL
        ORDER BY r.customer_id, r.requested_at DESC, r.id DESC
      ),
      ordinary_rows AS (
        SELECT
          'SALON_CUSTOMER'::text AS row_kind,
          c.id::text AS stable_subject,
          ('SALON_CUSTOMER:' || c.id::text) AS stable_id,
          c.id AS customer_id,
          TRIM(BOTH FROM CONCAT(c.first_name, ' ', c.last_name)) AS display_name,
          c.phone_number AS phone_number,
          o.request_id AS message_request_id,
          o.requested_at,
          o.request_status,
          d.status::text AS delivery_status,
          d.submitted_at,
          (rc.id IS NOT NULL) AS has_return_commitment,
          rc.expected_at AS commitment_expected_at,
          CASE
            WHEN rc.actual_visit_id IS NOT NULL
              AND rc.customer_id = o.customer_id
              AND v.customer_id = o.customer_id
              AND d.customer_id = o.customer_id
              AND rc.source_message_delivery_id = d.id
              AND d.message_request_id = o.request_id
              AND d.status = 'SENT'::"MessageDeliveryStatus"
              AND d.submitted_at IS NOT NULL
              AND v.visited_at > d.submitted_at
              THEN 'COMMITMENT_BACKED'
            WHEN obs.request_id IS NOT NULL THEN 'OBSERVED'
            ELSE NULL
          END AS return_evidence_kind,
          NULL::timestamptz AS previous_visit_at,
          o.requested_at AS sort_at
        FROM ordinary_latest o
        INNER JOIN customers c
          ON c.id = o.customer_id AND c.salon_id = ${tenantId}::uuid
        LEFT JOIN message_deliveries d
          ON d.message_request_id = o.request_id AND d.salon_id = ${tenantId}::uuid
        LEFT JOIN return_commitments rc
          ON rc.source_message_request_id = o.request_id AND rc.salon_id = ${tenantId}::uuid
        LEFT JOIN visits v
          ON v.id = rc.actual_visit_id AND v.salon_id = ${tenantId}::uuid
        LEFT JOIN observed obs
          ON obs.request_id = o.request_id
        WHERE ${includeOrdinary ? Prisma.sql`TRUE` : Prisma.sql`FALSE`}
      ),
      vip_rows AS (
        SELECT
          'VIP_RECIPIENT'::text AS row_kind,
          r.id::text AS stable_subject,
          ('VIP_RECIPIENT:' || r.id::text) AS stable_id,
          NULL::uuid AS customer_id,
          COALESCE(r.recipient_display_name, '') AS display_name,
          r.recipient_phone_number AS phone_number,
          r.id AS message_request_id,
          r.requested_at,
          r.status AS request_status,
          d.status::text AS delivery_status,
          d.submitted_at,
          FALSE AS has_return_commitment,
          NULL::timestamptz AS commitment_expected_at,
          NULL::text AS return_evidence_kind,
          NULL::timestamptz AS previous_visit_at,
          r.requested_at AS sort_at
        FROM message_requests r
        LEFT JOIN message_deliveries d
          ON d.message_request_id = r.id AND d.salon_id = r.salon_id
        WHERE r.salon_id = ${tenantId}::uuid
          AND r.vip_request_id IS NOT NULL
          AND ${includeVip ? Prisma.sql`TRUE` : Prisma.sql`FALSE`}
      ),
      unioned AS (
        SELECT * FROM ordinary_rows
        UNION ALL
        SELECT * FROM vip_rows
      )
      SELECT
        row_kind AS "rowKind",
        stable_subject AS "stableSubject",
        customer_id AS "customerId",
        display_name AS "displayName",
        phone_number AS "phoneNumber",
        message_request_id AS "messageRequestId",
        requested_at AS "requestedAt",
        request_status AS "requestStatus",
        delivery_status AS "deliveryStatus",
        submitted_at AS "submittedAt",
        has_return_commitment AS "hasReturnCommitment",
        commitment_expected_at AS "commitmentExpectedAt",
        return_evidence_kind AS "returnEvidenceKind",
        previous_visit_at AS "previousVisitAt",
        sort_at AS "sortAt"
      FROM unioned
      WHERE TRUE
        ${cursorSql}
      ORDER BY sort_at DESC, stable_id DESC
      LIMIT ${OPPORTUNITY_WORKSPACE_LIMIT + 1}
    `);
  }

  listRevenueDrop(
    tenantId: string,
    windows: ComparableJalaliMonthWindows,
    cursor?: { previousVisitAt: Date; customerId: string },
  ): Promise<OpportunityWorkspaceSqlRow[]> {
    const cursorSql = cursor
      ? Prisma.sql`AND (
          previous_visit_at < ${cursor.previousVisitAt}
          OR (previous_visit_at = ${cursor.previousVisitAt} AND c.id::text < ${cursor.customerId})
        )`
      : Prisma.empty;

    return this.prisma.client.$queryRaw<OpportunityWorkspaceSqlRow[]>(Prisma.sql`
      SELECT
        'SALON_CUSTOMER'::text AS "rowKind",
        c.id::text AS "stableSubject",
        c.id AS "customerId",
        TRIM(BOTH FROM CONCAT(c.first_name, ' ', c.last_name)) AS "displayName",
        c.phone_number AS "phoneNumber",
        NULL::uuid AS "messageRequestId",
        NULL::timestamptz AS "requestedAt",
        NULL::text AS "requestStatus",
        NULL::text AS "deliveryStatus",
        NULL::timestamptz AS "submittedAt",
        FALSE AS "hasReturnCommitment",
        NULL::timestamptz AS "commitmentExpectedAt",
        NULL::text AS "returnEvidenceKind",
        previous_visit.previous_visit_at AS "previousVisitAt",
        previous_visit.previous_visit_at AS "sortAt"
      FROM customers c
      INNER JOIN LATERAL (
        SELECT MAX(v.visited_at) AS previous_visit_at
        FROM visits v
        WHERE v.salon_id = ${tenantId}::uuid
          AND v.customer_id = c.id
          AND v.visited_at >= ${windows.previousStart}
          AND v.visited_at < ${windows.previousEndExclusive}
      ) previous_visit ON previous_visit.previous_visit_at IS NOT NULL
      WHERE c.salon_id = ${tenantId}::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM visits current_visit
          WHERE current_visit.salon_id = ${tenantId}::uuid
            AND current_visit.customer_id = c.id
            AND current_visit.visited_at >= ${windows.currentStart}
            AND current_visit.visited_at <= ${windows.now}
        )
        ${cursorSql}
      ORDER BY previous_visit.previous_visit_at DESC, c.id DESC
      LIMIT ${OPPORTUNITY_WORKSPACE_LIMIT + 1}
    `);
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { isVipRegionCode, vipOutreachRequestDisplayTitle, vipRegionName } from '@salon/shared';
import { decodeCursor, encodeCursor, parseCursorInstant, parseCursorInteger, parseCursorUuid, toListPage } from '../infrastructure/http/list-page';
import { PrismaService } from '../infrastructure/database/prisma.service';

export const ADMIN_VIP_OUTREACH_LIST_LIMIT = 50;

const EXECUTION_SQL = Prisma.sql`
  CASE
    WHEN rec.message_request_id IS NULL THEN 'NOT_YET_QUEUED'
    WHEN d.status = 'SENT' AND d.submitted_at IS NOT NULL THEN 'SENT'
    WHEN mr.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN mr.status = 'FAILED' OR d.status = 'FAILED' THEN 'FAILED'
    WHEN mr.status = 'DISPATCHED' OR d.status IN ('PENDING', 'PROCESSING') THEN 'IN_PIPELINE'
    ELSE 'QUEUED'
  END
`;

type FolderRow = {
  salonId: string;
  salonName: string;
  requestCount: number;
  recipientCount: number;
  pendingMessageCount: number;
  sentMessageCount: number;
  failedMessageCount: number;
  cancelledMessageCount: number;
  latestActivityAt: Date;
};

type RequestRow = {
  id: string;
  salonId: string;
  salonName: string;
  listId: string;
  listName: string;
  regionCode: string | null;
  requestedCount: number;
  geographicRange: string;
  status: string;
  createdAt: Date;
  submittedAt: Date | null;
  sampleWorkCount: number;
  recipientCount: number;
  notYetQueuedCount: number;
  queuedCount: number;
  inPipelineCount: number;
  sentCount: number;
  failedCount: number;
  cancelledCount: number;
  requestOrdinal: number;
};

type RecipientRow = {
  id: string;
  sortOrder: number;
  displayName: string | null;
  phoneNumber: string;
  messageRequestId: string | null;
  messageRequestStatus: string | null;
  deliveryStatus: string | null;
  deliveryMode: string | null;
  submittedAt: Date | null;
  executionState: string;
};

function parseActivityCursor(value: string | undefined): { at: Date; salonId: string } | undefined {
  const parts = decodeCursor(value, 2);
  if (!parts) {
    return undefined;
  }
  const [atRaw, salonId] = parts;
  return { at: parseCursorInstant(atRaw!), salonId: parseCursorUuid(salonId!) };
}

function parseCreatedCursor(value: string | undefined): { at: Date; id: string } | undefined {
  const parts = decodeCursor(value, 2);
  if (!parts) {
    return undefined;
  }
  const [atRaw, id] = parts;
  return { at: parseCursorInstant(atRaw!), id: parseCursorUuid(id!) };
}

function parseSortCursor(value: string | undefined): { sortOrder: number; id: string } | undefined {
  const parts = decodeCursor(value, 2);
  if (!parts) {
    return undefined;
  }
  const [sortRaw, id] = parts;
  return { sortOrder: parseCursorInteger(sortRaw!), id: parseCursorUuid(id!) };
}

function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

@Injectable()
export class AdminVipOutreachRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listSalonFolders(query: { cursor?: string; q?: string }) {
    const cursor = parseActivityCursor(query.cursor);
    const name = query.q?.trim() ?? '';
    const searchClause = name
      ? Prisma.sql`AND s.name ILIKE ${`%${escapeIlike(name)}%`} ESCAPE '\\'`
      : Prisma.empty;
    const cursorClause = cursor
      ? Prisma.sql`AND (
          folders.latest_activity_at < ${cursor.at}
          OR (folders.latest_activity_at = ${cursor.at} AND folders.salon_id < ${cursor.salonId}::uuid)
        )`
      : Prisma.empty;

    const rows = await this.prisma.client.$queryRaw<FolderRow[]>`
      WITH rec_stats AS (
        SELECT
          rec.salon_id,
          COUNT(*)::int AS recipient_count,
          COUNT(*) FILTER (WHERE ${EXECUTION_SQL} IN ('NOT_YET_QUEUED', 'QUEUED', 'IN_PIPELINE'))::int
            AS pending_count,
          COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'SENT')::int AS sent_count,
          COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'FAILED')::int AS failed_count,
          COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'CANCELLED')::int AS cancelled_count,
          MAX(COALESCE(d.updated_at, mr.updated_at)) AS message_updated_at
        FROM vip_request_recipients rec
        LEFT JOIN message_requests mr ON mr.id = rec.message_request_id
        LEFT JOIN message_deliveries d ON d.message_request_id = mr.id
        GROUP BY rec.salon_id
      ),
      req_stats AS (
        SELECT
          r.salon_id,
          COUNT(*)::int AS request_count,
          MAX(r.updated_at) AS request_updated_at
        FROM vip_requests r
        GROUP BY r.salon_id
      ),
      folders AS (
        SELECT
          s.id AS salon_id,
          s.name AS salon_name,
          req.request_count,
          COALESCE(rec.recipient_count, 0) AS recipient_count,
          COALESCE(rec.pending_count, 0) AS pending_count,
          COALESCE(rec.sent_count, 0) AS sent_count,
          COALESCE(rec.failed_count, 0) AS failed_count,
          COALESCE(rec.cancelled_count, 0) AS cancelled_count,
          GREATEST(
            req.request_updated_at,
            COALESCE(rec.message_updated_at, req.request_updated_at)
          ) AS latest_activity_at
        FROM req_stats req
        JOIN salons s ON s.id = req.salon_id
        LEFT JOIN rec_stats rec ON rec.salon_id = req.salon_id
      )
      SELECT
        folders.salon_id AS "salonId",
        folders.salon_name AS "salonName",
        folders.request_count AS "requestCount",
        folders.recipient_count AS "recipientCount",
        folders.pending_count AS "pendingMessageCount",
        folders.sent_count AS "sentMessageCount",
        folders.failed_count AS "failedMessageCount",
        folders.cancelled_count AS "cancelledMessageCount",
        folders.latest_activity_at AS "latestActivityAt"
      FROM folders
      JOIN salons s ON s.id = folders.salon_id
      WHERE TRUE
        ${searchClause}
        ${cursorClause}
      ORDER BY folders.latest_activity_at DESC, folders.salon_id DESC
      LIMIT ${ADMIN_VIP_OUTREACH_LIST_LIMIT + 1}
    `;

    return toListPage(rows, ADMIN_VIP_OUTREACH_LIST_LIMIT, (row) =>
      encodeCursor([row.latestActivityAt.toISOString(), row.salonId]),
    );
  }

  async listSalonRequests(salonId: string, cursor?: string) {
    const salon = await this.prisma.client.salon.findUnique({
      where: { id: salonId },
      select: { id: true, name: true },
    });
    if (!salon) {
      return null;
    }
    const parsed = parseCreatedCursor(cursor);
    const cursorClause = parsed
      ? Prisma.sql`AND (
          r.created_at < ${parsed.at}
          OR (r.created_at = ${parsed.at} AND r.id < ${parsed.id}::uuid)
        )`
      : Prisma.empty;

    const rows = await this.prisma.client.$queryRaw<RequestRow[]>`
      SELECT
        r.id,
        r.salon_id AS "salonId",
        s.name AS "salonName",
        r.list_id AS "listId",
        l.name AS "listName",
        l.region_code AS "regionCode",
        r.requested_count AS "requestedCount",
        r.geographic_range AS "geographicRange",
        r.status,
        r.created_at AS "createdAt",
        r.submitted_at AS "submittedAt",
        (
          SELECT COUNT(*)::int FROM vip_sample_works w WHERE w.vip_request_id = r.id
        ) AS "sampleWorkCount",
        COUNT(rec.id)::int AS "recipientCount",
        COUNT(*) FILTER (WHERE rec.id IS NOT NULL AND ${EXECUTION_SQL} = 'NOT_YET_QUEUED')::int
          AS "notYetQueuedCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'QUEUED')::int AS "queuedCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'IN_PIPELINE')::int AS "inPipelineCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'SENT')::int AS "sentCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'FAILED')::int AS "failedCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'CANCELLED')::int AS "cancelledCount",
        (
          SELECT COUNT(*)::int
          FROM vip_requests older
          WHERE older.salon_id = r.salon_id
            AND (older.created_at, older.id) < (r.created_at, r.id)
        ) + 1 AS "requestOrdinal"
      FROM vip_requests r
      JOIN salons s ON s.id = r.salon_id
      JOIN vip_target_lists l ON l.id = r.list_id
      LEFT JOIN vip_request_recipients rec ON rec.vip_request_id = r.id
      LEFT JOIN message_requests mr ON mr.id = rec.message_request_id
      LEFT JOIN message_deliveries d ON d.message_request_id = mr.id
      WHERE r.salon_id = ${salonId}::uuid
        ${cursorClause}
      GROUP BY r.id, s.name, l.name, l.region_code
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${ADMIN_VIP_OUTREACH_LIST_LIMIT + 1}
    `;

    const page = toListPage(rows, ADMIN_VIP_OUTREACH_LIST_LIMIT, (row) =>
      encodeCursor([row.createdAt.toISOString(), row.id]),
    );
    return {
      salonId: salon.id,
      salonName: salon.name,
      ...page,
    };
  }

  async findRequestHeader(requestId: string) {
    const rows = await this.prisma.client.$queryRaw<RequestRow[]>`
      SELECT
        r.id,
        r.salon_id AS "salonId",
        s.name AS "salonName",
        r.list_id AS "listId",
        l.name AS "listName",
        l.region_code AS "regionCode",
        r.requested_count AS "requestedCount",
        r.geographic_range AS "geographicRange",
        r.status,
        r.created_at AS "createdAt",
        r.submitted_at AS "submittedAt",
        (
          SELECT COUNT(*)::int FROM vip_sample_works w WHERE w.vip_request_id = r.id
        ) AS "sampleWorkCount",
        COUNT(rec.id)::int AS "recipientCount",
        COUNT(*) FILTER (WHERE rec.id IS NOT NULL AND ${EXECUTION_SQL} = 'NOT_YET_QUEUED')::int
          AS "notYetQueuedCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'QUEUED')::int AS "queuedCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'IN_PIPELINE')::int AS "inPipelineCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'SENT')::int AS "sentCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'FAILED')::int AS "failedCount",
        COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'CANCELLED')::int AS "cancelledCount",
        (
          SELECT COUNT(*)::int
          FROM vip_requests older
          WHERE older.salon_id = r.salon_id
            AND (older.created_at, older.id) < (r.created_at, r.id)
        ) + 1 AS "requestOrdinal"
      FROM vip_requests r
      JOIN salons s ON s.id = r.salon_id
      JOIN vip_target_lists l ON l.id = r.list_id
      LEFT JOIN vip_request_recipients rec ON rec.vip_request_id = r.id
      LEFT JOIN message_requests mr ON mr.id = rec.message_request_id
      LEFT JOIN message_deliveries d ON d.message_request_id = mr.id
      WHERE r.id = ${requestId}::uuid
      GROUP BY r.id, s.name, l.name, l.region_code
    `;
    return rows[0] ?? null;
  }

  async listRequestRecipients(requestId: string, cursor?: string) {
    const parsed = parseSortCursor(cursor);
    const cursorClause = parsed
      ? Prisma.sql`AND (
          rec.sort_order > ${parsed.sortOrder}
          OR (rec.sort_order = ${parsed.sortOrder} AND rec.id > ${parsed.id}::uuid)
        )`
      : Prisma.empty;

    const rows = await this.prisma.client.$queryRaw<RecipientRow[]>`
      SELECT
        rec.id,
        rec.sort_order AS "sortOrder",
        rec.display_name AS "displayName",
        rec.phone_number AS "phoneNumber",
        rec.message_request_id AS "messageRequestId",
        mr.status AS "messageRequestStatus",
        d.status AS "deliveryStatus",
        d.mode AS "deliveryMode",
        d.submitted_at AS "submittedAt",
        ${EXECUTION_SQL} AS "executionState"
      FROM vip_request_recipients rec
      LEFT JOIN message_requests mr ON mr.id = rec.message_request_id
      LEFT JOIN message_deliveries d ON d.message_request_id = mr.id
      WHERE rec.vip_request_id = ${requestId}::uuid
        ${cursorClause}
      ORDER BY rec.sort_order ASC, rec.id ASC
      LIMIT ${ADMIN_VIP_OUTREACH_LIST_LIMIT + 1}
    `;

    return toListPage(rows, ADMIN_VIP_OUTREACH_LIST_LIMIT, (row) =>
      encodeCursor([String(row.sortOrder), row.id]),
    );
  }
}

export function toOutreachRequestDto(row: RequestRow) {
  const regionCode = row.regionCode && isVipRegionCode(row.regionCode) ? row.regionCode : null;
  return {
    id: row.id,
    salonId: row.salonId,
    salonName: row.salonName,
    listId: row.listId,
    listName: row.listName,
    regionCode,
    regionName: regionCode ? vipRegionName(regionCode) : null,
    displayTitle: vipOutreachRequestDisplayTitle({
      salonName: row.salonName,
      regionCode,
      recipientCount: row.recipientCount,
      requestOrdinal: row.requestOrdinal,
    }),
    requestOrdinal: row.requestOrdinal,
    requestedCount: row.requestedCount,
    geographicRange: row.geographicRange,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    sampleWorkCount: row.sampleWorkCount,
    recipientCount: row.recipientCount,
    notYetQueuedCount: row.notYetQueuedCount,
    queuedCount: row.queuedCount,
    inPipelineCount: row.inPipelineCount,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    cancelledCount: row.cancelledCount,
    canDispatchManual: row.status === 'SUBMITTED' || row.status === 'BALE_NOT_IMPLEMENTED',
  };
}

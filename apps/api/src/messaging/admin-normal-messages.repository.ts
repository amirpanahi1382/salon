import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { decodeCursor, encodeCursor, parseCursorInstant, parseCursorUuid, toListPage } from '../infrastructure/http/list-page';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ADMIN_MESSAGE_LIST_LIMIT, parseAdminCursor } from './admin-message.repository';
import { ADMIN_MESSAGE_SELECT } from './admin-message.mapper';

export const ADMIN_NORMAL_FOLDER_LIMIT = 50;

const EXECUTION_SQL = Prisma.sql`
  CASE
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
  totalMessageCount: number;
  sentMessageCount: number;
  pendingMessageCount: number;
  failedMessageCount: number;
  cancelledMessageCount: number;
  latestActivityAt: Date;
};

function parseActivityCursor(value: string | undefined): { at: Date; salonId: string } | undefined {
  const parts = decodeCursor(value, 2);
  if (!parts) {
    return undefined;
  }
  const [atRaw, salonId] = parts;
  return { at: parseCursorInstant(atRaw!), salonId: parseCursorUuid(salonId!) };
}

function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

@Injectable()
export class AdminNormalMessagesRepository {
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
      WITH folders AS (
        SELECT
          s.id AS salon_id,
          s.name AS salon_name,
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'SENT')::int AS sent_count,
          COUNT(*) FILTER (WHERE ${EXECUTION_SQL} IN ('QUEUED', 'IN_PIPELINE'))::int AS pending_count,
          COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'FAILED')::int AS failed_count,
          COUNT(*) FILTER (WHERE ${EXECUTION_SQL} = 'CANCELLED')::int AS cancelled_count,
          MAX(COALESCE(d.updated_at, mr.updated_at, mr.requested_at)) AS latest_activity_at
        FROM message_requests mr
        JOIN salons s ON s.id = mr.salon_id
        LEFT JOIN message_deliveries d ON d.message_request_id = mr.id
        WHERE mr.vip_request_id IS NULL
        GROUP BY s.id, s.name
      )
      SELECT
        folders.salon_id AS "salonId",
        folders.salon_name AS "salonName",
        folders.total_count AS "totalMessageCount",
        folders.sent_count AS "sentMessageCount",
        folders.pending_count AS "pendingMessageCount",
        folders.failed_count AS "failedMessageCount",
        folders.cancelled_count AS "cancelledMessageCount",
        folders.latest_activity_at AS "latestActivityAt"
      FROM folders
      JOIN salons s ON s.id = folders.salon_id
      WHERE TRUE
        ${searchClause}
        ${cursorClause}
      ORDER BY folders.latest_activity_at DESC, folders.salon_id DESC
      LIMIT ${ADMIN_NORMAL_FOLDER_LIMIT + 1}
    `;

    return toListPage(rows, ADMIN_NORMAL_FOLDER_LIMIT, (row) =>
      encodeCursor([row.latestActivityAt.toISOString(), row.salonId]),
    );
  }

  async findSalonFolder(salonId: string) {
    const rows = await this.prisma.client.$queryRaw<FolderRow[]>`
      SELECT
        s.id AS "salonId",
        s.name AS "salonName",
        COUNT(mr.id)::int AS "totalMessageCount",
        COUNT(*) FILTER (WHERE mr.id IS NOT NULL AND ${EXECUTION_SQL} = 'SENT')::int AS "sentMessageCount",
        COUNT(*) FILTER (WHERE mr.id IS NOT NULL AND ${EXECUTION_SQL} IN ('QUEUED', 'IN_PIPELINE'))::int AS "pendingMessageCount",
        COUNT(*) FILTER (WHERE mr.id IS NOT NULL AND ${EXECUTION_SQL} = 'FAILED')::int AS "failedMessageCount",
        COUNT(*) FILTER (WHERE mr.id IS NOT NULL AND ${EXECUTION_SQL} = 'CANCELLED')::int AS "cancelledMessageCount",
        MAX(COALESCE(d.updated_at, mr.updated_at, mr.requested_at)) AS "latestActivityAt"
      FROM salons s
      LEFT JOIN message_requests mr
        ON mr.salon_id = s.id
        AND mr.vip_request_id IS NULL
      LEFT JOIN message_deliveries d ON d.message_request_id = mr.id
      WHERE s.id = ${salonId}::uuid
      GROUP BY s.id, s.name
    `;
    return rows[0] ?? null;
  }

  listSalonMessages(salonId: string, cursor?: string) {
    const parsed = parseAdminCursor(cursor);
    return this.prisma.client.messageRequest.findMany({
      where: {
        salonId,
        vipRequestId: null,
        ...(parsed
          ? {
              OR: [
                { requestedAt: { lt: parsed.requestedAt } },
                { requestedAt: parsed.requestedAt, id: { lt: parsed.id } },
              ],
            }
          : {}),
      },
      select: ADMIN_MESSAGE_SELECT,
      orderBy: [{ requestedAt: 'desc' as const }, { id: 'desc' as const }],
      take: ADMIN_MESSAGE_LIST_LIMIT + 1,
    });
  }
}

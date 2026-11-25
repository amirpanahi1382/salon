import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { NotFoundError } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VIP_OPEN_REQUEST_STATUSES, vipRequestOccupyingSql } from './vip-list-request-counts';

export { VIP_OPEN_REQUEST_STATUSES } from './vip-list-request-counts';

/**
 * Canonical recorded send: one MessageDelivery per MessageRequest
 * (`message_deliveries.message_request_id` unique). Count SENT with non-null
 * submittedAt. Queued/failed/cancelled deliveries are not sends. Retries reuse
 * the same delivery row. Not confirmed provider delivery and not a Visit.
 */
export const RECORDED_SEND_PREDICATE = Prisma.sql`
  d.status = 'SENT'::"MessageDeliveryStatus"
  AND d.submitted_at IS NOT NULL
`;

type ProfileRow = {
  id: string;
  name: string;
  accessState: string;
  entitled: boolean;
  distinctVipListCount: number;
  vipRequestCount: number;
  vipOpenRequestCount: number;
  vipUnresolvedRequestCount: number;
  ordinaryMessageRequestCount: number;
  vipRecordedSendCount: number;
  ordinaryRecordedSendCount: number;
};

@Injectable()
export class GetAdminSalonProfileUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(salonId: string) {
    const asOf = new Date();
    const rows = await this.prisma.client.$queryRaw<ProfileRow[]>(Prisma.sql`
      SELECT
        s.id,
        s.name,
        s.access_state::text AS "accessState",
        (e.id IS NOT NULL AND e.revoked_at IS NULL) AS entitled,
        (
          SELECT COUNT(DISTINCT r.list_id)::int
          FROM vip_requests r
          WHERE r.salon_id = s.id
        ) AS "distinctVipListCount",
        (
          SELECT COUNT(*)::int
          FROM vip_requests r
          WHERE r.salon_id = s.id
        ) AS "vipRequestCount",
        (
          SELECT COUNT(*)::int
          FROM vip_requests r
          WHERE r.salon_id = s.id
            AND r.status::text IN (${Prisma.join([...VIP_OPEN_REQUEST_STATUSES])})
        ) AS "vipOpenRequestCount",
        (
          SELECT COUNT(*)::int
          FROM vip_requests r
          WHERE r.salon_id = s.id
            AND ${vipRequestOccupyingSql('r', asOf)}
        ) AS "vipUnresolvedRequestCount",
        (
          SELECT COUNT(*)::int
          FROM message_requests m
          WHERE m.salon_id = s.id
            AND m.vip_request_id IS NULL
        ) AS "ordinaryMessageRequestCount",
        (
          SELECT COUNT(*)::int
          FROM message_deliveries d
          INNER JOIN message_requests m
            ON m.id = d.message_request_id AND m.salon_id = d.salon_id
          WHERE d.salon_id = s.id
            AND ${RECORDED_SEND_PREDICATE}
            AND m.vip_request_id IS NOT NULL
        ) AS "vipRecordedSendCount",
        (
          SELECT COUNT(*)::int
          FROM message_deliveries d
          INNER JOIN message_requests m
            ON m.id = d.message_request_id AND m.salon_id = d.salon_id
          WHERE d.salon_id = s.id
            AND ${RECORDED_SEND_PREDICATE}
            AND m.vip_request_id IS NULL
        ) AS "ordinaryRecordedSendCount"
      FROM salons s
      LEFT JOIN vip_salon_entitlements e ON e.salon_id = s.id
      WHERE s.id = ${salonId}::uuid
    `);
    const row = rows[0];
    if (!row) {
      throw new NotFoundError('Salon not found');
    }
    return {
      salonId: row.id,
      salonName: row.name,
      accessState: row.accessState,
      entitled: row.entitled,
      asOf: asOf.toISOString(),
      consistency: 'LIVE_READ' as const,
      explanation:
        'شمارش زنده از ردیف‌های ذخیره‌شده است. درخواست VIP کل تاریخچه را می‌شمارد؛ درخواست در جریان فقط کار حل‌نشده را. پیام عادی یعنی MessageRequest بدون vip_request_id. ارسال ثبت‌شده یعنی MessageDelivery با SENT و submittedAt؛ صف یا تحویل قطعی نیست.',
      counts: {
        distinctVipListsRequested: Number(row.distinctVipListCount),
        vipRequestCount: Number(row.vipRequestCount),
        vipOpenRequestCount: Number(row.vipOpenRequestCount),
        vipUnresolvedRequestCount: Number(row.vipUnresolvedRequestCount),
        ordinaryMessageRequestCount: Number(row.ordinaryMessageRequestCount),
        vipRecordedSendCount: Number(row.vipRecordedSendCount),
        ordinaryRecordedSendCount: Number(row.ordinaryRecordedSendCount),
      },
      definitions: {
        distinctVipListsRequested:
          'COUNT(DISTINCT vip_requests.list_id) for this salon, every request status including CANCELLED.',
        vipRequestCount:
          'COUNT(*) of vip_requests for this salon, including CANCELLED and AWAITING_SAMPLE_WORK.',
        vipOpenRequestCount:
          'vip_requests in AWAITING_SAMPLE_WORK, SUBMITTED, MANUAL_QUEUED, or BALE_NOT_IMPLEMENTED. CANCELLED excluded.',
        vipUnresolvedRequestCount:
          'Unexpired drafts plus submitted requests with at least one recipient in NOT_YET_QUEUED, QUEUED, or IN_PIPELINE.',
        ordinaryMessageRequestCount:
          'COUNT(*) of message_requests for this salon where vip_request_id IS NULL, every request status.',
        vipRecordedSendCount:
          'COUNT of message_deliveries SENT with submittedAt, joined to message_requests with vip_request_id set. One delivery row per request.',
        ordinaryRecordedSendCount:
          'COUNT of message_deliveries SENT with submittedAt, joined to message_requests with vip_request_id null. One delivery row per request.',
      },
    };
  }
}

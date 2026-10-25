import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import type { AuthenticatedPrincipal, VipRequestProgress } from '@salon/shared';
import {
  decodeCursor,
  encodeCursor,
  parseCursorInstant,
  parseCursorUuid,
  toListPage,
} from '../infrastructure/http/list-page';
import { progressFromFact, progressWithoutRecipients, toVipRequest } from './vip.mapper';
import { VipRepository, type SalonVipProgressFact } from './vip.repository';

export const VIP_REQUEST_HISTORY_LIMIT = 50;

type IntentionVisitCounts = {
  vipRequestId: string;
  intentionRecipientCount: number;
  visitedRecipientCount: number;
};

export type SalonVipRequestHistoryItem = ReturnType<typeof toVipRequest> & {
  recordedSendCount: number;
  manualRecordedSendCount: number;
  stillQueuedOrInProgressCount: number;
  intentionRecipientCount: number | null;
  visitedRecipientCount: number | null;
  recipientDenominator: number | null;
  /**
   * Intention/visit numerators are distinct VipRequestRecipient ids on this request.
   * null means the association cannot be established for this row (honest unknown).
   */
  metricsAvailability: 'AVAILABLE' | 'UNAVAILABLE';
  sentMeans: 'RECORDED_SEND_NOT_CONFIRMED_DELIVERY';
};

@Injectable()
export class ListSalonVipRequestHistoryUseCase {
  constructor(private readonly vip: VipRepository) {}

  /**
   * Read-only history of every VipRequest for the authenticated salon.
   * Does not call expireStaleReservations or otherwise write.
   * Expired AWAITING_SAMPLE_WORK drafts keep their stored status; display derives
   * the post-deadline headline from reservedUntil vs evaluation time (same as
   * deriveVipRequestProgress). Mutating VIP flows still own lazy cancellation.
   * Revoked entitlement sets entitled=false but still returns this salon's history.
   */
  async execute(principal: AuthenticatedPrincipal, cursorValue?: string, now = new Date()) {
    const entitled = (await this.vip.findActiveEntitlement(principal.tenantId)) != null;

    const cursorParts = decodeCursor(cursorValue, 2);
    const cursor = cursorParts
      ? {
          createdAt: parseCursorInstant(cursorParts[0]!),
          id: parseCursorUuid(cursorParts[1]!),
        }
      : undefined;

    // Genuine read: no expireStaleReservations, no write transaction.
    const rows = await this.listRequests(principal.tenantId, cursor);

    const facts = await this.vip.recipientProgressFacts(
      principal.tenantId,
      rows.map((row) => row.id),
    );
    const intentionCounts = await this.intentionVisitCounts(
      principal.tenantId,
      rows.map((row) => row.id),
    );

    const mapped = rows.map((row) =>
      toHistoryItem(
        {
          ...row,
          salon: row.salon,
          list: row.list,
          sampleWorks: row.sampleWorks,
        },
        facts.get(row.id),
        intentionCounts.get(row.id),
        now,
      ),
    );
    const page = toListPage(mapped, VIP_REQUEST_HISTORY_LIMIT, (row) =>
      encodeCursor([row.createdAt, row.id]),
    );

    return {
      entitled,
      /**
       * Live read of stored VipRequest rows and recipient/intention facts at evaluation time.
       * Not a multi-query snapshot. Does not cancel expired drafts on this path.
       * Display of an overdue AWAITING_SAMPLE_WORK draft uses reservedUntil vs `now`.
       */
      consistency: 'LIVE_READ' as const,
      explanation: entitled
        ? 'همهٔ درخواست‌های VIP این سالن، با وضعیت ذخیره‌شده و شمارش گیرندگان همان درخواست. نام و شمارهٔ مخاطبان لیست هدف افشا نمی‌شود. ارسال ثبت‌شده به‌معنای تحویل قطعی نیست. نیت مراجعه با مراجعهٔ ثبت‌شده یکی نیست.'
        : 'ارسال VIP جدید برای این سالن فعال نیست؛ تاریخچهٔ درخواست‌های قبلی همین سالن همچنان نمایش داده می‌شود. نام و شمارهٔ مخاطبان لیست هدف افشا نمی‌شود.',
      items: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  private listRequests(
    salonId: string,
    cursor: { createdAt: Date; id: string } | undefined,
  ) {
    return this.vip.client.vipRequest.findMany({
      where: {
        salonId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: VIP_REQUEST_HISTORY_LIMIT + 1,
      select: {
        id: true,
        salonId: true,
        listId: true,
        requestedCount: true,
        geographicRange: true,
        status: true,
        reservedUntil: true,
        submittedAt: true,
        createdAt: true,
        salon: { select: { name: true } },
        list: { select: { name: true } },
        sampleWorks: {
          orderBy: { position: 'asc' },
          select: { id: true, position: true, contentType: true, byteSize: true },
        },
      },
    });
  }

  private async intentionVisitCounts(
    salonId: string,
    requestIds: string[],
  ): Promise<Map<string, IntentionVisitCounts>> {
    const map = new Map<string, IntentionVisitCounts>();
    if (requestIds.length === 0) {
      return map;
    }
    const rows = await this.vip.client.$queryRaw<IntentionVisitCounts[]>`
      SELECT
        vi.vip_request_id AS "vipRequestId",
        COUNT(DISTINCT vi.vip_request_recipient_id)::int AS "intentionRecipientCount",
        COUNT(DISTINCT vi.vip_request_recipient_id) FILTER (
          WHERE vi.linked_visit_id IS NOT NULL
        )::int AS "visitedRecipientCount"
      FROM visit_intentions vi
      INNER JOIN vip_request_recipients vrr
        ON vrr.id = vi.vip_request_recipient_id
        AND vrr.salon_id = vi.salon_id
        AND vrr.vip_request_id = vi.vip_request_id
      WHERE vi.salon_id = ${salonId}::uuid
        AND vi.subject = 'VIP_PROSPECT'::"VisitIntentionSubject"
        AND vi.vip_request_id IN (${Prisma.join(requestIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND vi.vip_request_recipient_id IS NOT NULL
      GROUP BY vi.vip_request_id
    `;
    for (const row of rows) {
      map.set(row.vipRequestId, row);
    }
    return map;
  }
}

function toHistoryItem(
  row: {
    id: string;
    salonId: string;
    salon: { name: string };
    listId: string;
    list: { name: string };
    requestedCount: number;
    geographicRange: string;
    status: Parameters<typeof toVipRequest>[0]['status'];
    reservedUntil: Date;
    submittedAt: Date | null;
    createdAt: Date;
    sampleWorks: Array<{
      id: string;
      position: number;
      contentType: string;
      byteSize: number;
    }>;
  },
  fact: SalonVipProgressFact | undefined,
  intentions: IntentionVisitCounts | undefined,
  now: Date,
): SalonVipRequestHistoryItem {
  const progress: VipRequestProgress = fact
    ? progressFromFact(fact, now)
    : progressWithoutRecipients(row, now);
  const base = toVipRequest(row, progress);
  const metrics = historyMetrics(row, fact, intentions);

  return {
    ...base,
    ...metrics,
    sentMeans: 'RECORDED_SEND_NOT_CONFIRMED_DELIVERY',
  };
}

/** Pure metrics for one VipRequest history row. Distinct recipients; no invented zeros when unavailable. */
export function historyMetrics(
  row: { status: string; submittedAt: Date | null },
  fact: SalonVipProgressFact | undefined,
  intentions: IntentionVisitCounts | undefined,
): Pick<
  SalonVipRequestHistoryItem,
  | 'recordedSendCount'
  | 'manualRecordedSendCount'
  | 'stillQueuedOrInProgressCount'
  | 'intentionRecipientCount'
  | 'visitedRecipientCount'
  | 'recipientDenominator'
  | 'metricsAvailability'
> {
  // Drafts cancelled before recipients were snapshotted have no trustworthy recipient graph.
  const metricsUnavailable =
    fact == null ||
    (fact.recipientCount === 0 &&
      row.status === 'CANCELLED' &&
      row.submittedAt == null);

  const recordedSendCount = fact?.sentCount ?? 0;
  const manualRecordedSendCount = fact?.manualSentCount ?? 0;
  const stillQueuedOrInProgressCount = fact
    ? fact.notYetQueuedCount + fact.queuedCount + fact.inPipelineCount
    : 0;

  return {
    recordedSendCount,
    manualRecordedSendCount,
    stillQueuedOrInProgressCount,
    intentionRecipientCount: metricsUnavailable ? null : intentions?.intentionRecipientCount ?? 0,
    visitedRecipientCount: metricsUnavailable ? null : intentions?.visitedRecipientCount ?? 0,
    recipientDenominator: metricsUnavailable ? null : fact?.recipientCount ?? 0,
    metricsAvailability: metricsUnavailable ? 'UNAVAILABLE' : 'AVAILABLE',
  };
}

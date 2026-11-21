import { Prisma } from '@salon/database';
import { isVipRegionCode, VIP_LIST_ROUND_SLOT_CAPACITY, VIP_REGION_CODES } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VIP_OPEN_REQUEST_STATUSES } from './admin-salon-profile.use-case';
import { VIP_RECIPIENT_EXECUTION_SQL, VIP_RECIPIENT_STOP_JOIN } from './vip-recipient-execution.sql';

export type VipListRequestCounts = {
  totalRequestCount: number;
  openRequestCount: number;
  liveRequestCount: number;
};

const BLOCKING_EXECUTION_STATUSES = ['SUBMITTED', 'MANUAL_QUEUED', 'BALE_NOT_IMPLEMENTED'] as const;

/**
 * A sample draft still blocks reuse at reservedUntil itself.
 * Only reservedUntil strictly before the evaluation time is expired.
 */
export function sampleReservationBlocksReuse(
  status: string,
  reservedUntil: Date,
  now: Date,
): boolean {
  return status === 'AWAITING_SAMPLE_WORK' && reservedUntil.getTime() >= now.getTime();
}

/** Live draft or submitted/processing execution. Cancelled and expired drafts do not block. */
export function liveRequestBlocksList(
  requests: readonly { status: string; reservedUntil: Date }[],
  now: Date,
): boolean {
  return requests.some(
    (request) =>
      (BLOCKING_EXECUTION_STATUSES as readonly string[]).includes(request.status)
      || sampleReservationBlocksReuse(request.status, request.reservedUntil, now),
  );
}

/**
 * Platform requestability. Admin availability is ACTIVE/IN_USE.
 * Round capacity is distinct occupying salons in reservation_round (< 5).
 * IN_USE is occupancy, not a closed door. Salon browse adds unresolved and
 * same-round occupying exclusions on top of this.
 */
export function isVipListRequestableBySalons(row: {
  status: string;
  catalogMembership: string | null;
  regionCode?: string | null;
  roundOccupiedCount: number;
}): boolean {
  const regionOk = typeof row.regionCode === 'string' && isVipRegionCode(row.regionCode);
  const catalogOk = row.catalogMembership === 'ORIGINAL_TEHRAN';
  if (!regionOk || !catalogOk || (row.status !== 'ACTIVE' && row.status !== 'IN_USE')) {
    return false;
  }
  return row.roundOccupiedCount < VIP_LIST_ROUND_SLOT_CAPACITY;
}

/**
 * Occupying work: an unexpired draft, or a submitted/processing request with any
 * recipient still not-yet-queued, queued, or in-pipeline. Fully terminal
 * recipient outcomes release the slot. A cancelled/expired draft does not occupy.
 */
export function vipRequestOccupyingSql(alias: string, now: Date) {
  const request = Prisma.raw(alias);
  return Prisma.sql`(
    (
      ${request}.status = 'AWAITING_SAMPLE_WORK'::"VipRequestStatus"
      AND ${request}.reserved_until >= ${now}
    )
    OR (
      ${request}.status IN (
        'SUBMITTED'::"VipRequestStatus",
        'MANUAL_QUEUED'::"VipRequestStatus",
        'BALE_NOT_IMPLEMENTED'::"VipRequestStatus"
      )
      AND EXISTS (
        SELECT 1
        FROM vip_request_recipients rec
        LEFT JOIN message_requests mr
          ON mr.id = rec.message_request_id
         AND mr.salon_id = rec.salon_id
        LEFT JOIN message_deliveries d
          ON d.message_request_id = mr.id
         AND d.salon_id = rec.salon_id
        ${VIP_RECIPIENT_STOP_JOIN}
        WHERE rec.vip_request_id = ${request}.id
          AND rec.salon_id = ${request}.salon_id
          AND ${VIP_RECIPIENT_EXECUTION_SQL} IN ('NOT_YET_QUEUED', 'QUEUED', 'IN_PIPELINE')
      )
    )
  )`;
}

/** Occupying slot: unresolved work in this list's current round. */
export function vipListOccupyingSlotSql(listId: Prisma.Sql, round: Prisma.Sql, now: Date) {
  return Prisma.sql`
    SELECT slot.salon_id
    FROM vip_list_round_slots slot
    INNER JOIN vip_requests r
      ON r.id = slot.vip_request_id
     AND r.salon_id = slot.salon_id
     AND r.list_id = slot.list_id
    WHERE slot.list_id = ${listId}
      AND slot.reservation_round = ${round}
      AND ${vipRequestOccupyingSql('r', now)}
  `;
}

export function vipListRoundOccupiedCountSql(listId: Prisma.Sql, round: Prisma.Sql, now: Date) {
  return Prisma.sql`(
    SELECT COUNT(*)::int
    FROM (${vipListOccupyingSlotSql(listId, round, now)}) occupied
  )`;
}

/**
 * A request is unresolved when the salon still has work on it:
 * an unexpired draft, or a submitted/processing request with any recipient
 * still not-yet-queued, queued, or in-pipeline. SENT, FAILED, CANCELLED, and
 * GLOBALLY_STOPPED are terminal. A cancelled draft is closed.
 */
export function vipRequestUnresolvedForSalonSql(
  listId: Prisma.Sql,
  salonId: string,
  now: Date,
  excludeRequestId?: string,
) {
  const exclude = excludeRequestId
    ? Prisma.sql`AND own.id <> ${excludeRequestId}::uuid`
    : Prisma.empty;
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM vip_requests own
    WHERE own.list_id = ${listId}
      AND own.salon_id = ${salonId}::uuid
      ${exclude}
      AND ${vipRequestOccupyingSql('own', now)}
  )`;
}

function vipListOwnCurrentRoundOccupyingSql(listId: Prisma.Sql, round: Prisma.Sql, salonId: string, now: Date) {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM (${vipListOccupyingSlotSql(listId, round, now)}) occupied
    WHERE occupied.salon_id = ${salonId}::uuid
  )`;
}

/**
 * Effective requestability for reads. Does not change stored status, expire
 * drafts, consume a slot, or alter a round.
 */
export function vipListEffectivelyAvailableSql(alias: string, now: Date, salonId?: string) {
  const column = Prisma.raw(alias);
  const ownExclusion = salonId
    ? Prisma.sql`
        AND NOT ${vipRequestUnresolvedForSalonSql(Prisma.sql`${column}.id`, salonId, now)}
        AND NOT ${vipListOwnCurrentRoundOccupyingSql(
          Prisma.sql`${column}.id`,
          Prisma.sql`${column}.reservation_round`,
          salonId,
          now,
        )}
      `
    : Prisma.empty;
  return Prisma.sql`(
    ${column}.catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership"
    AND ${column}.region_code IN (${Prisma.join([...VIP_REGION_CODES].map((code) => Prisma.sql`${code}`))})
    AND ${column}.status IN ('ACTIVE'::"VipTargetListStatus", 'IN_USE'::"VipTargetListStatus")
    AND ${vipListRoundOccupiedCountSql(
      Prisma.sql`${column}.id`,
      Prisma.sql`${column}.reservation_round`,
      now,
    )} < ${VIP_LIST_ROUND_SLOT_CAPACITY}
    ${ownExclusion}
  )`;
}

/** One grouped read for the lists already loaded on a page or detail. */
export async function loadEffectivelyRequestableListIds(
  prisma: PrismaService,
  listIds: string[],
  now: Date,
  salonId?: string,
): Promise<Set<string>> {
  const requestable = new Set<string>();
  if (listIds.length === 0) {
    return requestable;
  }
  const rows = await prisma.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT l.id::text AS id
    FROM vip_target_lists l
    WHERE l.id IN (${Prisma.join(listIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND ${vipListEffectivelyAvailableSql('l', now, salonId)}
  `);
  for (const row of rows) {
    requestable.add(row.id);
  }
  return requestable;
}

type CountRow = {
  listId: string;
  totalRequestCount: number;
  openRequestCount: number;
  liveRequestCount: number;
};

export async function loadVipListRequestCounts(
  prisma: PrismaService,
  listIds: string[],
  now = new Date(),
): Promise<Map<string, VipListRequestCounts>> {
  const counts = new Map<string, VipListRequestCounts>();
  if (listIds.length === 0) {
    return counts;
  }
  const rows = await prisma.client.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT
      r.list_id AS "listId",
      COUNT(*)::int AS "totalRequestCount",
      COUNT(*) FILTER (
        WHERE r.status::text IN (${Prisma.join([...VIP_OPEN_REQUEST_STATUSES])})
      )::int AS "openRequestCount",
      COUNT(*) FILTER (
        WHERE r.status::text IN ('SUBMITTED', 'MANUAL_QUEUED', 'BALE_NOT_IMPLEMENTED')
          OR (
            r.status::text = 'AWAITING_SAMPLE_WORK'
            AND r.reserved_until >= ${now}
          )
      )::int AS "liveRequestCount"
    FROM vip_requests r
    WHERE r.list_id IN (${Prisma.join(listIds.map((id) => Prisma.sql`${id}::uuid`))})
    GROUP BY r.list_id
  `);
  for (const row of rows) {
    counts.set(row.listId, {
      totalRequestCount: Number(row.totalRequestCount),
      openRequestCount: Number(row.openRequestCount),
      liveRequestCount: Number(row.liveRequestCount),
    });
  }
  return counts;
}

export type VipListRoundFacts = {
  reservationRound: number;
  roundOccupiedCount: number;
  roundRemainingSlots: number;
};

export async function loadVipListRoundFacts(
  prisma: PrismaService,
  listIds: string[],
  now = new Date(),
): Promise<Map<string, VipListRoundFacts>> {
  const facts = new Map<string, VipListRoundFacts>();
  if (listIds.length === 0) {
    return facts;
  }
  const rows = await prisma.client.$queryRaw<
    Array<{ id: string; reservationRound: number; occupied: number }>
  >(Prisma.sql`
    SELECT
      l.id::text AS id,
      l.reservation_round AS "reservationRound",
      ${vipListRoundOccupiedCountSql(Prisma.sql`l.id`, Prisma.sql`l.reservation_round`, now)} AS occupied
    FROM vip_target_lists l
    WHERE l.id IN (${Prisma.join(listIds.map((id) => Prisma.sql`${id}::uuid`))})
  `);
  for (const row of rows) {
    const occupied = Number(row.occupied);
    facts.set(row.id, {
      reservationRound: Number(row.reservationRound),
      roundOccupiedCount: occupied,
      roundRemainingSlots: Math.max(0, VIP_LIST_ROUND_SLOT_CAPACITY - occupied),
    });
  }
  return facts;
}

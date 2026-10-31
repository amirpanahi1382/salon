import { Prisma } from '@salon/database';
import { isVipRegionCode, VIP_REGION_CODES } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VIP_OPEN_REQUEST_STATUSES } from './admin-salon-profile.use-case';

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
 * Platform requestability. Stored status stays separate.
 * A free list is requestable when nothing live blocks it: ACTIVE also needs no
 * reservation owner, and IN_USE with only an expired hold is included.
 * A list that already has a live request is requestable only while an admin
 * opening is waiting. Salon browse adds its own exclusion on top of this.
 */
export function isVipListRequestableBySalons(row: {
  status: string;
  reservedBySalonId: string | null;
  catalogMembership: string | null;
  regionCode?: string | null;
  blockedByLiveRequest: boolean;
  nextReservationOpen?: boolean;
}): boolean {
  const regionOk = typeof row.regionCode === 'string' && isVipRegionCode(row.regionCode);
  const catalogOk = row.catalogMembership === 'ORIGINAL_TEHRAN';
  if (!regionOk || !catalogOk || (row.status !== 'ACTIVE' && row.status !== 'IN_USE')) {
    return false;
  }
  if (row.blockedByLiveRequest) {
    return row.nextReservationOpen === true;
  }
  if (row.status === 'ACTIVE') {
    return row.reservedBySalonId === null;
  }
  return true;
}

export function salonRequestableListWhere(regionCode: string) {
  return {
    regionCode,
    status: 'ACTIVE' as const,
    catalogMembership: 'ORIGINAL_TEHRAN' as const,
    reservedBySalonId: null,
  };
}

export const VIP_LIST_REQUESTABLE_SQL = Prisma.sql`
  status = 'ACTIVE'
  AND catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership"
  AND reserved_by_salon_id IS NULL
  AND region_code IN (${Prisma.join([...VIP_REGION_CODES].map((code) => Prisma.sql`${code}`))})
`;

/** Same blocking boundary as sampleReservationBlocksReuse. reservedUntil >= now still blocks. */
export function vipListBlockingRequestSql(listId: Prisma.Sql, now: Date) {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM vip_requests live
    WHERE live.list_id = ${listId}
      AND (
        live.status IN (
          'SUBMITTED'::"VipRequestStatus",
          'MANUAL_QUEUED'::"VipRequestStatus",
          'BALE_NOT_IMPLEMENTED'::"VipRequestStatus"
        )
        OR (
          live.status = 'AWAITING_SAMPLE_WORK'::"VipRequestStatus"
          AND live.reserved_until >= ${now}
        )
      )
  )`;
}

/**
 * Effective requestability for reads. Does not change stored status.
 * Reservation still expires and then updates only an ACTIVE unreserved row.
 */
export function vipListEffectivelyAvailableSql(alias: string, now: Date, salonId?: string) {
  const column = Prisma.raw(alias);
  const ownRequest = salonId
    ? Prisma.sql`AND NOT ${vipListBlockingRequestSqlForSalon(Prisma.sql`${column}.id`, salonId, now)}`
    : Prisma.empty;
  return Prisma.sql`(
    ${column}.catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership"
    AND ${column}.region_code IN (${Prisma.join([...VIP_REGION_CODES].map((code) => Prisma.sql`${code}`))})
    AND ${column}.status IN ('ACTIVE'::"VipTargetListStatus", 'IN_USE'::"VipTargetListStatus")
    ${ownRequest}
    AND (
      (
        NOT ${vipListBlockingRequestSql(Prisma.sql`${column}.id`, now)}
        AND (
          (
            ${column}.status = 'ACTIVE'::"VipTargetListStatus"
            AND ${column}.reserved_by_salon_id IS NULL
          )
          OR ${column}.status = 'IN_USE'::"VipTargetListStatus"
        )
      )
      OR (
        ${column}.next_reservation_open = true
        AND ${vipListBlockingRequestSql(Prisma.sql`${column}.id`, now)}
      )
    )
  )`;
}

function vipListBlockingRequestSqlForSalon(listId: Prisma.Sql, salonId: string, now: Date) {
  return Prisma.sql`EXISTS (
    SELECT 1
    FROM vip_requests own
    WHERE own.list_id = ${listId}
      AND own.salon_id = ${salonId}::uuid
      AND (
        own.status IN (
          'SUBMITTED'::"VipRequestStatus",
          'MANUAL_QUEUED'::"VipRequestStatus",
          'BALE_NOT_IMPLEMENTED'::"VipRequestStatus"
        )
        OR (
          own.status = 'AWAITING_SAMPLE_WORK'::"VipRequestStatus"
          AND own.reserved_until >= ${now}
        )
      )
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

import { Prisma } from '@prisma/client';

/**
 * Cancels overdue VIP sample-work drafts and releases lists that no longer
 * have a live request. A live request is AWAITING_SAMPLE_WORK (even if overdue),
 * SUBMITTED, MANUAL_QUEUED, or BALE_NOT_IMPLEMENTED.
 *
 * Platform mode may scan every salon and is the background owner.
 * Salon mode is limited to that salon's drafts, plus one explicitly named list
 * when a new reservation must reclaim an overdue hold. It does not sweep other lists.
 *
 * Conditional updates keep a concurrent submit or reserve from losing its row.
 * This does not write audit or outbox rows: draft expiry has never done so.
 * Region and catalog columns are not updated.
 */
export type VipReservationExpiryScope =
  | { mode: 'platform'; limit: number }
  | { mode: 'salon'; salonId: string; listId?: string };

type ExpiryDb = Pick<Prisma.TransactionClient, '$queryRaw'>;

const LIVE_REQUEST_SQL = Prisma.sql`
  live.status IN (
    'AWAITING_SAMPLE_WORK'::"VipRequestStatus",
    'SUBMITTED'::"VipRequestStatus",
    'MANUAL_QUEUED'::"VipRequestStatus",
    'BALE_NOT_IMPLEMENTED'::"VipRequestStatus"
  )
`;

export async function expireStaleVipReservations(
  db: ExpiryDb,
  now: Date,
  scope: VipReservationExpiryScope,
): Promise<{ cancelledRequests: number; releasedLists: number }> {
  const limit = scope.mode === 'platform' ? scope.limit : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('VIP reservation expiry batch is out of range');
  }
  const requestScope = scope.mode === 'platform'
    ? Prisma.sql`TRUE`
    : scope.listId
      ? Prisma.sql`(salon_id = ${scope.salonId}::uuid OR list_id = ${scope.listId}::uuid)`
      : Prisma.sql`salon_id = ${scope.salonId}::uuid`;
  const listScope = scope.mode === 'platform'
    ? Prisma.sql`TRUE`
    : scope.listId
      ? Prisma.sql`(l.reserved_by_salon_id = ${scope.salonId}::uuid OR l.id = ${scope.listId}::uuid)`
      : Prisma.sql`l.reserved_by_salon_id = ${scope.salonId}::uuid`;
  const lock = scope.mode === 'platform' ? Prisma.sql`SKIP LOCKED` : Prisma.empty;

  const cancelled = await db.$queryRaw<Array<{ id: string }>>`
    WITH doomed AS (
      SELECT id
      FROM vip_requests
      WHERE status = 'AWAITING_SAMPLE_WORK'::"VipRequestStatus"
        AND reserved_until < ${now}
        AND ${requestScope}
      ORDER BY reserved_until, id
      LIMIT ${limit}
      FOR UPDATE ${lock}
    )
    UPDATE vip_requests AS r
    SET status = 'CANCELLED'::"VipRequestStatus",
        cancelled_at = ${now},
        updated_at = ${now}
    FROM doomed
    WHERE r.id = doomed.id
      AND r.status = 'AWAITING_SAMPLE_WORK'::"VipRequestStatus"
      AND r.reserved_until < ${now}
    RETURNING r.id
  `;

  const released = await db.$queryRaw<Array<{ id: string }>>`
    WITH releasable AS (
      SELECT l.id
      FROM vip_target_lists l
      WHERE l.status = 'IN_USE'::"VipTargetListStatus"
        AND ${listScope}
        AND NOT EXISTS (
          SELECT 1
          FROM vip_requests live
          WHERE live.list_id = l.id
            AND ${LIVE_REQUEST_SQL}
        )
      ORDER BY l.updated_at, l.id
      LIMIT ${limit}
      FOR UPDATE OF l ${lock}
    )
    UPDATE vip_target_lists AS l
    SET status = 'ACTIVE'::"VipTargetListStatus",
        reserved_by_salon_id = NULL,
        reserved_at = NULL,
        next_reservation_open = false,
        updated_at = ${now}
    FROM releasable
    WHERE l.id = releasable.id
      AND l.status = 'IN_USE'::"VipTargetListStatus"
      AND NOT EXISTS (
        SELECT 1
        FROM vip_requests live
        WHERE live.list_id = l.id
          AND ${LIVE_REQUEST_SQL}
      )
    RETURNING l.id
  `;

  return { cancelledRequests: cancelled.length, releasedLists: released.length };
}

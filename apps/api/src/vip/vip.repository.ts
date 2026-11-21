import { Injectable } from '@nestjs/common';
import { Prisma, expireStaleVipReservations, type VipReservationExpiryScope } from '@salon/database';
import {
  VIP_ACTIVE_DRAFT_STATUS,
  VIP_IN_PROGRESS_STATUSES,
  VIP_LIST_ROUND_SLOT_CAPACITY,
  VIP_QUOTA_WINDOW_DAYS,
  VIP_REGION_CODES,
  VIP_REGIONS,
  VIP_RESERVATION_TTL_MS,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  vipListEffectivelyAvailableSql,
  vipListRoundOccupiedCountSql,
  vipRequestOccupyingSql,
  vipRequestUnresolvedForSalonSql,
} from './vip-list-request-counts';
import {
  VIP_RECIPIENT_PROGRESS_COUNTS,
  VIP_RECIPIENT_STOP_JOIN,
} from './vip-recipient-execution.sql';

type Db = Prisma.TransactionClient | PrismaService['client'];

const inProgressStatuses: Array<(typeof VIP_IN_PROGRESS_STATUSES)[number]> = [
  ...VIP_IN_PROGRESS_STATUSES,
];

const LIST_SUMMARY_SELECT = {
  id: true,
  name: true,
  regionCode: true,
  status: true,
  catalogMembership: true,
  contactCount: true,
  nextReservationOpen: true,
  reservationRound: true,
  reservedBySalonId: true,
  reservedBySalon: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
  requests: {
    where: { status: { in: inProgressStatuses } },
    select: { id: true },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
};

@Injectable()
export class VipRepository {
  constructor(private readonly prisma: PrismaService) {}

  get client() {
    return this.prisma.client;
  }

  findListById(id: string, db: Db = this.prisma.client) {
    return db.vipTargetList.findUnique({
      where: { id },
      select: LIST_SUMMARY_SELECT,
    });
  }

  listLists(input: {
    cursor?: { createdAt: Date; id: string };
    catalogMembership?: 'ORIGINAL_TEHRAN';
    take?: number;
  }) {
    const membership = input.catalogMembership
      ? { catalogMembership: input.catalogMembership }
      : {};
    return this.prisma.client.vipTargetList.findMany({
      where: {
        ...membership,
        ...(input.cursor
          ? {
              OR: [
                { createdAt: { lt: input.cursor.createdAt } },
                { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
              ],
            }
          : {}),
      },
      select: LIST_SUMMARY_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.take ?? 51,
    });
  }

  summarizeLists(catalogMembership?: 'ORIGINAL_TEHRAN') {
    const where = catalogMembership ? { catalogMembership } : {};
    return Promise.all([
      this.prisma.client.vipTargetList.aggregate({
        where,
        _count: { _all: true },
        _sum: { contactCount: true },
      }),
      this.prisma.client.vipTargetContact.count({ where: { list: where } }),
    ]).then(([totals, contactRowCount]) => ({
      listCount: totals._count._all,
      recordedContactCount: totals._sum.contactCount ?? 0,
      contactRowCount,
    }));
  }

  listActiveLists() {
    return this.prisma.client.vipTargetList.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, status: true, contactCount: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  listActiveListsByRegion(regionCode: string, salonId: string, now = new Date(), packageGroup?: number) {
    const groupFilter = packageGroup
      ? Prisma.sql`AND usable.package_group = ${packageGroup}`
      : Prisma.empty;
    return this.prisma.client.$queryRaw<Array<{
      id: string;
      name: string;
      regionCode: string | null;
      status: string;
      contactCount: number;
      sendableContactCount: number;
      packageGroup: number | null;
      createdAt: Date;
    }>>`
      SELECT
        l.id,
        l.name,
        l.region_code AS "regionCode",
        l.status::text AS status,
        l.contact_count AS "contactCount",
        usable.sendable AS "sendableContactCount",
        usable.package_group AS "packageGroup",
        l.created_at AS "createdAt"
      FROM vip_target_lists l
      JOIN LATERAL (
        SELECT
          COUNT(*)::int AS sendable,
          CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN COUNT(*) < 30 THEN 30
            WHEN abs(COUNT(*) - 30) < abs(COUNT(*) - 50)
              AND abs(COUNT(*) - 30) < abs(COUNT(*) - 100) THEN 30
            WHEN abs(COUNT(*) - 50) < abs(COUNT(*) - 100) THEN 50
            WHEN abs(COUNT(*) - 50) = abs(COUNT(*) - 100) THEN 100
            WHEN abs(COUNT(*) - 100) <= abs(COUNT(*) - 50) THEN 100
            ELSE 50
          END AS package_group
        FROM vip_target_contacts c
        WHERE c.list_id = l.id
          AND NOT EXISTS (
            SELECT 1 FROM platform_message_stops s
            WHERE s.phone_number = c.phone_number AND s.active = true
          )
      ) usable ON true
      WHERE l.region_code = ${regionCode}
        AND ${vipListEffectivelyAvailableSql('l', now, salonId)}
        ${groupFilter}
      ORDER BY l.created_at DESC, l.id DESC
    `;
  }

  summarizeAvailableRegions(salonId: string, now = new Date()) {
    const catalog = VIP_REGIONS.map(
      (row, index) => Prisma.sql`(${row.code}::text, ${row.name}::text, ${index}::int)`,
    );
    return this.prisma.client.$queryRaw<
      Array<{
        regionCode: string;
        regionName: string;
        availableListCount: number;
        availableContactCount: number;
      }>
    >`
      WITH catalog(code, name, sort) AS (
        VALUES ${Prisma.join(catalog)}
      )
      SELECT
        c.code AS "regionCode",
        c.name AS "regionName",
        COUNT(l.id)::int AS "availableListCount",
        COALESCE((
          SELECT COUNT(*)::int
          FROM vip_target_contacts ct
          JOIN vip_target_lists listed ON listed.id = ct.list_id
          WHERE listed.region_code = c.code
            AND ${vipListEffectivelyAvailableSql('listed', now, salonId)}
            AND NOT EXISTS (
              SELECT 1
              FROM platform_message_stops s
              WHERE s.phone_number = ct.phone_number
                AND s.active = true
            )
        ), 0) AS "availableContactCount"
      FROM catalog c
      LEFT JOIN vip_target_lists l
        ON l.region_code = c.code
       AND ${vipListEffectivelyAvailableSql('l', now, salonId)}
      GROUP BY c.code, c.name, c.sort
      ORDER BY c.sort
    `;
  }

  listContacts(listId: string, db: Db = this.prisma.client) {
    return db.vipTargetContact.findMany({
      where: { listId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, displayName: true, phoneNumber: true, sortOrder: true },
    });
  }

  selectContacts(listId: string, count: number, db: Db = this.prisma.client) {
    return db.$queryRaw<Array<{
      id: string;
      displayName: string | null;
      phoneNumber: string;
      sortOrder: number;
    }>>`
      SELECT c.id,
             c.display_name AS "displayName",
             c.phone_number AS "phoneNumber",
             c.sort_order AS "sortOrder"
      FROM vip_target_contacts c
      WHERE c.list_id = ${listId}::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM platform_message_stops s
          WHERE s.phone_number = c.phone_number
            AND s.active = true
        )
      ORDER BY c.sort_order ASC, c.id ASC
      LIMIT ${count}
    `;
  }

  async sendableContactCounts(listIds: string[], db: Db = this.prisma.client): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (listIds.length === 0) return counts;
    const rows = await db.$queryRaw<Array<{ listId: string; sendable: number }>>`
      SELECT c.list_id AS "listId", COUNT(*)::int AS sendable
      FROM vip_target_contacts c
      WHERE c.list_id IN (${Prisma.join(listIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND NOT EXISTS (
          SELECT 1
          FROM platform_message_stops s
          WHERE s.phone_number = c.phone_number
            AND s.active = true
        )
      GROUP BY c.list_id
    `;
    for (const row of rows) counts.set(row.listId, row.sendable);
    return counts;
  }

  /**
   * Owning draft-expiry write. Callers must pass salon scope on a tenant command
   * or platform scope from the background worker. Reads do not call this.
   */
  async expireStaleReservations(
    now: Date,
    db: Db,
    scope: VipReservationExpiryScope,
  ): Promise<{ cancelledRequests: number; releasedLists: number }> {
    return expireStaleVipReservations(db, now, scope);
  }

  async lockEntitlement(tx: Prisma.TransactionClient, salonId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; revoked_at: Date | null }>>`
      SELECT id, revoked_at
      FROM vip_salon_entitlements
      WHERE salon_id = ${salonId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  /**
   * Stored quota excludes CANCELLED. When `evaluatedAt` is set, an overdue
   * sample draft also does not consume quota. That read does not cancel the row.
   */
  async quotaUsedSince(db: Db, salonId: string, since: Date, evaluatedAt?: Date) {
    const effectiveDraft = evaluatedAt
      ? Prisma.sql`AND NOT (
          status = 'AWAITING_SAMPLE_WORK'::"VipRequestStatus"
          AND reserved_until < ${evaluatedAt}
        )`
      : Prisma.empty;
    const rows = await db.$queryRaw<Array<{ used: bigint }>>`
      SELECT COALESCE(SUM(requested_count), 0) AS used
      FROM vip_requests
      WHERE salon_id = ${salonId}::uuid
        AND status <> 'CANCELLED'::"VipRequestStatus"
        AND created_at >= ${since}
        ${effectiveDraft}
    `;
    return Number(rows[0]?.used ?? 0);
  }

  async classifyReserveFailure(
    tx: Db,
    listId: string,
    salonId: string,
    now: Date,
    excludeRequestId?: string,
  ): Promise<'OWN_UNRESOLVED' | 'CAPACITY' | 'ADMIN_DISABLED' | 'UNAVAILABLE'> {
    const list = await tx.vipTargetList.findUnique({
      where: { id: listId },
      select: {
        status: true,
        catalogMembership: true,
        regionCode: true,
        reservationRound: true,
      },
    });
    if (!list) {
      return 'UNAVAILABLE';
    }
    if (list.status === 'INACTIVE' || list.status === 'PENDING') {
      return 'ADMIN_DISABLED';
    }
    const unresolved = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT ${vipRequestUnresolvedForSalonSql(Prisma.sql`${listId}::uuid`, salonId, now, excludeRequestId)} AS ok
    `;
    if (unresolved[0]?.ok) {
      return 'OWN_UNRESOLVED';
    }
    const occupied = await tx.$queryRaw<Array<{ count: number }>>`
      SELECT ${vipListRoundOccupiedCountSql(
        Prisma.sql`${listId}::uuid`,
        Prisma.sql`${list.reservationRound}`,
        now,
      )} AS count
    `;
    if (Number(occupied[0]?.count ?? 0) >= VIP_LIST_ROUND_SLOT_CAPACITY) {
      return 'CAPACITY';
    }
    return 'UNAVAILABLE';
  }

  /**
   * Atomically take one round slot and mark the list occupied.
   * Caller must lock the list row and create the VipRequest with the same id.
   */
  async tryReserveList(
    tx: Prisma.TransactionClient,
    listId: string,
    salonId: string,
    requestId: string,
    now: Date,
  ): Promise<boolean> {
    const slotted = await tx.$queryRaw<Array<{ slotNo: number }>>`
      INSERT INTO vip_list_round_slots (
        list_id, reservation_round, slot_no, salon_id, vip_request_id, created_at
      )
      SELECT
        ${listId}::uuid,
        l.reservation_round,
        n.slot_no,
        ${salonId}::uuid,
        ${requestId}::uuid,
        ${now}
      FROM vip_target_lists l
      INNER JOIN LATERAL (
        SELECT s.n AS slot_no
        FROM generate_series(1, ${VIP_LIST_ROUND_SLOT_CAPACITY}) AS s(n)
        WHERE NOT EXISTS (
          SELECT 1
          FROM vip_list_round_slots taken
          WHERE taken.list_id = l.id
            AND taken.reservation_round = l.reservation_round
            AND taken.slot_no = s.n
        )
        ORDER BY s.n
        LIMIT 1
      ) n ON true
      WHERE l.id = ${listId}::uuid
        AND l.catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership"
        AND l.region_code IN (${Prisma.join([...VIP_REGION_CODES].map((code) => Prisma.sql`${code}`))})
        AND l.status IN ('ACTIVE'::"VipTargetListStatus", 'IN_USE'::"VipTargetListStatus")
        AND NOT ${vipRequestUnresolvedForSalonSql(Prisma.sql`${listId}::uuid`, salonId, now, requestId)}
        AND ${vipListRoundOccupiedCountSql(
          Prisma.sql`l.id`,
          Prisma.sql`l.reservation_round`,
          now,
        )} < ${VIP_LIST_ROUND_SLOT_CAPACITY}
        AND NOT EXISTS (
          SELECT 1
          FROM vip_list_round_slots slot
          INNER JOIN vip_requests r
            ON r.id = slot.vip_request_id
           AND r.salon_id = slot.salon_id
          WHERE slot.list_id = l.id
            AND slot.salon_id = ${salonId}::uuid
            AND slot.reservation_round = l.reservation_round
            AND slot.vip_request_id <> ${requestId}::uuid
            AND ${vipRequestOccupyingSql('r', now)}
        )
      RETURNING slot_no AS "slotNo"
    `;
    if (slotted.length !== 1) {
      return false;
    }
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE vip_target_lists
      SET
        status = 'IN_USE',
        reserved_by_salon_id = ${salonId}::uuid,
        reserved_at = ${now},
        next_reservation_open = false,
        updated_at = ${now}
      WHERE id = ${listId}::uuid
        AND catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership"
        AND region_code IN (${Prisma.join([...VIP_REGION_CODES].map((code) => Prisma.sql`${code}`))})
        AND status IN ('ACTIVE'::"VipTargetListStatus", 'IN_USE'::"VipTargetListStatus")
      RETURNING id
    `;
    return updated.length === 1;
  }

  /**
   * Turn admin availability on. Occupied IN_USE rows stay IN_USE with their
   * reserver pointer. Existing requests are not cancelled. A canonical region
   * already stored on the row is kept.
   */
  async tryActivateUnreservedList(
    tx: Prisma.TransactionClient,
    input: { id: string; regionCode: string; name?: string; now: Date },
  ): Promise<boolean> {
    const canonicalRegions = () =>
      Prisma.join([...VIP_REGION_CODES].map((code) => Prisma.sql`${code}`));
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE vip_target_lists
      SET
        status = CASE
          WHEN reserved_by_salon_id IS NOT NULL THEN 'IN_USE'::"VipTargetListStatus"
          ELSE 'ACTIVE'::"VipTargetListStatus"
        END,
        region_code = CASE
          WHEN region_code IN (${canonicalRegions()}) THEN region_code
          ELSE ${input.regionCode}
        END,
        catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership",
        ${input.name ? Prisma.sql`name = ${input.name},` : Prisma.sql``}
        updated_at = ${input.now}
      WHERE id = ${input.id}::uuid
        AND status IN ('PENDING', 'INACTIVE', 'ACTIVE', 'IN_USE')
        AND (
          region_code IS NULL
          OR region_code NOT IN (${canonicalRegions()})
          OR region_code = ${input.regionCode}
        )
      RETURNING id
    `;
    return updated.length === 1;
  }

  /** Delete slot rows whose requests no longer occupy (resolved, cancelled, expired). */
  async releaseResolvedRoundSlots(
    tx: Prisma.TransactionClient,
    now: Date,
    listId?: string,
  ): Promise<number> {
    const listFilter = listId ? Prisma.sql`AND slot.list_id = ${listId}::uuid` : Prisma.empty;
    const deleted = await tx.$executeRaw`
      DELETE FROM vip_list_round_slots slot
      USING vip_requests r
      WHERE slot.vip_request_id = r.id
        AND slot.salon_id = r.salon_id
        AND slot.list_id = r.list_id
        ${listFilter}
        AND NOT ${vipRequestOccupyingSql('r', now)}
    `;
    return Number(deleted);
  }

  /**
   * Start a new reservation round. Existing requests and slots stay on the
   * previous round. Occupied or exhausted lists may be opened; empty unused
   * lists are left unchanged.
   */
  async tryOpenNextReservation(
    tx: Prisma.TransactionClient,
    listId: string,
    now: Date,
  ): Promise<boolean> {
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE vip_target_lists
      SET reservation_round = reservation_round + 1,
          next_reservation_open = false,
          updated_at = ${now}
      WHERE id = ${listId}::uuid
        AND catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership"
        AND region_code IN (${Prisma.join([...VIP_REGION_CODES].map((code) => Prisma.sql`${code}`))})
        AND status IN ('ACTIVE'::"VipTargetListStatus", 'IN_USE'::"VipTargetListStatus")
        AND (
          ${vipListRoundOccupiedCountSql(
            Prisma.sql`${listId}::uuid`,
            Prisma.sql`vip_target_lists.reservation_round`,
            now,
          )} > 0
          OR EXISTS (
            SELECT 1 FROM vip_list_round_slots slot
            WHERE slot.list_id = ${listId}::uuid
              AND slot.reservation_round = vip_target_lists.reservation_round
          )
        )
      RETURNING id
    `;
    return updated.length === 1;
  }

  /**
   * Deactivation stops new reservations, including an open grant.
   * Existing requests stay. Reservation columns are cleared because a
   * non-IN_USE row cannot keep them. Request rows remain the occupancy record.
   */
  async tryDeactivateUnreservedList(
    tx: Prisma.TransactionClient,
    input: { id: string; name?: string; now: Date },
  ): Promise<boolean> {
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE vip_target_lists
      SET
        status = 'INACTIVE',
        next_reservation_open = false,
        reserved_by_salon_id = NULL,
        reserved_at = NULL,
        ${input.name ? Prisma.sql`name = ${input.name},` : Prisma.sql``}
        updated_at = ${input.now}
      WHERE id = ${input.id}::uuid
        AND status IN ('PENDING', 'INACTIVE', 'ACTIVE', 'IN_USE')
      RETURNING id
    `;
    return updated.length === 1;
  }

  reservationDeadline(now: Date): Date {
    return new Date(now.getTime() + VIP_RESERVATION_TTL_MS);
  }

  quotaWindowStart(now: Date): Date {
    return new Date(now.getTime() - VIP_QUOTA_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }

  findRequestForSalon(salonId: string, id: string, db: Db = this.prisma.client) {
    return db.vipRequest.findFirst({
      where: { id, salonId },
      include: {
        salon: { select: { name: true } },
        list: { select: { name: true } },
        sampleWorks: { orderBy: { position: 'asc' } },
      },
    });
  }

  findRequestById(id: string, db: Db = this.prisma.client) {
    return db.vipRequest.findUnique({
      where: { id },
      include: {
        salon: { select: { name: true } },
        list: { select: { name: true } },
        sampleWorks: { orderBy: { position: 'asc' } },
      },
    });
  }

  findActiveDraft(salonId: string, db: Db = this.prisma.client) {
    return db.vipRequest.findFirst({
      where: { salonId, status: VIP_ACTIVE_DRAFT_STATUS },
      orderBy: { createdAt: 'desc' },
      include: {
        salon: { select: { name: true } },
        list: { select: { name: true } },
        sampleWorks: { orderBy: { position: 'asc' } },
      },
    });
  }

  findLatestCancelledRequest(salonId: string, db: Db = this.prisma.client) {
    return db.vipRequest.findFirst({
      where: { salonId, status: 'CANCELLED' },
      orderBy: [{ cancelledAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        salonId: true,
        listId: true,
        requestedCount: true,
        geographicRange: true,
        discountKind: true,
        discountAmount: true,
        status: true,
        reservedUntil: true,
        submittedAt: true,
        createdAt: true,
        salon: { select: { name: true } },
        list: { select: { name: true } },
      },
    });
  }

  listInProgressRequests(salonId: string, take: number, db: Db = this.prisma.client) {
    return db.vipRequest.findMany({
      where: { salonId, status: { in: inProgressStatuses } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        salonId: true,
        listId: true,
        requestedCount: true,
        geographicRange: true,
        discountKind: true,
        discountAmount: true,
        status: true,
        reservedUntil: true,
        submittedAt: true,
        createdAt: true,
        salon: { select: { name: true } },
        list: { select: { name: true } },
      },
    });
  }

  async recipientProgressFacts(salonId: string, requestIds: string[], db: Db = this.prisma.client) {
    const facts = new Map<string, SalonVipProgressFact>();
    if (requestIds.length === 0) return facts;
    const rows = await db.$queryRaw<SalonVipProgressFact[]>`
      SELECT
        r.id,
        r.status,
        r.created_at AS "createdAt",
        r.reserved_until AS "reservedUntil",
        r.submitted_at AS "submittedAt",
        r.cancelled_at AS "cancelledAt",
        r.requested_count AS "requestedCount",
        ${VIP_RECIPIENT_PROGRESS_COUNTS}
      FROM vip_requests r
      LEFT JOIN vip_request_recipients rec ON rec.vip_request_id = r.id AND rec.salon_id = r.salon_id
      LEFT JOIN message_requests mr ON mr.id = rec.message_request_id AND mr.salon_id = r.salon_id
      LEFT JOIN message_deliveries d ON d.message_request_id = mr.id AND d.salon_id = r.salon_id
      ${VIP_RECIPIENT_STOP_JOIN}
      WHERE r.salon_id = ${salonId}::uuid
        AND r.id IN (${Prisma.join(requestIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY r.id
    `;
    for (const row of rows) facts.set(row.id, row);
    return facts;
  }

  findActiveEntitlement(salonId: string, db: Db = this.prisma.client) {
    return db.vipSalonEntitlement.findFirst({
      where: { salonId, revokedAt: null },
    });
  }
}

export type SalonVipProgressFact = {
  id: string;
  status: string;
  createdAt: Date;
  reservedUntil: Date;
  submittedAt: Date | null;
  cancelledAt: Date | null;
  requestedCount: number;
  recipientCount: number;
  notYetQueuedCount: number;
  queuedCount: number;
  inPipelineCount: number;
  sentCount: number;
  manualSentCount: number;
  failedCount: number;
  cancelledCount: number;
  globallyStoppedCount: number;
  activeStopWithoutDurableSkipCount: number;
  latestManualSentAt: Date | null;
};

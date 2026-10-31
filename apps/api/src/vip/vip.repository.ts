import { Injectable } from '@nestjs/common';
import { Prisma, expireStaleVipReservations, type VipReservationExpiryScope } from '@salon/database';
import {
  VIP_ACTIVE_DRAFT_STATUS,
  VIP_IN_PROGRESS_STATUSES,
  VIP_QUOTA_WINDOW_DAYS,
  VIP_REGION_CODES,
  VIP_REGIONS,
  VIP_RESERVATION_TTL_MS,
} from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  vipListBlockingRequestSql,
  vipListEffectivelyAvailableSql,
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

  async tryReserveList(
    tx: Prisma.TransactionClient,
    listId: string,
    salonId: string,
    now: Date,
  ): Promise<boolean> {
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
        AND NOT EXISTS (
          SELECT 1 FROM vip_requests own
          WHERE own.list_id = ${listId}::uuid
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
        )
        AND (
          (
            NOT ${vipListBlockingRequestSql(Prisma.sql`${listId}::uuid`, now)}
            AND (
              (status = 'ACTIVE'::"VipTargetListStatus" AND reserved_by_salon_id IS NULL)
              OR status = 'IN_USE'::"VipTargetListStatus"
            )
          )
          OR next_reservation_open = true
        )
      RETURNING id
    `;
    return updated.length === 1;
  }

  /**
   * Activate only if the list is still unreserved. Does not clear reservation fields.
   * A canonical region already stored on the row is kept. A different canonical region
   * matches no row, so a write that started from a stale pre-read cannot replace it.
   * Returns false when the list is IN_USE, reserved, missing, region-locked, or not activatable.
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
        status = 'ACTIVE',
        region_code = CASE
          WHEN region_code IN (${canonicalRegions()}) THEN region_code
          ELSE ${input.regionCode}
        END,
        catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership",
        ${input.name ? Prisma.sql`name = ${input.name},` : Prisma.sql``}
        updated_at = ${input.now}
      WHERE id = ${input.id}::uuid
        AND status IN ('PENDING', 'INACTIVE', 'ACTIVE')
        AND reserved_by_salon_id IS NULL
        AND (
          region_code IS NULL
          OR region_code NOT IN (${canonicalRegions()})
          OR region_code = ${input.regionCode}
        )
      RETURNING id
    `;
    return updated.length === 1;
  }

  /**
   * One explicit opening for the next reservation. Does not clear the current
   * reserver or change existing requests. A second call while the flag is
   * already true matches no row.
   */
  async tryOpenNextReservation(
    tx: Prisma.TransactionClient,
    listId: string,
    now: Date,
  ): Promise<boolean> {
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE vip_target_lists
      SET next_reservation_open = true,
          updated_at = ${now}
      WHERE id = ${listId}::uuid
        AND next_reservation_open = false
        AND catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership"
        AND region_code IN (${Prisma.join([...VIP_REGION_CODES].map((code) => Prisma.sql`${code}`))})
        AND status IN ('ACTIVE'::"VipTargetListStatus", 'IN_USE'::"VipTargetListStatus")
        AND ${vipListBlockingRequestSql(Prisma.sql`${listId}::uuid`, now)}
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

import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import { VIP_QUOTA_WINDOW_DAYS, VIP_REGIONS, VIP_RESERVATION_TTL_MS } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';

type Db = Prisma.TransactionClient | PrismaService['client'];

const LIST_SUMMARY_SELECT = {
  id: true,
  name: true,
  status: true,
  catalogMembership: true,
  contactCount: true,
  reservedBySalonId: true,
  reservedBySalon: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
  requests: {
    where: { status: { in: ['SUBMITTED', 'MANUAL_QUEUED', 'BALE_NOT_IMPLEMENTED'] as Array<'SUBMITTED' | 'MANUAL_QUEUED' | 'BALE_NOT_IMPLEMENTED'> } },
    select: { id: true },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} as const;

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

  listActiveListsByRegion(regionCode: string) {
    return this.prisma.client.vipTargetList.findMany({
      where: { regionCode, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        regionCode: true,
        status: true,
        contactCount: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  summarizeAvailableRegions() {
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
        COALESCE(SUM(l.contact_count), 0)::int AS "availableContactCount"
      FROM catalog c
      LEFT JOIN vip_target_lists l
        ON l.region_code = c.code
       AND l.status = 'ACTIVE'
       AND l.reserved_by_salon_id IS NULL
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
    return db.vipTargetContact.findMany({
      where: { listId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: count,
      select: { id: true, displayName: true, phoneNumber: true, sortOrder: true },
    });
  }

  async expireStaleReservations(now: Date, db: Db): Promise<void> {
    const stale = await db.vipRequest.findMany({
      where: {
        status: 'AWAITING_SAMPLE_WORK',
        reservedUntil: { lt: now },
      },
      select: { id: true, listId: true, salonId: true },
    });
    for (const row of stale) {
      await db.vipRequest.updateMany({
        where: { id: row.id, status: 'AWAITING_SAMPLE_WORK' },
        data: { status: 'CANCELLED', cancelledAt: now, updatedAt: now },
      });
      // Release only this salon's hold, and only when no live request still owns the list.
      await db.$executeRaw`
        UPDATE vip_target_lists
        SET
          status = 'ACTIVE',
          reserved_by_salon_id = NULL,
          reserved_at = NULL,
          updated_at = ${now}
        WHERE id = ${row.listId}::uuid
          AND status = 'IN_USE'
          AND reserved_by_salon_id = ${row.salonId}::uuid
          AND NOT EXISTS (
            SELECT 1
            FROM vip_requests
            WHERE list_id = ${row.listId}::uuid
              AND status IN (
                'AWAITING_SAMPLE_WORK',
                'SUBMITTED',
                'MANUAL_QUEUED',
                'BALE_NOT_IMPLEMENTED'
              )
          )
      `;
    }
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

  async quotaUsedSince(tx: Prisma.TransactionClient, salonId: string, since: Date) {
    const rows = await tx.$queryRaw<Array<{ used: bigint }>>`
      SELECT COALESCE(SUM(requested_count), 0) AS used
      FROM vip_requests
      WHERE salon_id = ${salonId}::uuid
        AND status <> 'CANCELLED'
        AND created_at >= ${since}
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
        updated_at = ${now}
      WHERE id = ${listId}::uuid
        AND status = 'ACTIVE'
        AND reserved_by_salon_id IS NULL
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

  currentOpenRequest(salonId: string, db: Db = this.prisma.client) {
    return db.vipRequest.findFirst({
      where: {
        salonId,
        status: { in: ['AWAITING_SAMPLE_WORK', 'SUBMITTED', 'MANUAL_QUEUED', 'BALE_NOT_IMPLEMENTED'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        salon: { select: { name: true } },
        list: { select: { name: true } },
        sampleWorks: { orderBy: { position: 'asc' } },
      },
    });
  }

  findActiveEntitlement(salonId: string, db: Db = this.prisma.client) {
    return db.vipSalonEntitlement.findFirst({
      where: { salonId, revokedAt: null },
    });
  }
}

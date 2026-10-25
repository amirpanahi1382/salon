import { Prisma } from '@salon/database';
import { isVipRegionCode, VIP_REGION_CODES } from '@salon/shared';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { VIP_OPEN_REQUEST_STATUSES } from './admin-salon-profile.use-case';

export type VipListRequestCounts = {
  totalRequestCount: number;
  openRequestCount: number;
};

/** Same predicate Admin inventory, salon region counts, salon browse, and reservation SQL use. */
export function isVipListRequestableBySalons(row: {
  status: string;
  reservedBySalonId: string | null;
  catalogMembership: string | null;
  regionCode?: string | null;
}): boolean {
  return (
    row.status === 'ACTIVE' &&
    row.reservedBySalonId === null &&
    row.catalogMembership === 'ORIGINAL_TEHRAN' &&
    typeof row.regionCode === 'string' &&
    isVipRegionCode(row.regionCode)
  );
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

export function vipListRequestableJoinSql(alias: string) {
  return Prisma.sql`
    ${Prisma.raw(alias)}.status = 'ACTIVE'
    AND ${Prisma.raw(alias)}.catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership"
    AND ${Prisma.raw(alias)}.reserved_by_salon_id IS NULL
    AND ${Prisma.raw(alias)}.region_code IN (${Prisma.join([...VIP_REGION_CODES].map((code) => Prisma.sql`${code}`))})
  `;
}

type CountRow = { listId: string; totalRequestCount: number; openRequestCount: number };

export async function loadVipListRequestCounts(
  prisma: PrismaService,
  listIds: string[],
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
      )::int AS "openRequestCount"
    FROM vip_requests r
    WHERE r.list_id IN (${Prisma.join(listIds.map((id) => Prisma.sql`${id}::uuid`))})
    GROUP BY r.list_id
  `);
  for (const row of rows) {
    counts.set(row.listId, {
      totalRequestCount: Number(row.totalRequestCount),
      openRequestCount: Number(row.openRequestCount),
    });
  }
  return counts;
}

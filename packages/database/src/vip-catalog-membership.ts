import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

export const ORIGINAL_TEHRAN_CATALOG = 'ORIGINAL_TEHRAN';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGION_PATTERN = /^(0[1-9]|1[0-4])$/;
const STATUSES = new Set(['PENDING', 'ACTIVE', 'INACTIVE', 'IN_USE']);
const COUNT_PATTERN = /^(0|[1-9]\d*)$/;

export class VipCatalogClassificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'VipCatalogClassificationError';
  }
}

export type VipCatalogManifestRow = {
  id: string;
  regionCode: string;
  status: string;
  recordedContacts: number;
  contactRows: number;
  reservedBySalonId: string | null;
  vipRequests: number;
};

export type ClassifyVipCatalogMembershipResult = {
  unchanged: boolean;
  listCount: number;
  contactRowCount: number;
  manifestSha256: string;
};

type LockedList = {
  id: string;
  status: string;
  regionCode: string | null;
  contactCount: number;
  reservedBySalonId: string | null;
  catalogMembership: string | null;
};

/**
 * Refuses the persistent `salon` database and any URL that is not the disposable
 * loopback preview port. Does not print the URL.
 */
export function assertDisposableCatalogTarget(databaseUrl: string, expectedDatabase: string): void {
  if (expectedDatabase === 'salon') {
    throw new VipCatalogClassificationError('REFUSING_PERSISTENT_DATABASE', 'Refusing persistent database salon');
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new VipCatalogClassificationError('DATABASE_TARGET_INVALID', 'DATABASE_URL is not a valid URL');
  }
  const port = url.port || '5432';
  const database = decodeURIComponent(url.pathname.replace(/^\//, '').split('?')[0] ?? '');
  const host = url.hostname;
  if (database === 'salon' || port === '5432') {
    throw new VipCatalogClassificationError('REFUSING_PERSISTENT_DATABASE', 'Refusing persistent database salon');
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new VipCatalogClassificationError('DATABASE_TARGET_INVALID', 'Refusing non-loopback database host');
  }
  if (port !== '15442') {
    throw new VipCatalogClassificationError('DATABASE_TARGET_INVALID', 'Refusing unexpected database port');
  }
  if (database !== expectedDatabase) {
    throw new VipCatalogClassificationError('DATABASE_MISMATCH', 'DATABASE_URL database does not match --database');
  }
}

export function parseVipCatalogManifest(csv: string): VipCatalogManifestRow[] {
  const rows = parseCsv(csv.replace(/^\uFEFF/, '')).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (rows.length < 2) {
    throw new VipCatalogClassificationError('MANIFEST_INVALID', 'Manifest needs a header and at least one list');
  }
  const header = rows[0]!.map((cell) => cell.trim());
  const index = (name: string) => {
    const found = header.indexOf(name);
    if (found < 0) {
      throw new VipCatalogClassificationError('MANIFEST_INVALID', `Manifest is missing ${name}`);
    }
    return found;
  };
  const idIndex = index('id');
  const regionIndex = index('region_code');
  const statusIndex = index('status');
  const recordedIndex = index('recorded_contacts');
  const contactRowsIndex = index('contact_rows');
  const reservedIndex = index('reserved_by_salon_id');
  const requestsIndex = index('vip_requests');
  const seen = new Set<string>();
  const parsed: VipCatalogManifestRow[] = [];
  for (const row of rows.slice(1)) {
    const id = (row[idIndex] ?? '').trim().toLowerCase();
    if (!UUID_PATTERN.test(id)) {
      throw new VipCatalogClassificationError('MANIFEST_INVALID', 'Manifest has an invalid list id');
    }
    if (seen.has(id)) {
      throw new VipCatalogClassificationError('MANIFEST_DUPLICATE_ID', `Duplicate list id ${id}`);
    }
    seen.add(id);
    const regionCode = (row[regionIndex] ?? '').trim();
    if (!REGION_PATTERN.test(regionCode)) {
      throw new VipCatalogClassificationError('MANIFEST_INVALID', `List ${id} has an invalid region_code`);
    }
    const status = (row[statusIndex] ?? '').trim();
    if (!STATUSES.has(status)) {
      throw new VipCatalogClassificationError('MANIFEST_INVALID', `List ${id} has an invalid status`);
    }
    const reservedRaw = (row[reservedIndex] ?? '').trim().toLowerCase();
    if (reservedRaw !== '' && !UUID_PATTERN.test(reservedRaw)) {
      throw new VipCatalogClassificationError('MANIFEST_INVALID', `List ${id} has an invalid reservation id`);
    }
    parsed.push({
      id,
      regionCode,
      status,
      recordedContacts: parseCount(row[recordedIndex], id, 'recorded_contacts'),
      contactRows: parseCount(row[contactRowsIndex], id, 'contact_rows'),
      reservedBySalonId: reservedRaw === '' ? null : reservedRaw,
      vipRequests: parseCount(row[requestsIndex], id, 'vip_requests'),
    });
  }
  return parsed;
}

function parseCount(value: string | undefined, id: string, field: string): number {
  const text = (value ?? '').trim();
  if (!COUNT_PATTERN.test(text)) {
    throw new VipCatalogClassificationError('MANIFEST_INVALID', `List ${id} has an invalid ${field}`);
  }
  return Number(text);
}

export async function classifyVipCatalogMembership(
  prisma: PrismaClient,
  input: { manifestCsv: string; actorAdminId: string; expectedDatabase: string },
): Promise<ClassifyVipCatalogMembershipResult> {
  if (!UUID_PATTERN.test(input.actorAdminId)) {
    throw new VipCatalogClassificationError('ACTOR_INVALID', 'Classification requires an active platform admin');
  }
  if (input.expectedDatabase === 'salon') {
    throw new VipCatalogClassificationError('REFUSING_PERSISTENT_DATABASE', 'Refusing persistent database salon');
  }
  const connected = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const database = connected[0]?.db;
  if (database === 'salon') {
    throw new VipCatalogClassificationError('REFUSING_PERSISTENT_DATABASE', 'Refusing persistent database salon');
  }
  if (database !== input.expectedDatabase) {
    throw new VipCatalogClassificationError('DATABASE_MISMATCH', 'Connected database does not match the expected target');
  }
  const column = await prisma.$queryRaw<Array<{ ok: number }>>`
    SELECT 1 AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vip_target_lists'
      AND column_name = 'catalog_membership'
  `;
  if (column.length !== 1) {
    throw new VipCatalogClassificationError('MIGRATION_REQUIRED', 'catalog_membership is not present');
  }

  const manifest = parseVipCatalogManifest(input.manifestCsv);
  const manifestSha256 = createHash('sha256').update(input.manifestCsv).digest('hex');
  const ids = manifest.map((row) => row.id).sort();
  const byId = new Map(manifest.map((row) => [row.id, row]));

  return prisma.$transaction(async (tx) => {
    const admin = await tx.platformAdmin.findUnique({
      where: { id: input.actorAdminId },
      select: { id: true, status: true },
    });
    if (!admin || admin.status !== 'ACTIVE') {
      throw new VipCatalogClassificationError('ACTOR_INVALID', 'Classification requires an active platform admin');
    }

    const idList = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
    const locked = await tx.$queryRaw<LockedList[]>`
      SELECT id::text AS id,
             status::text AS status,
             region_code AS "regionCode",
             contact_count AS "contactCount",
             reserved_by_salon_id::text AS "reservedBySalonId",
             catalog_membership::text AS "catalogMembership"
      FROM vip_target_lists
      WHERE id IN (${idList})
      ORDER BY id
      FOR UPDATE
    `;
    const present = new Set(locked.map((row) => row.id.toLowerCase()));
    const missing = ids.filter((id) => !present.has(id));
    if (missing.length > 0) {
      throw new VipCatalogClassificationError('LIST_MISSING', `Missing ${missing.length} list(s): ${missing.join(',')}`);
    }

    const [contactCounts, requestCounts] = await Promise.all([
      tx.$queryRaw<Array<{ id: string; n: number }>>`
        SELECT list_id::text AS id, count(*)::int AS n
        FROM vip_target_contacts
        WHERE list_id IN (${idList})
        GROUP BY list_id
      `,
      tx.$queryRaw<Array<{ id: string; n: number }>>`
        SELECT list_id::text AS id, count(*)::int AS n
        FROM vip_requests
        WHERE list_id IN (${idList})
        GROUP BY list_id
      `,
    ]);
    const contacts = new Map(contactCounts.map((row) => [row.id.toLowerCase(), Number(row.n)]));
    const requests = new Map(requestCounts.map((row) => [row.id.toLowerCase(), Number(row.n)]));

    let contactRowCount = 0;
    for (const row of locked) {
      const id = row.id.toLowerCase();
      const expected = byId.get(id);
      if (!expected) {
        throw new VipCatalogClassificationError('LIST_MISMATCH', `List ${id} was not in the manifest`);
      }
      const actualContacts = contacts.get(id) ?? 0;
      contactRowCount += actualContacts;
      if (row.regionCode !== expected.regionCode) {
        throw new VipCatalogClassificationError('LIST_MISMATCH', `List ${id} region_code does not match the manifest`);
      }
      if (row.status !== expected.status) {
        throw new VipCatalogClassificationError('LIST_MISMATCH', `List ${id} status does not match the manifest`);
      }
      if (Number(row.contactCount) !== expected.recordedContacts) {
        throw new VipCatalogClassificationError('LIST_MISMATCH', `List ${id} recorded contact count does not match the manifest`);
      }
      if (actualContacts !== expected.contactRows) {
        throw new VipCatalogClassificationError('LIST_MISMATCH', `List ${id} contact rows do not match the manifest`);
      }
      if ((requests.get(id) ?? 0) !== expected.vipRequests) {
        throw new VipCatalogClassificationError('LIST_MISMATCH', `List ${id} request count does not match the manifest`);
      }
      const reserved = row.reservedBySalonId?.toLowerCase() ?? null;
      if (reserved !== expected.reservedBySalonId) {
        throw new VipCatalogClassificationError('LIST_MISMATCH', `List ${id} reservation does not match the manifest`);
      }
      if (row.catalogMembership !== null && row.catalogMembership !== ORIGINAL_TEHRAN_CATALOG) {
        throw new VipCatalogClassificationError('MEMBERSHIP_CONFLICT', `List ${id} already belongs to a different collection`);
      }
    }

    const already = locked.filter((row) => row.catalogMembership === ORIGINAL_TEHRAN_CATALOG).length;
    if (already > 0 && already < locked.length) {
      throw new VipCatalogClassificationError('MEMBERSHIP_PARTIAL', 'Manifest lists are only partly in the collection');
    }
    if (already === locked.length) {
      return { unchanged: true, listCount: locked.length, contactRowCount, manifestSha256 };
    }

    const updated = await tx.$executeRaw`
      UPDATE vip_target_lists
      SET catalog_membership = ${ORIGINAL_TEHRAN_CATALOG}::"VipCatalogMembership"
      WHERE id IN (${idList})
        AND catalog_membership IS NULL
    `;
    if (Number(updated) !== locked.length) {
      throw new VipCatalogClassificationError('CLASSIFICATION_LOST', 'Classification lost a locked row');
    }
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: input.actorAdminId,
        action: 'VIP_CATALOG_MEMBERSHIP_CLASSIFIED',
        resource: 'vip_target_list',
        result: 'SUCCESS',
        metadata: {
          catalogMembership: ORIGINAL_TEHRAN_CATALOG,
          listCount: locked.length,
          contactRowCount,
          manifestSha256,
        },
      },
    });
    return { unchanged: false, listCount: locked.length, contactRowCount, manifestSha256 };
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

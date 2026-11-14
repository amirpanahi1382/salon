import { randomInt, randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const dedicatedUrl = process.env.VIP_CONSTRAINTS_DISPOSABLE_DATABASE_URL;
const REFUSED_SYSIDS = new Set(['7700113693112733735', '7683163620851879970']);
const FORBIDDEN_PORTS = new Set(['5432', '15442', '15490']);
const FORBIDDEN_NAMES = new Set(['salon', 'salon_preview', 'salon-db', 'phone_first_product', 'postgres']);

const disposableTarget = (() => {
  if (!databaseUrl || !dedicatedUrl || databaseUrl !== dedicatedUrl) return null;
  if (process.env.OTPY_API_KEY || process.env.BALE_SAFIR_API_ACCESS_KEY) return null;
  try {
    const parsed = new URL(databaseUrl);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (parsed.hostname !== '127.0.0.1' || !parsed.port || FORBIDDEN_PORTS.has(parsed.port)) return null;
    if (FORBIDDEN_NAMES.has(name) || !/^salon_vip_constraints_[a-z0-9]+$/.test(name)) return null;
    return { name, token: name.slice('salon_vip_constraints_'.length), port: parsed.port };
  } catch {
    return null;
  }
})();

const describeIfDisposable = disposableTarget ? describe : describe.skip;

function syntheticMobile(): string {
  return `0914${randomInt(0, 10_000_000).toString().padStart(7, '0')}`;
}

describeIfDisposable('VIP outreach constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ name: string; comment: string | null; sysid: string }>>`
      SELECT current_database() AS name,
             shobj_description(oid, 'pg_database') AS comment,
             (SELECT system_identifier::text FROM pg_control_system()) AS sysid
      FROM pg_database
      WHERE datname = current_database()
    `;
    const row = identity[0];
    if (
      !disposableTarget ||
      row?.name !== disposableTarget.name ||
      row.comment !== `vip-constraints-disposable:${disposableTarget.token}` ||
      REFUSED_SYSIDS.has(row.sysid ?? '')
    ) {
      throw new Error('Refusing VIP constraint tests without this run’s disposable database');
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedAdminAndSalon() {
    const adminId = randomUUID();
    const salonId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    await prisma.platformAdmin.create({
      data: {
        id: adminId,
        email: `vip-admin-${randomUUID()}@example.test`,
        phone: syntheticMobile(),
        passwordHash: 'hash',
        name: 'Admin',
        updatedAt: now,
      },
    });
    await prisma.salon.create({
      data: { id: salonId, name: 'VIP Salon', updatedAt: now },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `vip-owner-${randomUUID()}@example.test`,
        phone: syntheticMobile(),
        passwordHash: 'hash',
        role: 'OWNER',
        updatedAt: now,
      },
    });
    return { adminId, salonId, userId };
  }

  async function createList(
    adminId: string,
    input: { status?: 'PENDING' | 'ACTIVE' | 'IN_USE'; reservedBySalonId?: string; reservedAt?: Date } = {},
  ) {
    const listId = randomUUID();
    const now = new Date();
    await prisma.vipTargetList.create({
      data: {
        id: listId,
        name: `list-${listId.slice(0, 8)}`,
        status: input.status ?? 'ACTIVE',
        contactCount: 52,
        createdByAdminId: adminId,
        reservedBySalonId: input.reservedBySalonId ?? null,
        reservedAt: input.reservedAt ?? null,
        updatedAt: now,
      },
    });
    return listId;
  }

  it('rejects a list with more than 100 contacts', async () => {
    const { adminId } = await seedAdminAndSalon();
    await expect(
      prisma.vipTargetList.create({
        data: {
          id: randomUUID(),
          name: 'too-big',
          status: 'PENDING',
          contactCount: 101,
          createdByAdminId: adminId,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/vip_target_lists_contact_count_range/);
  });

  it('accepts requested quantities 1 through 500 and rejects 0 and 501', async () => {
    const seeded = await seedAdminAndSalon();
    const listId = await createList(seeded.adminId);
    const now = new Date();
    await prisma.vipRequest.create({
      data: {
        id: randomUUID(),
        salonId: seeded.salonId,
        listId,
        createdByUserId: seeded.userId,
        requestedCount: 52,
        geographicRange: 'ونک',
        status: 'SUBMITTED',
        reservedUntil: now,
        submittedAt: now,
        updatedAt: now,
      },
    });
    const otherList = await createList(seeded.adminId);
    await prisma.vipRequest.create({
      data: {
        id: randomUUID(),
        salonId: seeded.salonId,
        listId: otherList,
        createdByUserId: seeded.userId,
        requestedCount: 1,
        geographicRange: 'ونک',
        status: 'MANUAL_QUEUED',
        reservedUntil: now,
        submittedAt: now,
        updatedAt: now,
      },
    });
    const boundList = await createList(seeded.adminId);
    await expect(
      prisma.vipRequest.create({
        data: {
          id: randomUUID(),
          salonId: seeded.salonId,
          listId: boundList,
          createdByUserId: seeded.userId,
          requestedCount: 0,
          geographicRange: 'ونک',
          status: 'AWAITING_SAMPLE_WORK',
          reservedUntil: now,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow(/vip_requests_count_positive/);
    await expect(
      prisma.vipRequest.create({
        data: {
          id: randomUUID(),
          salonId: seeded.salonId,
          listId: boundList,
          createdByUserId: seeded.userId,
          requestedCount: 501,
          geographicRange: 'ونک',
          status: 'AWAITING_SAMPLE_WORK',
          reservedUntil: now,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow(/vip_requests_count_positive/);
  });

  it('allows two salons one active request each on the same list and rejects a second active request from the same salon', async () => {
    const a = await seedAdminAndSalon();
    const b = await seedAdminAndSalon();
    const listId = await createList(a.adminId);
    const now = new Date();
    await prisma.vipRequest.create({
      data: {
        id: randomUUID(),
        salonId: a.salonId,
        listId,
        createdByUserId: a.userId,
        requestedCount: 40,
        geographicRange: 'ونک',
        status: 'SUBMITTED',
        reservedUntil: now,
        submittedAt: now,
        updatedAt: now,
      },
    });
    await prisma.vipRequest.create({
      data: {
        id: randomUUID(),
        salonId: b.salonId,
        listId,
        createdByUserId: b.userId,
        requestedCount: 40,
        geographicRange: 'ونک',
        status: 'AWAITING_SAMPLE_WORK',
        reservedUntil: now,
        updatedAt: now,
      },
    });
    await expect(
      prisma.vipRequest.create({
        data: {
          id: randomUUID(),
          salonId: a.salonId,
          listId,
          createdByUserId: a.userId,
          requestedCount: 10,
          geographicRange: 'ونک',
          status: 'AWAITING_SAMPLE_WORK',
          reservedUntil: now,
          updatedAt: now,
        },
      }),
    ).rejects.toThrow(/vip_requests_one_active_per_salon_list|Unique constraint failed/);
  });

  it('rejects more than 3 sample-work positions', async () => {
    const seeded = await seedAdminAndSalon();
    const listId = await createList(seeded.adminId, {
      status: 'IN_USE',
      reservedBySalonId: seeded.salonId,
      reservedAt: new Date(),
    });
    const requestId = randomUUID();
    await prisma.vipRequest.create({
      data: {
        id: requestId,
        salonId: seeded.salonId,
        listId,
        createdByUserId: seeded.userId,
        requestedCount: 30,
        geographicRange: 'ونک',
        status: 'AWAITING_SAMPLE_WORK',
        reservedUntil: new Date(),
        updatedAt: new Date(),
      },
    });
    await expect(
      prisma.vipSampleWork.create({
        data: {
          id: randomUUID(),
          vipRequestId: requestId,
          salonId: seeded.salonId,
          position: 4,
          objectKey: `vip/${requestId}/x`,
          contentType: 'image/jpeg',
          byteSize: 12,
          sha256: 'abc',
        },
      }),
    ).rejects.toThrow(/vip_sample_works_position_range/);
  });

  it('does not release a list still held by a newer salon reservation', async () => {
    const older = await seedAdminAndSalon();
    const newer = await seedAdminAndSalon();
    const listId = randomUUID();
    const now = new Date();
    await prisma.vipTargetList.create({
      data: {
        id: listId,
        name: 'expire-safe',
        status: 'IN_USE',
        contactCount: 30,
        createdByAdminId: older.adminId,
        reservedBySalonId: newer.salonId,
        reservedAt: now,
        updatedAt: now,
      },
    });
    await prisma.vipRequest.create({
      data: {
        id: randomUUID(),
        salonId: newer.salonId,
        listId,
        createdByUserId: newer.userId,
        requestedCount: 30,
        geographicRange: 'ونک',
        status: 'AWAITING_SAMPLE_WORK',
        reservedUntil: new Date(now.getTime() + 30 * 60 * 1000),
        updatedAt: now,
      },
    });
    await prisma.$executeRaw`
      UPDATE vip_target_lists
      SET
        status = 'ACTIVE',
        reserved_by_salon_id = NULL,
        reserved_at = NULL,
        updated_at = ${now}
      WHERE id = ${listId}::uuid
        AND status = 'IN_USE'
        AND reserved_by_salon_id = ${older.salonId}::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM vip_requests
          WHERE list_id = ${listId}::uuid
            AND status IN (
              'AWAITING_SAMPLE_WORK',
              'SUBMITTED',
              'MANUAL_QUEUED',
              'BALE_NOT_IMPLEMENTED'
            )
        )
    `;
    const list = await prisma.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(list.status).toBe('IN_USE');
    expect(list.reservedBySalonId).toBe(newer.salonId);
  });

  it('rejects sample and recipient rows whose salon_id does not match the request', async () => {
    const owner = await seedAdminAndSalon();
    const other = await seedAdminAndSalon();
    const listId = await createList(owner.adminId, {
      status: 'IN_USE',
      reservedBySalonId: owner.salonId,
      reservedAt: new Date(),
    });
    const requestId = randomUUID();
    const now = new Date();
    await prisma.vipRequest.create({
      data: {
        id: requestId,
        salonId: owner.salonId,
        listId,
        createdByUserId: owner.userId,
        requestedCount: 30,
        geographicRange: 'ونک',
        status: 'AWAITING_SAMPLE_WORK',
        reservedUntil: now,
        updatedAt: now,
      },
    });
    await prisma.vipSampleWork.create({
      data: {
        id: randomUUID(),
        vipRequestId: requestId,
        salonId: owner.salonId,
        position: 1,
        objectKey: `vip/${requestId}/ok`,
        contentType: 'image/jpeg',
        byteSize: 12,
        sha256: 'ok',
      },
    });
    await expect(
      prisma.vipSampleWork.create({
        data: {
          id: randomUUID(),
          vipRequestId: requestId,
          salonId: other.salonId,
          position: 2,
          objectKey: `vip/${requestId}/bad`,
          contentType: 'image/jpeg',
          byteSize: 12,
          sha256: 'bad',
        },
      }),
    ).rejects.toThrow(/Foreign key|vip_sample_works_vip_request_id_salon_id_fkey/);
  });
});

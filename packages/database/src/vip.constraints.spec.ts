import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('VIP outreach constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedAdminAndSalon() {
    const adminId = randomUUID();
    const salonId = randomUUID();
    const userId = randomUUID();
    await prisma.platformAdmin.create({
      data: {
        id: adminId,
        email: `vip-admin-${randomUUID()}@example.test`,
        passwordHash: 'hash',
        name: 'Admin',
        updatedAt: new Date(),
      },
    });
    await prisma.salon.create({
      data: { id: salonId, name: 'VIP Salon', updatedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `vip-owner-${randomUUID()}@example.test`,
        passwordHash: 'hash',
        role: 'OWNER',
        updatedAt: new Date(),
      },
    });
    return { adminId, salonId, userId };
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

  it('allows only one concurrent ACTIVE-to-IN_USE reservation per list', async () => {
    const a = await seedAdminAndSalon();
    const b = await seedAdminAndSalon();
    const listId = randomUUID();
    await prisma.vipTargetList.create({
      data: {
        id: listId,
        name: 'shared',
        status: 'ACTIVE',
        contactCount: 1,
        createdByAdminId: a.adminId,
        updatedAt: new Date(),
      },
    });
    const now = new Date();
    const reserve = (salonId: string) =>
      prisma.$executeRaw`
        UPDATE vip_target_lists
        SET status = 'IN_USE', reserved_by_salon_id = ${salonId}::uuid, reserved_at = ${now}, updated_at = ${now}
        WHERE id = ${listId}::uuid AND status = 'ACTIVE' AND reserved_by_salon_id IS NULL
      `;
    const results = await Promise.all([reserve(a.salonId), reserve(b.salonId)]);
    expect(results.filter((count) => count === 1)).toHaveLength(1);
    expect(results.filter((count) => count === 0)).toHaveLength(1);
    const list = await prisma.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(list.status).toBe('IN_USE');
    expect([a.salonId, b.salonId]).toContain(list.reservedBySalonId);
  });

  it('rejects requested counts other than 30, 50, or 100', async () => {
    const seeded = await seedAdminAndSalon();
    const listId = randomUUID();
    await prisma.vipTargetList.create({
      data: {
        id: listId,
        name: 'counts',
        status: 'ACTIVE',
        contactCount: 30,
        createdByAdminId: seeded.adminId,
        updatedAt: new Date(),
      },
    });
    await expect(
      prisma.vipRequest.create({
        data: {
          id: randomUUID(),
          salonId: seeded.salonId,
          listId,
          createdByUserId: seeded.userId,
          requestedCount: 101,
          geographicRange: 'ونک',
          status: 'AWAITING_SAMPLE_WORK',
          reservedUntil: new Date(),
          updatedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/vip_requests_count_allowed/);
  });

  it('rejects more than 3 sample-work positions', async () => {
    const seeded = await seedAdminAndSalon();
    const listId = randomUUID();
    const requestId = randomUUID();
    await prisma.vipTargetList.create({
      data: {
        id: listId,
        name: 'images',
        status: 'IN_USE',
        contactCount: 30,
        createdByAdminId: seeded.adminId,
        reservedBySalonId: seeded.salonId,
        reservedAt: new Date(),
        updatedAt: new Date(),
      },
    });
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
    const listId = randomUUID();
    const requestId = randomUUID();
    const now = new Date();
    await prisma.vipTargetList.create({
      data: {
        id: listId,
        name: 'fk',
        status: 'IN_USE',
        contactCount: 30,
        createdByAdminId: owner.adminId,
        reservedBySalonId: owner.salonId,
        reservedAt: now,
        updatedAt: now,
      },
    });
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

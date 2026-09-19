import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('return commitment constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedSalon(label: string) {
    const salonId = randomUUID();
    const userId = randomUUID();
    const customerId = randomUUID();
    await prisma.salon.create({
      data: { id: salonId, name: `${label} Salon`, updatedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `rc-${label}-${randomUUID()}@example.test`,
        passwordHash: 'hash',
        role: 'OWNER',
        updatedAt: new Date(),
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        salonId,
        firstName: 'Sara',
        lastName: label,
        phoneNumber: `09${Math.floor(Math.random() * 1_000_000_000)
          .toString()
          .padStart(9, '0')}`,
        updatedAt: new Date(),
      },
    });
    return { salonId, userId, customerId };
  }

  async function seedSentMessage(seeded: Awaited<ReturnType<typeof seedSalon>>) {
    const requestId = randomUUID();
    const deliveryId = randomUUID();
    const now = new Date('2026-09-16T10:00:00.000Z');
    await prisma.messageRequest.create({
      data: {
        id: requestId,
        salonId: seeded.salonId,
        customerId: seeded.customerId,
        createdByUserId: seeded.userId,
        messageText: 'سلام',
        requestedAt: now,
        messageBusinessDate: new Date('2026-09-16T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'SENT',
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.messageDelivery.create({
      data: {
        id: deliveryId,
        salonId: seeded.salonId,
        messageRequestId: requestId,
        customerId: seeded.customerId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: 'SENT',
        providerRequestId: randomUUID(),
        createdBy: seeded.userId,
        createdAt: now,
        updatedAt: now,
        submittedAt: now,
      },
    });
    return { requestId, deliveryId };
  }

  it('rejects a commitment whose customer belongs to another salon', async () => {
    const salonA = await seedSalon('A');
    const salonB = await seedSalon('B');
    const message = await seedSentMessage(salonA);
    await expect(
      prisma.returnCommitment.create({
        data: {
          id: randomUUID(),
          salonId: salonA.salonId,
          customerId: salonB.customerId,
          sourceMessageRequestId: message.requestId,
          sourceMessageDeliveryId: message.deliveryId,
          expectedAt: new Date('2026-09-20T16:00:00.000Z'),
          createdByUserId: salonA.userId,
          updatedByUserId: salonA.userId,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects a creator user from another salon', async () => {
    const salonA = await seedSalon('Ac');
    const salonB = await seedSalon('Bc');
    const message = await seedSentMessage(salonA);
    await expect(
      prisma.returnCommitment.create({
        data: {
          id: randomUUID(),
          salonId: salonA.salonId,
          customerId: salonA.customerId,
          sourceMessageRequestId: message.requestId,
          sourceMessageDeliveryId: message.deliveryId,
          expectedAt: new Date('2026-09-20T16:00:00.000Z'),
          createdByUserId: salonB.userId,
          updatedByUserId: salonA.userId,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('enforces one commitment per source message request', async () => {
    const salon = await seedSalon('Dup');
    const message = await seedSentMessage(salon);
    const now = new Date();
    await prisma.returnCommitment.create({
      data: {
        id: randomUUID(),
        salonId: salon.salonId,
        customerId: salon.customerId,
        sourceMessageRequestId: message.requestId,
        sourceMessageDeliveryId: message.deliveryId,
        expectedAt: new Date('2026-09-20T16:00:00.000Z'),
        createdByUserId: salon.userId,
        updatedByUserId: salon.userId,
        updatedAt: now,
      },
    });
    await expect(
      prisma.returnCommitment.create({
        data: {
          id: randomUUID(),
          salonId: salon.salonId,
          customerId: salon.customerId,
          sourceMessageRequestId: message.requestId,
          sourceMessageDeliveryId: message.deliveryId,
          expectedAt: new Date('2026-09-21T16:00:00.000Z'),
          createdByUserId: salon.userId,
          updatedByUserId: salon.userId,
          updatedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects linking one visit to two commitments and RESTRICT-deleting a linked visit', async () => {
    const salon = await seedSalon('Link');
    const firstMessage = await seedSentMessage(salon);
    const secondRequestId = randomUUID();
    const secondDeliveryId = randomUUID();
    const now = new Date('2026-09-16T11:00:00.000Z');
    await prisma.messageRequest.create({
      data: {
        id: secondRequestId,
        salonId: salon.salonId,
        customerId: salon.customerId,
        createdByUserId: salon.userId,
        messageText: 'سلام',
        requestedAt: now,
        messageBusinessDate: new Date('2026-09-16T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'SENT',
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.messageDelivery.create({
      data: {
        id: secondDeliveryId,
        salonId: salon.salonId,
        messageRequestId: secondRequestId,
        customerId: salon.customerId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: 'SENT',
        providerRequestId: randomUUID(),
        createdBy: salon.userId,
        createdAt: now,
        updatedAt: now,
        submittedAt: now,
      },
    });
    const visitId = randomUUID();
    await prisma.visit.create({
      data: {
        id: visitId,
        salonId: salon.salonId,
        customerId: salon.customerId,
        visitedAt: new Date('2026-09-16T16:22:00.000Z'),
        updatedAt: now,
      },
    });
    await prisma.returnCommitment.create({
      data: {
        id: randomUUID(),
        salonId: salon.salonId,
        customerId: salon.customerId,
        sourceMessageRequestId: firstMessage.requestId,
        sourceMessageDeliveryId: firstMessage.deliveryId,
        expectedAt: new Date('2026-09-20T16:00:00.000Z'),
        actualVisitId: visitId,
        createdByUserId: salon.userId,
        updatedByUserId: salon.userId,
        updatedAt: now,
      },
    });
    await expect(
      prisma.returnCommitment.create({
        data: {
          id: randomUUID(),
          salonId: salon.salonId,
          customerId: salon.customerId,
          sourceMessageRequestId: secondRequestId,
          sourceMessageDeliveryId: secondDeliveryId,
          expectedAt: new Date('2026-09-21T16:00:00.000Z'),
          actualVisitId: visitId,
          createdByUserId: salon.userId,
          updatedByUserId: salon.userId,
          updatedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.visit.delete({ where: { id: visitId } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('allows platform-admin XOR actor columns and rejects mixed actors', async () => {
    const salon = await seedSalon('AdminActor');
    const message = await seedSentMessage(salon);
    const adminId = randomUUID();
    await prisma.platformAdmin.create({
      data: {
        id: adminId,
        email: `rc-admin-${randomUUID()}@example.test`,
        name: 'Ops',
        passwordHash: 'hash',
        updatedAt: new Date(),
      },
    });
    await prisma.returnCommitment.create({
      data: {
        id: randomUUID(),
        salonId: salon.salonId,
        customerId: salon.customerId,
        sourceMessageRequestId: message.requestId,
        sourceMessageDeliveryId: message.deliveryId,
        expectedAt: new Date('2026-09-20T16:00:00.000Z'),
        createdByPlatformAdminId: adminId,
        updatedByPlatformAdminId: adminId,
        updatedAt: new Date(),
      },
    });
    const second = await seedSentMessage(salon);
    await expect(
      prisma.returnCommitment.create({
        data: {
          id: randomUUID(),
          salonId: salon.salonId,
          customerId: salon.customerId,
          sourceMessageRequestId: second.requestId,
          sourceMessageDeliveryId: second.deliveryId,
          expectedAt: new Date('2026-09-21T16:00:00.000Z'),
          createdByUserId: salon.userId,
          createdByPlatformAdminId: adminId,
          updatedByUserId: salon.userId,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/return_commitments_created_actor_chk/);
  });
});

import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('message_deliveries constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a delivery whose customer belongs to another salon', async () => {
    const salonA = randomUUID();
    const salonB = randomUUID();
    const userA = randomUUID();
    const customerB = randomUUID();
    const actionA = randomUUID();

    await prisma.salon.createMany({
      data: [
        { id: salonA, name: 'Msg A', updatedAt: new Date() },
        { id: salonB, name: 'Msg B', updatedAt: new Date() },
      ],
    });
    await prisma.user.create({
      data: {
        id: userA,
        salonId: salonA,
        name: 'Owner',
        email: `msg-fk-${Date.now()}@example.test`,
        passwordHash: 'hash',
        role: 'OWNER',
        updatedAt: new Date(),
      },
    });
    await prisma.customer.create({
      data: {
        id: customerB,
        salonId: salonB,
        firstName: 'Sara',
        lastName: 'B',
        phoneNumber: `0915${Date.now().toString().slice(-7)}`.slice(0, 11),
        updatedAt: new Date(),
      },
    });
    await prisma.customer.create({
      data: {
        id: randomUUID(),
        salonId: salonA,
        firstName: 'Sara',
        lastName: 'A',
        phoneNumber: `0916${Date.now().toString().slice(-7)}`.slice(0, 11),
        updatedAt: new Date(),
      },
    });
    const customerA = (
      await prisma.customer.findFirstOrThrow({ where: { salonId: salonA } })
    ).id;
    await prisma.opportunityAction.create({
      data: {
        id: actionA,
        salonId: salonA,
        customerId: customerA,
        opportunityType: 'REVENUE_DECLINE',
        status: 'OPEN',
        createdBy: userA,
        updatedAt: new Date(),
      },
    });

    await expect(
      prisma.messageDelivery.create({
        data: {
          id: randomUUID(),
          salonId: salonA,
          customerId: customerB,
          actionId: actionA,
          provider: 'BALE_SAFIR',
          channel: 'TEXT',
          status: 'PENDING',
          body: 'سلام',
          providerRequestId: randomUUID(),
          createdBy: userA,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rolls back delivery and outbox together', async () => {
    const salonId = randomUUID();
    const userId = randomUUID();
    const customerId = randomUUID();
    const actionId = randomUUID();
    const deliveryId = randomUUID();
    const outboxId = randomUUID();

    await prisma.salon.create({
      data: { id: salonId, name: 'Msg Rollback', updatedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `msg-roll-${Date.now()}@example.test`,
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
        lastName: 'Rollback',
        phoneNumber: `0917${Date.now().toString().slice(-7)}`.slice(0, 11),
        updatedAt: new Date(),
      },
    });
    await prisma.opportunityAction.create({
      data: {
        id: actionId,
        salonId,
        customerId,
        opportunityType: 'REVENUE_DECLINE',
        status: 'OPEN',
        createdBy: userId,
        updatedAt: new Date(),
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.messageDelivery.create({
          data: {
            id: deliveryId,
            salonId,
            customerId,
            actionId,
            provider: 'BALE_SAFIR',
            channel: 'TEXT',
            status: 'PENDING',
            body: 'سلام',
            providerRequestId: deliveryId,
            createdBy: userId,
            updatedAt: new Date(),
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: outboxId,
            tenantId: salonId,
            eventType: 'MessageSendRequested',
            payload: { messageDeliveryId: deliveryId },
          },
        });
        throw new Error('forced-failure');
      }),
    ).rejects.toThrow('forced-failure');

    expect(await prisma.messageDelivery.findUnique({ where: { id: deliveryId } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: outboxId } })).toBeNull();
  });
});

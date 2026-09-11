import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('opportunity_actions constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects an action whose customer belongs to another salon', async () => {
    const salonA = randomUUID();
    const salonB = randomUUID();
    const userA = randomUUID();
    const customerB = randomUUID();

    await prisma.salon.createMany({
      data: [
        { id: salonA, name: 'A', updatedAt: new Date() },
        { id: salonB, name: 'B', updatedAt: new Date() },
      ],
    });
    await prisma.user.create({
      data: {
        id: userA,
        salonId: salonA,
        name: 'Owner',
        email: `act-fk-${Date.now()}@example.test`,
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
        phoneNumber: `0912${Date.now().toString().slice(-7)}`,
        updatedAt: new Date(),
      },
    });

    await expect(
      prisma.opportunityAction.create({
        data: {
          id: randomUUID(),
          salonId: salonA,
          customerId: customerB,
          opportunityType: 'REACTIVATION',
          status: 'OPEN',
          createdBy: userA,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('allows only one OPEN action per salon, customer, and opportunity type', async () => {
    const salonId = randomUUID();
    const userId = randomUUID();
    const customerId = randomUUID();

    await prisma.salon.create({
      data: { id: salonId, name: 'Open Unique', updatedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `act-open-${Date.now()}@example.test`,
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
        lastName: 'Open',
        phoneNumber: `0913${Date.now().toString().slice(-7)}`,
        updatedAt: new Date(),
      },
    });

    await prisma.opportunityAction.create({
      data: {
        id: randomUUID(),
        salonId,
        customerId,
        opportunityType: 'REACTIVATION',
        status: 'OPEN',
        createdBy: userId,
        updatedAt: new Date(),
      },
    });

    await expect(
      prisma.opportunityAction.create({
        data: {
          id: randomUUID(),
          salonId,
          customerId,
          opportunityType: 'REACTIVATION',
          status: 'OPEN',
          createdBy: userId,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.opportunityAction.create({
      data: {
        id: randomUUID(),
        salonId,
        customerId,
        opportunityType: 'CUSTOMER_RETURN',
        status: 'OPEN',
        createdBy: userId,
        updatedAt: new Date(),
      },
    });
  });

  it('allows only one action per salon, customer, type, and source visit', async () => {
    const salonId = randomUUID();
    const userId = randomUUID();
    const customerId = randomUUID();
    const visitId = randomUUID();

    await prisma.salon.create({
      data: { id: salonId, name: 'Fingerprint Unique', updatedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `act-fp-${Date.now()}@example.test`,
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
        lastName: 'Fingerprint',
        phoneNumber: `0915${Date.now().toString().slice(-7)}`,
        updatedAt: new Date(),
      },
    });
    await prisma.visit.create({
      data: {
        id: visitId,
        salonId,
        customerId,
        visitedAt: new Date('2026-07-01T10:00:00.000Z'),
        updatedAt: new Date(),
      },
    });

    await prisma.opportunityAction.create({
      data: {
        id: randomUUID(),
        salonId,
        customerId,
        opportunityType: 'REACTIVATION',
        status: 'COMPLETED',
        createdBy: userId,
        updatedAt: new Date(),
        completedAt: new Date(),
        sourceVisitId: visitId,
      },
    });

    await expect(
      prisma.opportunityAction.create({
        data: {
          id: randomUUID(),
          salonId,
          customerId,
          opportunityType: 'REACTIVATION',
          status: 'OPEN',
          createdBy: userId,
          updatedAt: new Date(),
          sourceVisitId: visitId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const laterVisit = randomUUID();
    await prisma.visit.create({
      data: {
        id: laterVisit,
        salonId,
        customerId,
        visitedAt: new Date('2026-07-20T10:00:00.000Z'),
        updatedAt: new Date(),
      },
    });
    await prisma.opportunityAction.create({
      data: {
        id: randomUUID(),
        salonId,
        customerId,
        opportunityType: 'REACTIVATION',
        status: 'OPEN',
        createdBy: userId,
        updatedAt: new Date(),
        sourceVisitId: laterVisit,
      },
    });
  });

  it('allows multiple historical actions of the same type when sourceVisitId is null', async () => {
    const salonId = randomUUID();
    const userId = randomUUID();
    const customerId = randomUUID();

    await prisma.salon.create({
      data: { id: salonId, name: 'Null Fingerprint', updatedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `act-null-${Date.now()}@example.test`,
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
        lastName: 'NullFp',
        phoneNumber: `0916${Date.now().toString().slice(-7)}`,
        updatedAt: new Date(),
      },
    });

    await prisma.opportunityAction.create({
      data: {
        id: randomUUID(),
        salonId,
        customerId,
        opportunityType: 'REACTIVATION',
        status: 'COMPLETED',
        createdBy: userId,
        updatedAt: new Date(),
        completedAt: new Date(),
        sourceVisitId: null,
      },
    });
    await prisma.opportunityAction.create({
      data: {
        id: randomUUID(),
        salonId,
        customerId,
        opportunityType: 'REACTIVATION',
        status: 'DISMISSED',
        createdBy: userId,
        updatedAt: new Date(),
        dismissedAt: new Date(),
        sourceVisitId: null,
      },
    });
  });

  it('commits neither action nor outbox when the transaction fails', async () => {
    const salonId = randomUUID();
    const userId = randomUUID();
    const customerId = randomUUID();
    const actionId = randomUUID();
    const outboxId = randomUUID();

    await prisma.salon.create({
      data: { id: salonId, name: 'Rollback Action', updatedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `act-roll-${Date.now()}@example.test`,
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
        phoneNumber: `0914${Date.now().toString().slice(-7)}`,
        updatedAt: new Date(),
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.opportunityAction.create({
          data: {
            id: actionId,
            salonId,
            customerId,
            opportunityType: 'REACTIVATION',
            status: 'OPEN',
            createdBy: userId,
            updatedAt: new Date(),
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: outboxId,
            tenantId: salonId,
            eventType: 'ActionCreated',
            payload: { actionId },
          },
        });
        throw new Error('forced-failure');
      }),
    ).rejects.toThrow('forced-failure');

    expect(await prisma.opportunityAction.findUnique({ where: { id: actionId } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: outboxId } })).toBeNull();
  });
});

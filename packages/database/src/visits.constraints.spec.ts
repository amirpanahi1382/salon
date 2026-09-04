import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('visits constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a visit whose customer belongs to another salon', async () => {
    const salonA = randomUUID();
    const salonB = randomUUID();
    const customerB = randomUUID();

    await prisma.salon.createMany({
      data: [
        { id: salonA, name: 'A', updatedAt: new Date() },
        { id: salonB, name: 'B', updatedAt: new Date() },
      ],
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
      prisma.visit.create({
        data: {
          id: randomUUID(),
          salonId: salonA,
          customerId: customerB,
          visitedAt: new Date('2026-09-01T10:00:00.000Z'),
          updatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('commits neither visit nor outbox when the transaction fails', async () => {
    const salonId = randomUUID();
    const customerId = randomUUID();
    const visitId = randomUUID();
    const outboxId = randomUUID();

    await prisma.salon.create({
      data: { id: salonId, name: 'Rollback', updatedAt: new Date() },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        salonId,
        firstName: 'Sara',
        lastName: 'Rollback',
        phoneNumber: `0913${Date.now().toString().slice(-7)}`,
        updatedAt: new Date(),
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.visit.create({
          data: {
            id: visitId,
            salonId,
            customerId,
            visitedAt: new Date('2026-09-01T10:00:00.000Z'),
            updatedAt: new Date(),
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: outboxId,
            tenantId: salonId,
            eventType: 'VisitCompleted',
            payload: { visitId },
          },
        });
        throw new Error('forced-failure');
      }),
    ).rejects.toThrow('forced-failure');

    expect(await prisma.visit.findUnique({ where: { id: visitId } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: outboxId } })).toBeNull();
  });
});

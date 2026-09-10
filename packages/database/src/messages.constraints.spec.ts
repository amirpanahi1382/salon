import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('message request constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedSalon() {
    const salonId = randomUUID();
    const userId = randomUUID();
    const customerId = randomUUID();
    const actionId = randomUUID();
    await prisma.salon.create({
      data: { id: salonId, name: 'Msg Salon', updatedAt: new Date() },
    });
    await prisma.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Owner',
        email: `msg-${randomUUID()}@example.test`,
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
        lastName: 'A',
        phoneNumber: `09${Math.floor(Math.random() * 1_000_000_000)
          .toString()
          .padStart(9, '0')}`,
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
    return { salonId, userId, customerId, actionId };
  }

  function requestData(
    seeded: Awaited<ReturnType<typeof seedSalon>>,
    overrides: Record<string, unknown>,
  ) {
    return {
      id: randomUUID(),
      salonId: seeded.salonId,
      customerId: seeded.customerId,
      actionId: seeded.actionId,
      createdByUserId: seeded.userId,
      opportunityType: 'REVENUE_DECLINE' as const,
      messageText: 'سلام',
      messageBusinessDate: new Date('2026-09-10T00:00:00.000Z'),
      countsTowardDailyLimit: true,
      status: 'QUEUED' as const,
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('rejects a request whose customer belongs to another salon', async () => {
    const a = await seedSalon();
    const b = await seedSalon();
    await expect(
      prisma.messageRequest.create({
        data: requestData(a, { customerId: b.customerId }),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects a second request for the same customer on the same business day', async () => {
    const seeded = await seedSalon();
    const day = new Date('2026-09-10T00:00:00.000Z');
    await prisma.messageRequest.create({
      data: requestData(seeded, { messageText: 'اول', messageBusinessDate: day }),
    });
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, {
          opportunityType: 'REACTIVATION',
          messageText: 'دوم',
          messageBusinessDate: day,
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows historical backfill rows to share a Tehran day and still accept one new request', async () => {
    const seeded = await seedSalon();
    const day = new Date('2026-09-10T00:00:00.000Z');
    await prisma.messageRequest.create({
      data: requestData(seeded, {
        messageText: 'legacy-1',
        messageBusinessDate: day,
        countsTowardDailyLimit: false,
      }),
    });
    await prisma.messageRequest.create({
      data: requestData(seeded, {
        messageText: 'legacy-2',
        messageBusinessDate: day,
        countsTowardDailyLimit: false,
      }),
    });
    await prisma.messageRequest.create({
      data: requestData(seeded, {
        messageText: 'new-1',
        messageBusinessDate: day,
        countsTowardDailyLimit: true,
      }),
    });
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, {
          messageText: 'new-2',
          messageBusinessDate: day,
          countsTowardDailyLimit: true,
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the same customer on a different business day', async () => {
    const seeded = await seedSalon();
    await prisma.messageRequest.create({
      data: requestData(seeded, { messageText: 'روز اول' }),
    });
    await expect(
      prisma.messageRequest.create({
        data: requestData(seeded, {
          messageText: 'روز دوم',
          messageBusinessDate: new Date('2026-09-11T00:00:00.000Z'),
        }),
      }),
    ).resolves.toMatchObject({ messageText: 'روز دوم' });
  });

  it('rejects concurrent same-day inserts for one customer', async () => {
    const seeded = await seedSalon();
    const day = new Date('2026-09-12T00:00:00.000Z');
    const write = () =>
      prisma.messageRequest.create({
        data: requestData(seeded, {
          messageText: `همزمان ${randomUUID()}`,
          messageBusinessDate: day,
        }),
      });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => write()));
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    expect(rejected.every((result) => result.status === 'rejected' && result.reason.code === 'P2002')).toBe(
      true,
    );
  });

  it('rolls back request and outbox together', async () => {
    const seeded = await seedSalon();
    const requestId = randomUUID();
    const outboxId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.messageRequest.create({
          data: requestData(seeded, {
            id: requestId,
            messageBusinessDate: new Date('2026-09-13T00:00:00.000Z'),
          }),
        });
        await tx.outboxEvent.create({
          data: {
            id: outboxId,
            tenantId: seeded.salonId,
            eventType: 'MessageRequested',
            payload: { messageRequestId: requestId },
          },
        });
        throw new Error('forced-failure');
      }),
    ).rejects.toThrow('forced-failure');

    expect(await prisma.messageRequest.findUnique({ where: { id: requestId } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: outboxId } })).toBeNull();
  });
});

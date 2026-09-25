import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';
import { claimOutboxEvents, markOutboxDeadLetter, markOutboxProcessed, markOutboxRetry } from './outbox';

const databaseUrl = process.env.DATABASE_URL;

const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('claimOutboxEvents', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('gives concurrent claimers disjoint rows via FOR UPDATE SKIP LOCKED', async () => {
    const tenantId = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    await prisma.outboxEvent.createMany({
      data: ids.map((id) => ({
        id,
        tenantId,
        eventType: 'TestEvent',
        payload: { id },
        status: 'PENDING',
      })),
    });

    const [batchA, batchB] = await Promise.all([
      claimOutboxEvents(prisma, 2, 30_000),
      claimOutboxEvents(prisma, 2, 30_000),
    ]);

    const claimedIds = [...batchA, ...batchB].map((row) => row.id).sort();
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(claimedIds.length).toBe(4);
    expect(batchA.every((row) => row.status === 'PROCESSING')).toBe(true);
    expect(batchB.every((row) => row.status === 'PROCESSING')).toBe(true);

    await prisma.outboxEvent.deleteMany({
      where: { id: { in: ids } },
    });
  });

  it('reclaims rows whose lease has expired', async () => {
    const id = randomUUID();
    await prisma.outboxEvent.create({
      data: {
        id,
        eventType: 'TestEvent',
        payload: { id },
        status: 'PROCESSING',
        attemptCount: 1,
        createdAt: new Date('1970-01-01T00:00:00.000Z'),
        lockedAt: new Date(Date.now() - 60_000),
        lockedUntil: new Date(Date.now() - 1_000),
      },
    });

    const claimed = await claimOutboxEvents(prisma, 1, 30_000);
    expect(claimed.some((row) => row.id === id)).toBe(true);
    const row = claimed.find((item) => item.id === id);
    expect(row?.attemptCount).toBe(2);
    expect(row?.claimGeneration).toBe(1n);

    await prisma.outboxEvent.update({
      where: { id },
      data: { lockedUntil: new Date(Date.now() - 1_000) },
    });
    const reclaimed = await claimOutboxEvents(prisma, 1, 30_000);
    const newOwner = reclaimed.find((item) => item.id === id);
    expect(newOwner?.claimGeneration).toBe(2n);
    expect(await markOutboxProcessed(prisma, id, row!.claimGeneration)).toBe(false);
    expect(await markOutboxRetry(prisma, id, row!.claimGeneration, 'stale', 0)).toBe(false);
    expect(await markOutboxDeadLetter(prisma, id, row!.claimGeneration, 'stale')).toBe(false);
    expect(await markOutboxProcessed(prisma, id, newOwner!.claimGeneration)).toBe(true);
    expect((await claimOutboxEvents(prisma, 1, 30_000)).some((item) => item.id === id)).toBe(false);

    await prisma.outboxEvent.delete({ where: { id } });
  });
});

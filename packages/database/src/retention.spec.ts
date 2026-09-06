import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';
import { deleteExpiredIdempotencyBatch, deleteProcessedOutboxBatch } from './retention';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('retention batch deletes', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deletes old PROCESSED outbox rows and keeps DEAD_LETTER', async () => {
    const old = new Date(Date.now() - 30 * 86_400_000);
    const processedId = randomUUID();
    const deadId = randomUUID();
    await prisma.outboxEvent.createMany({
      data: [
        {
          id: processedId,
          eventType: 'retention-test',
          payload: {},
          status: 'PROCESSED',
          processedAt: old,
        },
        {
          id: deadId,
          eventType: 'retention-test',
          payload: {},
          status: 'DEAD_LETTER',
          processedAt: old,
        },
      ],
    });

    const deleted = await deleteProcessedOutboxBatch(prisma, 14, 100);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.outboxEvent.findUnique({ where: { id: processedId } })).toBeNull();
    expect(await prisma.outboxEvent.findUnique({ where: { id: deadId } })).not.toBeNull();
    await prisma.outboxEvent.deleteMany({ where: { id: { in: [deadId] } } });
  });

  it('deletes old idempotency rows in a bounded batch', async () => {
    const id = randomUUID();
    await prisma.idempotencyRecord.create({
      data: {
        id,
        tenantId: randomUUID(),
        actorId: randomUUID(),
        operation: 'visit.create',
        key: `ret-${id}`,
        requestHash: 'abc',
        resourceType: 'visit',
        resourceId: randomUUID(),
        createdAt: new Date(Date.now() - 30 * 86_400_000),
      },
    });
    const deleted = await deleteExpiredIdempotencyBatch(prisma, 7, 100);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.idempotencyRecord.findUnique({ where: { id } })).toBeNull();
  });
});

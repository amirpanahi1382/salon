import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('idempotency_records constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('enforces uniqueness per tenant, actor, operation, and key', async () => {
    const tenantId = randomUUID();
    const actorId = randomUUID();
    const resourceId = randomUUID();

    await prisma.idempotencyRecord.create({
      data: {
        id: randomUUID(),
        tenantId,
        actorId,
        operation: 'VISIT_CREATE',
        key: 'retry-key-01',
        requestHash: 'abc',
        resourceType: 'visit',
        resourceId,
      },
    });

    await expect(
      prisma.idempotencyRecord.create({
        data: {
          id: randomUUID(),
          tenantId,
          actorId,
          operation: 'VISIT_CREATE',
          key: 'retry-key-01',
          requestHash: 'def',
          resourceType: 'visit',
          resourceId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

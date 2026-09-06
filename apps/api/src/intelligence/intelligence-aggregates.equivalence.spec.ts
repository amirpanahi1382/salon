import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@salon/database';
import { deriveCustomerBehavior } from '@salon/shared';
import { behaviorFromAggregate, loadCustomerBehaviorRow } from './intelligence-aggregates';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('intelligence SQL aggregates match visit-date rules', () => {
  const prisma = createPrismaClient(databaseUrl as string);
  const asOf = new Date('2026-09-05T12:00:00.000Z');

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('matches deriveCustomerBehavior including same-day visits', async () => {
    const salonId = randomUUID();
    const customerId = randomUUID();
    await prisma.salon.create({
      data: { id: salonId, name: 'eq', updatedAt: new Date() },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        salonId,
        firstName: 'Eq',
        lastName: 'Test',
        phoneNumber: `09${Date.now().toString().slice(-9)}`,
        updatedAt: new Date(),
      },
    });
    const visits = [
      new Date('2026-08-01T10:00:00.000Z'),
      new Date('2026-08-01T16:00:00.000Z'),
      new Date('2026-08-20T10:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    ];
    await prisma.visit.createMany({
      data: visits.map((visitedAt) => ({
        id: randomUUID(),
        salonId,
        customerId,
        visitedAt,
        updatedAt: new Date(),
      })),
    });

    const client = prisma;
    const loaded = await loadCustomerBehaviorRow(client, salonId, customerId, asOf);
    const expected = deriveCustomerBehavior(visits, asOf);
    expect(loaded?.behavior).toEqual(expected);

    await prisma.visit.deleteMany({ where: { salonId } });
    await prisma.customer.deleteMany({ where: { salonId } });
    await prisma.salon.delete({ where: { id: salonId } });
  });

  it('maps empty visits to NEW behavior', () => {
    expect(
      behaviorFromAggregate(
        {
          visitCount: 0,
          firstVisitAt: null,
          lastVisitAt: null,
          averageReturnIntervalDays: null,
        },
        asOf,
      ),
    ).toEqual(deriveCustomerBehavior([], asOf));
  });
});

import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('customers constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('enforces phone uniqueness per salon, not globally', async () => {
    const salonA = randomUUID();
    const salonB = randomUUID();
    const phone = `0912${Date.now().toString().slice(-7)}`;

    await prisma.salon.createMany({
      data: [
        { id: salonA, name: 'A', updatedAt: new Date() },
        { id: salonB, name: 'B', updatedAt: new Date() },
      ],
    });

    await prisma.customer.create({
      data: {
        id: randomUUID(),
        salonId: salonA,
        firstName: 'Sara',
        lastName: 'A',
        phoneNumber: phone,
        updatedAt: new Date(),
      },
    });

    await prisma.customer.create({
      data: {
        id: randomUUID(),
        salonId: salonB,
        firstName: 'Sara',
        lastName: 'B',
        phoneNumber: phone,
        updatedAt: new Date(),
      },
    });

    await expect(
      prisma.customer.create({
        data: {
          id: randomUUID(),
          salonId: salonA,
          firstName: 'Duplicate',
          lastName: 'A',
          phoneNumber: phone,
          updatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

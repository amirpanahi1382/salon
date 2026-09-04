import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('users constraints', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('enforces globally unique user email', async () => {
    const salonA = randomUUID();
    const salonB = randomUUID();
    const email = `unique-${Date.now()}@example.test`;

    await prisma.salon.createMany({
      data: [
        { id: salonA, name: 'A', updatedAt: new Date() },
        { id: salonB, name: 'B', updatedAt: new Date() },
      ],
    });

    await prisma.user.create({
      data: {
        id: randomUUID(),
        salonId: salonA,
        name: 'Owner A',
        email,
        passwordHash: 'not-a-real-hash',
        role: 'OWNER',
        updatedAt: new Date(),
      },
    });

    await expect(
      prisma.user.create({
        data: {
          id: randomUUID(),
          salonId: salonB,
          name: 'Owner B',
          email,
          passwordHash: 'not-a-real-hash',
          role: 'OWNER',
          updatedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

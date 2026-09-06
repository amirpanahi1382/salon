/**
 * Opt-in development catalog. Does not run on API startup or migrate.
 *
 * Upserts tenant-scoped "Hair Service" and "Nail Service" for ACTIVE salons
 * whose OWNER email is not an automated @example.test account.
 *
 *   pnpm db:ensure-dev-catalog
 */
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const CATALOG = ['Hair Service', 'Nail Service'];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const salons = await prisma.salon.findMany({
      where: {
        status: 'ACTIVE',
        users: {
          some: {
            role: 'OWNER',
            status: 'ACTIVE',
            NOT: { email: { endsWith: '@example.test' } },
          },
        },
      },
      select: { id: true, name: true },
    });

    let created = 0;
    let existing = 0;
    for (const salon of salons) {
      for (const name of CATALOG) {
        const found = await prisma.service.findFirst({
          where: { salonId: salon.id, name },
          select: { id: true },
        });
        if (found) {
          existing += 1;
          continue;
        }
        await prisma.service.create({
          data: {
            id: randomUUID(),
            salonId: salon.id,
            name,
            status: 'ACTIVE',
            updatedAt: new Date(),
          },
        });
        created += 1;
      }
    }
    console.log(
      `dev catalog salons=${salons.length} created=${created} alreadyPresent=${existing}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'ensure-dev-catalog failed');
  process.exit(1);
});

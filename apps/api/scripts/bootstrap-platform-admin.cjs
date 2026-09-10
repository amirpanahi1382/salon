/**
 * Development-only platform admin upsert from PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD.
 * Same rules as apps/api/src/auth/bootstrap-platform-admin.ts. Never prints the password.
 *
 *   pnpm db:bootstrap-admin
 */
const argon2 = require('argon2');
const { loadConfig } = require('@salon/config');
const { createPrismaClient } = require('@salon/database');
const { createId } = require('@salon/shared');

async function main() {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('Platform admin bootstrap is not allowed when NODE_ENV=production');
  }
  const email = config.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = config.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must both be set for development bootstrap',
    );
  }

  const prisma = createPrismaClient(config.DATABASE_URL, { connectionLimit: 2 });
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const existing = await prisma.platformAdmin.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      await prisma.platformAdmin.update({
        where: { id: existing.id },
        data: { passwordHash, status: 'ACTIVE', updatedAt: new Date() },
      });
    } else {
      await prisma.platformAdmin.create({
        data: {
          id: createId(),
          email,
          passwordHash,
          name: 'Platform Admin',
          updatedAt: new Date(),
        },
      });
    }
    console.log('Platform admin bootstrap complete.');
    console.log(`Email: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'bootstrap-platform-admin failed');
  process.exit(1);
});

/**
 * Classify reviewed VIP lists into ORIGINAL_TEHRAN.
 *
 *   DATABASE_URL=postgresql://...@127.0.0.1:15442/salon_preview \
 *   node packages/database/scripts/classify-vip-catalog-membership.cjs \
 *     --database salon_preview \
 *     --actor-admin-id <platform-admin-uuid> \
 *     --manifest /path/to/manifest.csv
 *
 * Refuses database name salon and host port 5432. Does not print the URL,
 * contacts, or credentials.
 */
const { readFileSync } = require('node:fs');
const {
  assertDisposableCatalogTarget,
  classifyVipCatalogMembership,
  createPrismaClient,
} = require('../dist/index.js');

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : 'classification failed';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-database-url]');
}

async function main() {
  const expectedDatabase = argument('--database');
  const actorAdminId = argument('--actor-admin-id');
  const manifestPath = argument('--manifest');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  assertDisposableCatalogTarget(databaseUrl, expectedDatabase);
  const manifestCsv = readFileSync(manifestPath, 'utf8');
  const prisma = createPrismaClient(databaseUrl, { connectionLimit: 1 });
  try {
    const result = await classifyVipCatalogMembership(prisma, {
      manifestCsv,
      actorAdminId,
      expectedDatabase,
    });
    process.stdout.write(`${JSON.stringify({ database: expectedDatabase, ...result })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${safeMessage(error)}\n`);
  process.exit(1);
});

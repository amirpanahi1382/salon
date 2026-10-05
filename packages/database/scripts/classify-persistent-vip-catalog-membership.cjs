/**
 * Classify reviewed VIP lists into ORIGINAL_TEHRAN on the persistent salon database.
 *
 * Requires --confirm PERSISTENT_SALON, --database salon, the server system
 * identifier, an active platform admin, and a manifest path. The disposable
 * classifier remains unable to target database salon or host port 5432.
 *
 * Does not print the URL, contacts, or credentials.
 */
const { readFileSync } = require('node:fs');
const {
  PERSISTENT_CATALOG_CONFIRMATION,
  assertPersistentCatalogTarget,
  classifyPersistentVipCatalogMembership,
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
  const confirmation = argument('--confirm');
  if (confirmation !== PERSISTENT_CATALOG_CONFIRMATION) {
    throw new Error('Missing persistent confirmation');
  }
  const expectedDatabase = argument('--database');
  const systemIdentifier = argument('--system-identifier');
  const actorAdminId = argument('--actor-admin-id');
  const manifestPath = argument('--manifest');
  const hostPort = argument('--host-port');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  assertPersistentCatalogTarget(databaseUrl, {
    expectedDatabase,
    systemIdentifier,
    confirmation,
    hostPort,
  });
  const manifestCsv = readFileSync(manifestPath, 'utf8');
  const prisma = createPrismaClient(databaseUrl, { connectionLimit: 1 });
  try {
    const result = await classifyPersistentVipCatalogMembership(prisma, {
      manifestCsv,
      actorAdminId,
      expectedDatabase,
      systemIdentifier,
      confirmation,
      hostPort,
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

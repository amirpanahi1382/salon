/**
 * Runs before and after canonical Prisma migrate.
 * Identity values come from the environment, not from the database being judged.
 * A mismatch exits before any ledger change.
 */
const DENIED = new Set(['salon', 'salon_preview', 'salon_opp_integrity_20261024']);
const KNOWN_FAILURES = new Set([
  'Canonical migration identity is incomplete',
  'Canonical migration identity is not allowed',
  'Canonical migration identity could not be read',
  'Canonical migration is not connected as salon_migrator',
  'Canonical migration identity does not match',
]);

const LEDGER_REVOKE_SQL = [
  'REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM salon_app',
  'REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM PUBLIC',
];

const AUDIT_RESTRICT_SQL = `DO $$
DECLARE
  col text;
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RETURN;
  END IF;
  REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM salon_app;
  REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM PUBLIC;
  GRANT SELECT, INSERT ON TABLE public.audit_logs TO salon_app;
  FOR col IN
    SELECT attname::text
    FROM pg_attribute
    WHERE attrelid = 'public.audit_logs'::regclass
      AND attnum > 0
      AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.audit_logs FROM salon_app, PUBLIC', col);
  END LOOP;
END $$`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  const error = new Error(message);
  error.canonicalGuard = true;
  throw error;
}

function ledgerCleanupPlan(ledgerPresent) {
  const sql = ledgerPresent ? LEDGER_REVOKE_SQL.slice() : [];
  sql.push(AUDIT_RESTRICT_SQL);
  if (!ledgerPresent) {
    return { sql, marker: 'CANONICAL_MIGRATE_LEDGER_ABSENT' };
  }
  return { sql, marker: 'CANONICAL_MIGRATE_LEDGER_LOCKED' };
}

function expectedIdentity() {
  return {
    name: process.env.CANONICAL_DATABASE_NAME || '',
    systemIdentifier: process.env.CANONICAL_SYSTEM_IDENTIFIER || '',
    comment: process.env.CANONICAL_DATABASE_COMMENT || '',
  };
}

function assertExpectedIdentity(expected) {
  if (!expected.name || !expected.systemIdentifier || !expected.comment || DENIED.has(expected.name)) {
    fail('Canonical migration identity is incomplete');
  }
}

async function applyLedgerCleanup(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT (to_regclass('public._prisma_migrations') IS NOT NULL) AS present
  `;
  const present = Boolean(rows[0] && (rows[0].present === true || rows[0].present === 't'));
  const plan = ledgerCleanupPlan(present);
  for (const statement of plan.sql) {
    await prisma.$executeRawUnsafe(statement);
  }
  return plan.marker;
}

async function main() {
  const expected = expectedIdentity();
  assertExpectedIdentity(expected);
  const revokeLedger = process.argv.includes('--revoke-ledger');
  const path = require('path');
  module.paths.unshift(path.join(__dirname, '..', 'packages', 'database', 'node_modules'));
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    let row;
    try {
      const rows = await prisma.$queryRaw`
        SELECT current_user::text AS role,
               database_name,
               system_identifier,
               database_comment
        FROM canonical_database_identity()
      `;
      row = rows[0];
    } catch {
      fail('Canonical migration identity could not be read');
    }
    if (!row || row.role !== 'salon_migrator') {
      fail('Canonical migration is not connected as salon_migrator');
    }
    if (
      row.database_name !== expected.name ||
      row.system_identifier !== expected.systemIdentifier ||
      row.database_comment !== expected.comment
    ) {
      fail('Canonical migration identity does not match');
    }
    if (revokeLedger) {
      try {
        const marker = await applyLedgerCleanup(prisma);
        process.stdout.write(`${marker}\n`);
      } catch (error) {
        process.stderr.write('CANONICAL_MIGRATE_LEDGER_CLEANUP_FAILED\n');
        process.exitCode = 2;
        return;
      }
      return;
    }
    process.stdout.write(`CANONICAL_MIGRATE_IDENTITY_OK ${row.database_name}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    if (!(error instanceof Error) || !KNOWN_FAILURES.has(error.message)) {
      process.stderr.write('Canonical migration guard failed\n');
    }
    if (!process.exitCode) process.exitCode = 1;
  });
}

module.exports = {
  ledgerCleanupPlan,
  LEDGER_REVOKE_SQL,
  AUDIT_RESTRICT_SQL,
};

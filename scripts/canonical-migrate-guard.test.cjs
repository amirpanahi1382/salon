const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ledgerCleanupPlan, LEDGER_REVOKE_SQL, AUDIT_RESTRICT_SQL } = require('./canonical-migrate-guard.cjs');

test('an absent migration ledger still applies the safe audit restriction', () => {
  const plan = ledgerCleanupPlan(false);
  assert.deepEqual(plan.sql, [AUDIT_RESTRICT_SQL]);
  assert.equal(plan.marker, 'CANONICAL_MIGRATE_LEDGER_ABSENT');
  assert.equal(plan.sql[0].includes('to_regclass(\'public.audit_logs\') IS NULL'), true);
  assert.equal(plan.sql[0].includes('salon_migrator'), false);
});

test('a present ledger revokes runtime privileges from salon_app and PUBLIC', () => {
  const plan = ledgerCleanupPlan(true);
  assert.deepEqual(plan.sql.slice(0, 2), LEDGER_REVOKE_SQL);
  assert.equal(plan.sql[2], AUDIT_RESTRICT_SQL);
  assert.equal(plan.marker, 'CANONICAL_MIGRATE_LEDGER_LOCKED');
  assert.equal(plan.sql.length, 3);
  for (const statement of plan.sql.slice(0, 2)) {
    assert.equal(statement.includes('GRANT'), false);
  }
  assert.equal(plan.sql[2].includes('GRANT SELECT, INSERT ON TABLE public.audit_logs TO salon_app'), true);
  assert.equal(plan.sql[2].includes('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM salon_app'), true);
  assert.equal(plan.sql.some((statement) => statement.includes('salon_migrator')), false);
});

test('the shell verifies identity before Prisma and preserves a failed deploy status', () => {
  const source = fs.readFileSync(path.join(__dirname, 'canonical-migrate.sh'), 'utf8');
  const identity = source.indexOf('canonical-migrate-guard.cjs"');
  const deploy = source.indexOf('migrate:deploy');
  const prismaStatus = source.indexOf('prisma_status=$?');
  const revoke = source.indexOf('--revoke-ledger');
  const cleanupFailed = source.indexOf('CANONICAL_MIGRATE_LEDGER_CLEANUP_FAILED');
  const preserve = source.indexOf('exit "$prisma_status"');
  assert.ok(identity !== -1 && deploy !== -1 && prismaStatus !== -1 && revoke !== -1);
  assert.ok(identity < deploy);
  assert.ok(deploy < prismaStatus);
  assert.ok(prismaStatus < revoke);
  assert.ok(revoke < cleanupFailed);
  assert.ok(cleanupFailed < preserve);
  assert.equal(source.includes('ON CONFLICT'), false);
});

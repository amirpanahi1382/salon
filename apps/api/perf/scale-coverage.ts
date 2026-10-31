/**
 * Adds representative rows to the existing disposable scale database.
 * Does not truncate. Refuses every canonical identity.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@salon/database';
import { comparableJalaliMonthWindows } from '@salon/shared';

const SUPER_URL = 'postgresql://salon@127.0.0.1:55931/salon_metric_oracle_20261030';
const LARGE = '55555555-5555-4555-8555-555555555555';
const LARGE_USER = '55555555-5555-4555-8555-555555555511';
const LARGE_SERVICE = '55555555-5555-4555-8555-555555555521';
const SKEW = '55555555-5555-4555-8555-5555555555a1';
const SKEW_USER = '55555555-5555-4555-8555-555555555512';
const ADMIN = '55555555-5555-4555-8555-555555555501';
const LIST = '55555555-5555-4555-8555-5555555555d1';

async function main(): Promise<void> {
  const parsed = new URL(SUPER_URL);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55931') {
    throw new Error('Refusing a non-disposable target');
  }
  const db = createPrismaClient(SUPER_URL, { connectionLimit: 1, poolTimeoutSeconds: 30 });
  const identity = await db.$queryRaw<Array<{ systemId: string; comment: string | null }>>`
    SELECT (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemId",
           (SELECT description FROM pg_catalog.pg_shdescription
              JOIN pg_catalog.pg_database ON objoid = pg_database.oid
             WHERE datname = current_database()) AS comment
  `;
  if (identity[0]?.systemId === '7700113693112733735' || identity[0]?.comment !== 'metric-oracle-disposable:20261030') {
    throw new Error('Refusing a database that is not the disposable oracle');
  }
  const windows = comparableJalaliMonthWindows(new Date());
  const previousAt = new Date(windows.previousStart.getTime() + 3_600_000);
  const qualifying = 251;
  await db.$executeRawUnsafe('SET statement_timeout = 0');
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      INSERT INTO customers (id, salon_id, first_name, last_name, phone_number, created_at, updated_at)
      SELECT (
          '55555555-5555-4' || substr(md5('drop:' || i::text), 1, 3) || '-' ||
          '8' || substr(md5('drop:' || i::text), 5, 3) || '-' || substr(md5('drop:' || i::text), 8, 12)
        )::uuid,
        '${LARGE}'::uuid, 'Drop', i::text, '096' || lpad(i::text, 8, '0'), NOW(), NOW()
      FROM generate_series(1, ${qualifying}) AS i
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO transactions (
        id, salon_id, customer_id, occurred_at, amount, currency, status, created_at, updated_at
      )
      SELECT (
          '55555555-5555-4' || substr(md5('drop-t:' || i::text), 1, 3) || '-' ||
          '8' || substr(md5('drop-t:' || i::text), 5, 3) || '-' || substr(md5('drop-t:' || i::text), 8, 12)
        )::uuid,
        '${LARGE}'::uuid,
        (
          '55555555-5555-4' || substr(md5('drop:' || i::text), 1, 3) || '-' ||
          '8' || substr(md5('drop:' || i::text), 5, 3) || '-' || substr(md5('drop:' || i::text), 8, 12)
        )::uuid,
        $1, (1000 + i)::numeric(19, 2), 'IRR', 'COMPLETED', NOW(), NOW()
      FROM generate_series(1, ${qualifying}) AS i
      ON CONFLICT (id) DO NOTHING
    `, previousAt);
    await tx.$executeRawUnsafe(`
      INSERT INTO transaction_items (id, salon_id, transaction_id, service_id, quantity, unit_price, total_amount)
      SELECT (
          '55555555-5555-4' || substr(md5('drop-i:' || i::text), 1, 3) || '-' ||
          '8' || substr(md5('drop-i:' || i::text), 5, 3) || '-' || substr(md5('drop-i:' || i::text), 8, 12)
        )::uuid,
        '${LARGE}'::uuid,
        (
          '55555555-5555-4' || substr(md5('drop-t:' || i::text), 1, 3) || '-' ||
          '8' || substr(md5('drop-t:' || i::text), 5, 3) || '-' || substr(md5('drop-t:' || i::text), 8, 12)
        )::uuid,
        '${LARGE_SERVICE}'::uuid,
        1,
        (1000 + i)::numeric(19, 2),
        (1000 + i)::numeric(19, 2)
      FROM generate_series(1, ${qualifying}) AS i
      ON CONFLICT (id) DO NOTHING
    `);
  }, { timeout: 60_000 });
  await db.vipTargetList.upsert({
    where: { id: LIST },
    update: {},
    create: {
      id: LIST, name: 'scale-coverage', status: 'ACTIVE', contactCount: 30,
      regionCode: '01', catalogMembership: 'ORIGINAL_TEHRAN', createdByAdminId: ADMIN, updatedAt: new Date(),
    },
  });
  const now = new Date();
  for (const row of [
    { id: '55555555-5555-4555-8555-5555555555e1', salonId: LARGE, userId: LARGE_USER, status: 'SUBMITTED' as const, count: 50 },
    { id: '55555555-5555-4555-8555-5555555555e2', salonId: SKEW, userId: SKEW_USER, status: 'MANUAL_QUEUED' as const, count: 30 },
    { id: '55555555-5555-4555-8555-5555555555e3', salonId: LARGE, userId: LARGE_USER, status: 'CANCELLED' as const, count: 30 },
  ]) {
    await db.vipRequest.upsert({
      where: { id: row.id },
      update: {},
      create: {
        id: row.id, salonId: row.salonId, listId: LIST, createdByUserId: row.userId,
        requestedCount: row.count, geographicRange: 'scale', status: row.status,
        reservedUntil: now,
        submittedAt: row.status === 'CANCELLED' ? null : now,
        cancelledAt: row.status === 'CANCELLED' ? now : null,
        updatedAt: now,
      },
    });
  }
  const counts = await db.$queryRaw<Array<{ drops: number; requests: number }>>`
    SELECT
      (SELECT COUNT(*)::int FROM customers WHERE salon_id = ${LARGE}::uuid AND first_name = 'Drop') AS drops,
      (SELECT COUNT(*)::int FROM vip_requests WHERE list_id = ${LIST}::uuid) AS requests
  `;
  process.stdout.write(`${JSON.stringify({ listId: LIST, ...counts[0], unused: randomUUID() })}\n`);
  await db.$disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`FAILED ${error instanceof Error ? error.message : 'failed'}\n`);
  process.exit(1);
});

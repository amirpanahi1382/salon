/**
 * Disposable large-scale seed and EXPLAIN. Refuses canonical databases.
 *
 *   tsx perf/scale-seed.ts --destructive-reset
 *
 * Truncates salon_metric_oracle_20261030 only after that flag and an identity check.
 *
 * Superuser seed URL is loopback trust on salon-metric-oracle-pg-20261030.
 * Read timings use salon_app with the role's own statement timeout.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createPrismaClient, type PrismaClient } from '@salon/database';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SalonOverallPerformanceRepository } from '../src/salon/salon-overall-performance.repository';

const SUPER_URL = 'postgresql://salon@127.0.0.1:55931/salon_metric_oracle_20261030';
const APP_URL = 'postgresql://salon_app@127.0.0.1:55931/salon_metric_oracle_20261030';
const EXPECTED_DATABASE = 'salon_metric_oracle_20261030';
const EXPECTED_COMMENT = 'metric-oracle-disposable:20261030';
const REFUSED_SYSTEM_IDS = new Set(['7700113693112733735', '7683163620851879970']);
const LARGE = '55555555-5555-4555-8555-555555555555';
const SKEW_A = '55555555-5555-4555-8555-5555555555a1';
const SKEW_B = '55555555-5555-4555-8555-5555555555b1';
const ADMIN = '55555555-5555-4555-8555-555555555501';
const LARGE_USER = '55555555-5555-4555-8555-555555555511';
const LARGE_SERVICE = '55555555-5555-4555-8555-555555555521';

function assertUrl(url: string): void {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55931' || database !== EXPECTED_DATABASE) {
    throw new Error('Refusing a database that is not the disposable oracle');
  }
}

async function identity(db: PrismaClient): Promise<string> {
  const rows = await db.$queryRaw<Array<{ name: string; systemId: string; comment: string | null }>>`
    SELECT current_database() AS name,
           (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemId",
           (SELECT description FROM pg_catalog.pg_shdescription
              JOIN pg_catalog.pg_database ON objoid = pg_database.oid
             WHERE datname = current_database()) AS comment
  `;
  const row = rows[0];
  if (!row || row.name !== EXPECTED_DATABASE || row.comment !== EXPECTED_COMMENT) {
    throw new Error('Disposable database identity does not match');
  }
  if (REFUSED_SYSTEM_IDS.has(row.systemId)) {
    throw new Error('Refusing a canonical PostgreSQL system identifier');
  }
  return row.systemId;
}

function customerId(salonId: string) {
  return `(
    '55555555-5555-4' ||
    substr(md5('${salonId}' || ':c:' || i::text), 1, 3) || '-' ||
    '8' || substr(md5('${salonId}' || ':c:' || i::text), 5, 3) || '-' ||
    substr(md5('${salonId}' || ':c:' || i::text), 8, 12)
  )::uuid`;
}

async function seedSalon(
  db: PrismaClient,
  salonId: string,
  userId: string,
  serviceId: string,
  customers: number,
  visitsEach: number,
  phoneBase: number,
  now: Date,
): Promise<void> {
  await db.salon.create({ data: { id: salonId, name: `Scale ${customers}`, updatedAt: now } });
  await db.user.create({
    data: {
      id: userId,
      salonId,
      name: 'Scale Owner',
      phone: `09${String(phoneBase).padStart(9, '0')}`.slice(0, 11),
      passwordHash: 'not-a-login',
      role: 'OWNER',
      updatedAt: now,
    },
  });
  await db.service.create({ data: { id: serviceId, salonId, name: 'Scale', updatedAt: now } });
  const cid = customerId(salonId);
  await db.$executeRawUnsafe(`
    INSERT INTO customers (id, salon_id, first_name, last_name, phone_number, created_at, updated_at)
    SELECT ${cid}, '${salonId}'::uuid, 'C', i::text,
           ('09' || lpad((${phoneBase} + i)::text, 9, '0')),
           $1, $1
    FROM generate_series(1, ${customers}) AS i
  `, now);
  await db.$executeRawUnsafe(`
    INSERT INTO visits (id, salon_id, customer_id, visited_at, created_at, updated_at)
    SELECT (
        '55555555-5555-4' ||
        substr(md5('${salonId}' || ':v:' || i::text || ':' || n::text), 1, 3) || '-' ||
        '8' || substr(md5('${salonId}' || ':v:' || i::text || ':' || n::text), 5, 3) || '-' ||
        substr(md5('${salonId}' || ':v:' || i::text || ':' || n::text), 8, 12)
      )::uuid,
      '${salonId}'::uuid,
      ${cid},
      $1 - ((n)::text || ' days')::interval,
      $1, $1
    FROM generate_series(1, ${customers}) AS i
    CROSS JOIN generate_series(1, ${visitsEach}) AS n
  `, now);
  await db.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`
    INSERT INTO transactions (
      id, salon_id, customer_id, occurred_at, amount, currency, status, created_at, updated_at
    )
    SELECT (
        '55555555-5555-4' ||
        substr(md5('${salonId}' || ':t:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5('${salonId}' || ':t:' || i::text), 5, 3) || '-' ||
        substr(md5('${salonId}' || ':t:' || i::text), 8, 12)
      )::uuid,
      '${salonId}'::uuid,
      ${cid},
      $1,
      (1000 + (i % 100) * 0.01)::numeric(19, 2),
      'IRR',
      CASE WHEN i % 17 = 0 THEN 'VOIDED'::"TransactionStatus" ELSE 'COMPLETED'::"TransactionStatus" END,
      $1, $1
    FROM generate_series(1, ${customers}) AS i
  `, now);
  await tx.$executeRawUnsafe(`
    INSERT INTO transaction_items (
      id, salon_id, transaction_id, service_id, quantity, unit_price, total_amount
    )
    SELECT (
        '55555555-5555-4' ||
        substr(md5('${salonId}' || ':i:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5('${salonId}' || ':i:' || i::text), 5, 3) || '-' ||
        substr(md5('${salonId}' || ':i:' || i::text), 8, 12)
      )::uuid,
      '${salonId}'::uuid,
      (
        '55555555-5555-4' ||
        substr(md5('${salonId}' || ':t:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5('${salonId}' || ':t:' || i::text), 5, 3) || '-' ||
        substr(md5('${salonId}' || ':t:' || i::text), 8, 12)
      )::uuid,
      '${serviceId}'::uuid,
      1,
      (1000 + (i % 100) * 0.01)::numeric(19, 2),
      (1000 + (i % 100) * 0.01)::numeric(19, 2)
    FROM generate_series(1, ${customers}) AS i
  `);
  }, { timeout: 180_000 });
  await db.$executeRawUnsafe(`
    INSERT INTO message_requests (
      id, salon_id, customer_id, created_by_user_id, recipient_phone_number, message_text,
      requested_at, message_business_date, counts_toward_daily_limit, status, created_at, updated_at
    )
    SELECT (
        '55555555-5555-4' ||
        substr(md5('${salonId}' || ':m:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5('${salonId}' || ':m:' || i::text), 5, 3) || '-' ||
        substr(md5('${salonId}' || ':m:' || i::text), 8, 12)
      )::uuid,
      '${salonId}'::uuid,
      ${cid},
      '${userId}'::uuid,
      ('09' || lpad((${phoneBase} + i)::text, 9, '0')),
      'scale',
      $1,
      ($1::date - i),
      false,
      CASE WHEN i % 23 = 0 THEN 'CANCELLED'::"MessageRequestStatus" ELSE 'SENT'::"MessageRequestStatus" END,
      $1, $1
    FROM generate_series(1, ${customers}) AS i
  `, now);
  await db.$executeRawUnsafe(`
    INSERT INTO message_deliveries (
      id, salon_id, message_request_id, customer_id, mode, channel, status,
      provider_request_id, attempts, created_by, submitted_at, created_at, updated_at
    )
    SELECT (
        '55555555-5555-4' ||
        substr(md5('${salonId}' || ':d:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5('${salonId}' || ':d:' || i::text), 5, 3) || '-' ||
        substr(md5('${salonId}' || ':d:' || i::text), 8, 12)
      )::uuid,
      '${salonId}'::uuid,
      (
        '55555555-5555-4' ||
        substr(md5('${salonId}' || ':m:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5('${salonId}' || ':m:' || i::text), 5, 3) || '-' ||
        substr(md5('${salonId}' || ':m:' || i::text), 8, 12)
      )::uuid,
      ${cid},
      'MANUAL'::"MessageDeliveryMode",
      'TEXT'::"MessageChannel",
      'SENT'::"MessageDeliveryStatus",
      md5('${salonId}' || ':p:' || i::text),
      1,
      '${userId}'::uuid,
      $1, $1, $1
    FROM generate_series(1, ${customers}) AS i
    WHERE i % 23 <> 0
  `, now);
}

async function main(): Promise<void> {
  if (!process.argv.includes('--destructive-reset')) {
    throw new Error('Refusing to truncate the benchmark database without --destructive-reset');
  }
  assertUrl(SUPER_URL);
  assertUrl(APP_URL);
  const superDb = createPrismaClient(SUPER_URL, { connectionLimit: 2, poolTimeoutSeconds: 30 });
  const systemIdentifier = await identity(superDb);
  await superDb.$executeRawUnsafe(`SET statement_timeout = 0`);
  await superDb.$executeRawUnsafe(`
    DO $$ DECLARE row record; BEGIN
      FOR row IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(row.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
  const now = new Date();
  const seedStarted = performance.now();
  await superDb.platformAdmin.create({
    data: { id: ADMIN, phone: '09125550000', passwordHash: 'not-a-login', name: 'Scale Admin', updatedAt: now },
  });
  await seedSalon(superDb, LARGE, LARGE_USER, LARGE_SERVICE, 50_000, 5, 300_000_000, now);
  await seedSalon(
    superDb,
    SKEW_A,
    '55555555-5555-4555-8555-555555555512',
    '55555555-5555-4555-8555-555555555522',
    2_000,
    2,
    400_000_000,
    now,
  );
  await seedSalon(
    superDb,
    SKEW_B,
    '55555555-5555-4555-8555-555555555513',
    '55555555-5555-4555-8555-555555555523',
    200,
    10,
    500_000_000,
    now,
  );
  await superDb.$executeRawUnsafe(`
    INSERT INTO visit_intentions (
      id, salon_id, subject, customer_id, time_precision, agreed_date, agreed_instant,
      report_channel, contact_basis, created_by_user_id, updated_by_user_id, created_at, updated_at
    )
    SELECT (
        '55555555-5555-4' ||
        substr(md5('${LARGE}' || ':vi:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5('${LARGE}' || ':vi:' || i::text), 5, 3) || '-' ||
        substr(md5('${LARGE}' || ':vi:' || i::text), 8, 12)
      )::uuid,
      '${LARGE}'::uuid,
      'CUSTOMER'::"VisitIntentionSubject",
      (
        '55555555-5555-4' ||
        substr(md5('${LARGE}' || ':c:' || i::text), 1, 3) || '-' ||
        '8' || substr(md5('${LARGE}' || ':c:' || i::text), 5, 3) || '-' ||
        substr(md5('${LARGE}' || ':c:' || i::text), 8, 12)
      )::uuid,
      CASE WHEN i % 3 = 0 THEN 'UNKNOWN'::"VisitIntentionTimePrecision"
           WHEN i % 3 = 1 THEN 'DATE'::"VisitIntentionTimePrecision"
           ELSE 'INSTANT'::"VisitIntentionTimePrecision" END,
      CASE WHEN i % 3 = 1 THEN DATE '2026-11-02' ELSE NULL END,
      CASE WHEN i % 3 = 2 THEN $1 ELSE NULL END,
      'SALON_STAFF'::"VisitIntentionReportChannel",
      'WITHHELD'::"VisitIntentionContactBasis",
      '${LARGE_USER}'::uuid,
      '${LARGE_USER}'::uuid,
      $1, $1
    FROM generate_series(1, 900) AS i
  `, now);
  await superDb.$executeRawUnsafe('ANALYZE');
  const seedMs = performance.now() - seedStarted;
  const counts = await superDb.$queryRawUnsafe<Array<Record<string, number>>>(`
    SELECT
      (SELECT COUNT(*)::int FROM customers) AS customers,
      (SELECT COUNT(*)::int FROM visits) AS visits,
      (SELECT COUNT(*)::int FROM transactions) AS transactions,
      (SELECT COUNT(*)::int FROM message_requests) AS message_requests,
      (SELECT COUNT(*)::int FROM message_deliveries) AS message_deliveries,
      (SELECT COUNT(*)::int FROM visit_intentions) AS visit_intentions,
      (SELECT COUNT(*)::int FROM customers WHERE salon_id = '${LARGE}'::uuid) AS large_customers,
      (SELECT COUNT(*)::int FROM visits WHERE salon_id = '${LARGE}'::uuid) AS large_visits
  `);
  const app = createPrismaClient(APP_URL, { connectionLimit: 10, poolTimeoutSeconds: 10 });
  await identity(app);
  const repository = new SalonOverallPerformanceRepository({ client: app } as PrismaService);
  let overall: { ms: number; revenue: string } | { error: string };
  const started = performance.now();
  try {
    const row = await repository.load(LARGE);
    overall = { ms: performance.now() - started, revenue: row.monthlyRecordedRevenueIrr };
  } catch (error) {
    overall = { error: error instanceof Error ? error.name : 'failed', ms: performance.now() - started } as { error: string };
  }
  const report = {
    database: EXPECTED_DATABASE,
    systemIdentifier,
    comment: EXPECTED_COMMENT,
    seedMs,
    counts: counts[0],
    salonAppOverall: overall,
  };
  writeFileSync('/tmp/salon-scale-seed.json', JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await app.$disconnect();
  await superDb.$disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`FAILED ${error instanceof Error ? error.message : 'failed'}\n`);
  process.exit(1);
});

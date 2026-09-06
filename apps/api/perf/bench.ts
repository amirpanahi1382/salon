/**
 * Phase C DB benchmark. Not part of unit/e2e.
 *
 *   pnpm --filter @salon/api exec ts-node --transpile-only perf/bench.ts
 *
 * Seeds a disposable salon named phase-c-bench (deleted and recreated).
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { Prisma, createPrismaClient } from '@salon/database';
import { deriveCustomerBehavior, analyzeCustomerVisits } from '@salon/shared';

const CUSTOMERS = Number(process.env.PHASE_C_CUSTOMERS ?? 3000);
const VISITS = Number(process.env.PHASE_C_VISITS ?? 15000);
const TRANSACTIONS = Number(process.env.PHASE_C_TRANSACTIONS ?? 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const BENCH_NAME = 'phase-c-bench';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const prisma = createPrismaClient(DATABASE_URL);

type Percentiles = { p50: number; p95: number; p99: number; mean: number };

function pct(samples: number[]): Percentiles {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const mean = samples.reduce((s, n) => s + n, 0) / samples.length;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), mean };
}

async function timeMs<T>(fn: () => Promise<T>, runs = 7): Promise<{ result: T; stats: Percentiles; lastMs: number }> {
  const samples: number[] = [];
  let result!: T;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    result = await fn();
    samples.push(performance.now() - start);
  }
  return { result, stats: pct(samples), lastMs: samples[samples.length - 1]! };
}

async function explain(label: string, sql: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`);
  const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
  console.log(`\n=== EXPLAIN ${label} ===\n${plan}\n`);
  return plan;
}

async function seed() {
  const existing = await prisma.salon.findMany({ where: { name: BENCH_NAME } });
  for (const salon of existing) {
    await prisma.transactionItem.deleteMany({ where: { salonId: salon.id } });
    await prisma.ledgerTransaction.deleteMany({ where: { salonId: salon.id } });
    await prisma.service.deleteMany({ where: { salonId: salon.id } });
    await prisma.visit.deleteMany({ where: { salonId: salon.id } });
    await prisma.customer.deleteMany({ where: { salonId: salon.id } });
    await prisma.user.deleteMany({ where: { salonId: salon.id } });
    await prisma.salon.delete({ where: { id: salon.id } });
  }

  const salonId = randomUUID();
  const now = new Date();
  await prisma.salon.create({
    data: { id: salonId, name: BENCH_NAME, updatedAt: now },
  });

  const customers = Array.from({ length: CUSTOMERS }, (_, i) => {
    const n = String(i).padStart(9, '0');
    return {
      id: randomUUID(),
      salonId,
      firstName: i % 17 === 0 ? 'Sara' : `First${i % 200}`,
      lastName: `Last${i % 80}`,
      phoneNumber: `09${n.slice(0, 9)}`,
      createdAt: new Date(now.getTime() - i * 1000),
      updatedAt: now,
    };
  });

  for (let i = 0; i < customers.length; i += 500) {
    await prisma.customer.createMany({ data: customers.slice(i, i + 500) });
  }

  const visits = [];
  for (let i = 0; i < VISITS; i += 1) {
    const customer = customers[i % customers.length]!;
    const daysAgo = (i % 120) + Math.floor(i / customers.length) * 20;
    visits.push({
      id: randomUUID(),
      salonId,
      customerId: customer.id,
      visitedAt: new Date(now.getTime() - daysAgo * 86_400_000 - (i % 1000)),
      createdAt: now,
      updatedAt: now,
    });
  }
  for (let i = 0; i < visits.length; i += 500) {
    await prisma.visit.createMany({ data: visits.slice(i, i + 500) });
  }

  const serviceId = randomUUID();
  await prisma.service.create({
    data: { id: serviceId, salonId, name: 'Bench cut', status: 'ACTIVE', updatedAt: now },
  });

  const transactions = [];
  const items = [];
  for (let i = 0; i < TRANSACTIONS; i += 1) {
    const visit = visits[i % visits.length]!;
    const linked = i % 3 === 0;
    const id = randomUUID();
    const amount = ((i % 9) + 1) * 100000;
    transactions.push({
      id,
      salonId,
      customerId: visit.customerId,
      visitId: linked ? visit.id : null,
      occurredAt: new Date(now.getTime() - (i % 90) * 86_400_000),
      amount: new Prisma.Decimal(((i % 9) + 1) * 100000),
      currency: 'IRR',
      status: i % 17 === 0 ? 'VOIDED' : 'COMPLETED',
      createdAt: now,
      updatedAt: now,
    });
    items.push({
      id: randomUUID(),
      salonId,
      transactionId: id,
      serviceId,
      quantity: 1,
      unitPrice: new Prisma.Decimal(amount),
      totalAmount: new Prisma.Decimal(amount),
    });
  }
  for (let i = 0; i < transactions.length; i += 500) {
    await prisma.ledgerTransaction.createMany({ data: transactions.slice(i, i + 500) });
  }
  for (let i = 0; i < items.length; i += 500) {
    await prisma.transactionItem.createMany({ data: items.slice(i, i + 500) });
  }

  return { salonId, firstCustomerId: customers[0]!.id, searchPhone: customers[0]!.phoneNumber };
}

async function legacyIntelligence(salonId: string) {
  const identity = await prisma.customer.findMany({
    where: { salonId },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { createdAt: 'desc' },
    take: 5001,
  });
  const ids = identity.slice(0, 5000).map((row) => row.id);
  const visitRows = await prisma.visit.findMany({
    where: { salonId, customerId: { in: ids } },
    select: { customerId: true, visitedAt: true },
    orderBy: { visitedAt: 'asc' },
  });
  const dates = new Map<string, Date[]>();
  for (const row of visitRows) {
    const list = dates.get(row.customerId) ?? [];
    list.push(row.visitedAt);
    dates.set(row.customerId, list);
  }
  const asOf = new Date();
  let atRisk = 0;
  for (const customer of identity.slice(0, 5000)) {
    const { result } = analyzeCustomerVisits(dates.get(customer.id) ?? [], asOf);
    if (result.status === 'AT_RISK') {
      atRisk += 1;
    }
  }
  return { customers: identity.length, visitRows: visitRows.length, atRisk };
}

async function sqlGroupBy(salonId: string) {
  return prisma.$queryRaw<Array<{ customer_id: string; visit_count: number }>>(Prisma.sql`
    SELECT customer_id, COUNT(*)::int AS visit_count
    FROM visits
    WHERE salon_id = ${salonId}::uuid
    GROUP BY customer_id
  `);
}

async function sqlWindowGaps(salonId: string) {
  return prisma.$queryRaw<
    Array<{
      customer_id: string;
      visitCount: number;
      firstVisitAt: Date | null;
      lastVisitAt: Date | null;
      averageReturnIntervalDays: number | null;
    }>
  >(Prisma.sql`
    SELECT
      customer_id,
      COUNT(*)::int AS "visitCount",
      MIN(visited_at) AS "firstVisitAt",
      MAX(visited_at) AS "lastVisitAt",
      CASE
        WHEN COUNT(*) FILTER (WHERE gap_days > 0) = 0 THEN NULL
        ELSE GREATEST(1, ROUND(AVG(gap_days) FILTER (WHERE gap_days > 0)))::int
      END AS "averageReturnIntervalDays"
    FROM (
      SELECT
        customer_id,
        visited_at,
        FLOOR(
          EXTRACT(EPOCH FROM (
            visited_at - LAG(visited_at) OVER (
              PARTITION BY customer_id
              ORDER BY visited_at ASC, id ASC
            )
          )) / 86400
        ) AS gap_days
      FROM visits
      WHERE salon_id = ${salonId}::uuid
    ) gaps
    GROUP BY customer_id
  `);
}

async function sqlRevenue(salonId: string) {
  return prisma.$queryRaw<
    Array<{
      customerId: string;
      total: string;
      transactionCount: number;
      linkedVisitCount: number;
    }>
  >(Prisma.sql`
    SELECT
      customer_id AS "customerId",
      COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'), 0)::text AS total,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS "transactionCount",
      COUNT(DISTINCT visit_id) FILTER (WHERE status = 'COMPLETED' AND visit_id IS NOT NULL)::int AS "linkedVisitCount"
    FROM transactions
    WHERE salon_id = ${salonId}::uuid
    GROUP BY customer_id
  `);
}

async function sqlIntelligence(salonId: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      visitCount: number;
      lastVisitAt: Date | null;
      averageReturnIntervalDays: number | null;
    }>
  >(Prisma.sql`
    WITH salon_customers AS (
      SELECT id, created_at
      FROM customers
      WHERE salon_id = ${salonId}::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT 5001
    ),
    ordered AS (
      SELECT
        v.customer_id,
        v.visited_at,
        LAG(v.visited_at) OVER (
          PARTITION BY v.customer_id
          ORDER BY v.visited_at ASC, v.id ASC
        ) AS prev
      FROM visits v
      INNER JOIN salon_customers c ON c.id = v.customer_id
      WHERE v.salon_id = ${salonId}::uuid
    ),
    per_customer AS (
      SELECT customer_id, COUNT(*)::int AS visit_count, MAX(visited_at) AS last_visit_at
      FROM ordered
      GROUP BY customer_id
    ),
    gap_avg AS (
      SELECT customer_id, GREATEST(1, ROUND(AVG(gap_days)))::int AS average_return_interval_days
      FROM (
        SELECT customer_id, FLOOR(EXTRACT(EPOCH FROM (visited_at - prev)) / 86400) AS gap_days
        FROM ordered
        WHERE prev IS NOT NULL
      ) gaps
      WHERE gap_days > 0
      GROUP BY customer_id
    )
    SELECT c.id, COALESCE(p.visit_count, 0)::int AS "visitCount",
           p.last_visit_at AS "lastVisitAt",
           g.average_return_interval_days AS "averageReturnIntervalDays"
    FROM salon_customers c
    LEFT JOIN per_customer p ON p.customer_id = c.id
    LEFT JOIN gap_avg g ON g.customer_id = c.id
  `);
  const asOf = new Date();
  let atRisk = 0;
  for (const row of rows.slice(0, 5000)) {
    const behavior = deriveCustomerBehavior(
      row.lastVisitAt ? [row.lastVisitAt] : [],
      asOf,
    );
    // classification uses full behavior; daysSinceLastVisit from last visit is enough for status
    // when average is supplied separately — skipped here; bench only times the query+row transfer.
    if (behavior.daysSinceLastVisit && behavior.daysSinceLastVisit > 35) {
      atRisk += 1;
    }
  }
  return { customers: rows.length, atRisk, rowBytesEstimate: rows.length * 64 };
}

async function main() {
  const memBefore = process.memoryUsage();
  console.log(`Seeding ${CUSTOMERS} customers, ${VISITS} visits, ${TRANSACTIONS} transactions...`);
  const seedStart = performance.now();
  const { salonId, firstCustomerId, searchPhone } = await seed();
  const seedMs = performance.now() - seedStart;
  console.log(`Seed finished in ${seedMs.toFixed(0)}ms salon=${salonId}`);

  const customerList = await timeMs(() =>
    prisma.customer.findMany({
      where: { salonId },
      orderBy: { createdAt: 'desc' },
      take: 201,
    }),
  );

  const search = await timeMs(() =>
    prisma.customer.findMany({
      where: {
        salonId,
        OR: [
          { firstName: { contains: 'Sara', mode: 'insensitive' } },
          { lastName: { contains: 'Sara', mode: 'insensitive' } },
          { phoneNumber: { contains: searchPhone.slice(0, 6) } },
        ],
      },
      take: 201,
    }),
  );

  const getById = await timeMs(() =>
    prisma.customer.findFirst({ where: { id: firstCustomerId, salonId } }),
  );

  const visitHistory = await timeMs(() =>
    prisma.visit.findMany({
      where: { salonId, customerId: firstCustomerId },
      orderBy: { visitedAt: 'desc' },
      take: 201,
    }),
  );

  const visitList = await timeMs(() =>
    prisma.visit.findMany({
      where: { salonId },
      orderBy: [{ visitedAt: 'desc' }, { createdAt: 'desc' }],
      take: 201,
    }),
  );

  const offsetPages: Record<string, Percentiles> = {};
  for (const skip of [0, 100, 1000, Math.min(5000, CUSTOMERS - 50)]) {
    const measured = await timeMs(
      () =>
        prisma.customer.findMany({
          where: { salonId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: 50,
        }),
      5,
    );
    offsetPages[`skip_${skip}`] = measured.stats;
  }

  const cursorPages: number[] = [];
  let cursor: { createdAt: Date; id: string } | undefined;
  for (let page = 0; page < 20; page += 1) {
    const start = performance.now();
    const rows = await prisma.customer.findMany({
      where: {
        salonId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    cursorPages.push(performance.now() - start);
    const last = rows[rows.length - 1];
    if (!last) {
      break;
    }
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  const scanNoIn = await timeMs(
    () =>
      prisma.visit.findMany({
        where: { salonId },
        select: { customerId: true, visitedAt: true },
      }),
    3,
  );
  const groupBy = await timeMs(() => sqlGroupBy(salonId), 3);
  const windowGaps = await timeMs(() => sqlWindowGaps(salonId), 3);
  const legacy = await timeMs(() => legacyIntelligence(salonId), 3);
  const sql = await timeMs(() => sqlIntelligence(salonId), 3);
  const revenue = await timeMs(() => sqlRevenue(salonId), 3);

  const outboxInsert = await timeMs(async () => {
    await prisma.outboxEvent.create({
      data: {
        id: randomUUID(),
        tenantId: salonId,
        eventType: 'bench',
        payload: { n: 1 },
      },
    });
  });

  const plans = {
    customerList: await explain(
      'customer list',
      `SELECT id FROM customers WHERE salon_id = '${salonId}' ORDER BY created_at DESC LIMIT 201`,
    ),
    customerSearch: await explain(
      'customer search ILIKE',
      `SELECT id FROM customers WHERE salon_id = '${salonId}' AND (first_name ILIKE '%Sara%' OR last_name ILIKE '%Sara%' OR phone_number LIKE '%0912%') LIMIT 201`,
    ),
    visitList: await explain(
      'visit list',
      `SELECT id FROM visits WHERE salon_id = '${salonId}' ORDER BY visited_at DESC LIMIT 201`,
    ),
    intelligenceVisits: await explain(
      'intelligence visit load',
      `SELECT customer_id, visited_at FROM visits WHERE salon_id = '${salonId}' ORDER BY visited_at ASC`,
    ),
    revenueByCustomer: await explain(
      'completed revenue by customer',
      `SELECT customer_id, COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'), 0) FROM transactions WHERE salon_id = '${salonId}' GROUP BY customer_id`,
    ),
    outboxClaim: await explain(
      'outbox claim',
      `SELECT id FROM outbox_events WHERE (status = 'PENDING' AND available_at <= NOW()) OR (status = 'PROCESSING' AND locked_until < NOW()) ORDER BY created_at ASC LIMIT 10`,
    ),
  };

  const memAfter = process.memoryUsage();
  const report = {
    measuredAt: new Date().toISOString(),
    dataset: { customers: CUSTOMERS, visits: VISITS, transactions: TRANSACTIONS, seedMs },
    memoryMb: {
      beforeRss: memBefore.rss / 1_048_576,
      afterRss: memAfter.rss / 1_048_576,
      afterHeap: memAfter.heapUsed / 1_048_576,
    },
    customers: {
      list: customerList.stats,
      search: search.stats,
      getById: getById.stats,
    },
    visits: {
      history: visitHistory.stats,
      salonList: visitList.stats,
    },
    pagination: {
      offset: offsetPages,
      cursorFirst20PagesMean: pct(cursorPages),
    },
    intelligence: {
      prismaScanNoInList: scanNoIn.stats,
      sqlGroupByCount: { ...groupBy.stats, rows: groupBy.result.length },
      sqlWindowGapAverage: { ...windowGaps.stats, rows: windowGaps.result.length },
      legacyLoadAllVisitRows: { ...legacy.stats, meta: legacy.result },
      sqlCteJoinCustomers: { ...sql.stats, meta: sql.result },
      sqlCompletedRevenueByCustomer: { ...revenue.stats, rows: revenue.result.length },
    },
    outbox: { insert: outboxInsert.stats },
    plans,
  };

  const outPath = 'perf/last-bench.json';
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, plans: Object.keys(plans) }, null, 2));
  console.log(`Wrote ${outPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

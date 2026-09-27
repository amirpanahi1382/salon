/**
 * Synthetic intelligence benchmark. Run only with an explicitly identified,
 * disposable PostgreSQL database after applying the existing migrations:
 *
 *   DATABASE_URL=... PHASE7_ISOLATED_DATABASE_URL=... \
 *     pnpm --filter @salon/api exec ts-node --transpile-only perf/intelligence-phase7.ts
 *
 * PHASE7_SIZES=5201,20000,50000 and PHASE7_RUNS=3 may be overridden. The
 * script inserts deterministic synthetic salons and emits JSON measurements.
 */
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, createPrismaClient, type PrismaClient } from '@salon/database';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { IntelligenceQueryService } from '../src/intelligence/intelligence-query.service';
import { GetIntelligenceSummaryUseCase } from '../src/intelligence/get-intelligence-summary.use-case';
import { ListCustomerSegmentsUseCase } from '../src/intelligence/list-customer-segments.use-case';
import { ListOpportunitiesUseCase } from '../src/intelligence/list-opportunities.use-case';
import { GetCustomerIntelligenceUseCase } from '../src/intelligence/get-customer-intelligence.use-case';
import { behaviorFromAggregate, INTELLIGENCE_SCAN_BATCH_SIZE } from '../src/intelligence/intelligence-aggregates';

const databaseUrl = process.env.DATABASE_URL;
const isolatedUrl = process.env.PHASE7_ISOLATED_DATABASE_URL;
if (!databaseUrl || databaseUrl !== isolatedUrl) {
  throw new Error('Phase 7 benchmark requires the explicitly matched disposable database URL');
}
const target = new URL(databaseUrl);
if (target.hostname !== '127.0.0.1' || target.port !== '59176' || target.pathname !== '/phase7_bench') {
  throw new Error('Phase 7 benchmark database target does not match the task-owned container');
}

const sizes = (process.env.PHASE7_SIZES ?? '5201,20000,50000').split(',').map(Number);
const runs = Number(process.env.PHASE7_RUNS ?? 3);
const variant = process.env.PHASE7_VARIANT ?? 'current';
const verifyParity = process.env.PHASE7_VERIFY_PARITY === '1';
if (sizes.some((size) => !Number.isInteger(size) || size < 5201 || size > 50000) ||
    !Number.isInteger(runs) || runs < 1 || runs > 10 ||
    !['baseline', 'current'].includes(variant)) {
  throw new Error('Invalid benchmark size or run count');
}

const raw = createPrismaClient(databaseUrl);
let queries = 0;
let rankedQueries = 0;
let candidateRows = 0;
let rankSql: Prisma.Sql | undefined;
const measured = {
  ...raw,
  customer: {
    ...raw.customer,
    findMany: (...args: Parameters<typeof raw.customer.findMany>) => {
      queries += 1;
      return raw.customer.findMany(...args);
    },
  },
  $queryRaw: async <T = unknown>(query: Prisma.Sql): Promise<T> => {
    queries += 1;
    const ranked = query.sql.includes('"rankDays"');
    if (ranked) {
      rankedQueries += 1;
      rankSql ??= query;
    }
    const rows = await raw.$queryRaw<T>(query);
    if (ranked && Array.isArray(rows)) candidateRows += rows.length;
    return rows;
  },
} as unknown as PrismaClient;
const service = { client: measured } as PrismaService;
const intelligence = new IntelligenceQueryService(service);
const currentRankedChunk = intelligence.loadRankedChunk.bind(intelligence);
const baselineRankedChunk: typeof intelligence.loadRankedChunk = async (tenantId, asOf, noVisitRank, after) => {
    const rows = await measured.$queryRaw<Array<{
      id: string; firstName: string; lastName: string; rankDays: number;
      visitCount: number; firstVisitAt: Date | null; lastVisitAt: Date | null;
      averageReturnIntervalDays: number | null;
    }>>(Prisma.sql`
      WITH gaps AS (
        SELECT customer_id, visited_at,
          FLOOR(EXTRACT(EPOCH FROM (
            visited_at - LAG(visited_at) OVER (
              PARTITION BY customer_id ORDER BY visited_at ASC, id ASC
            )
          )) / 86400) AS gap_days
        FROM visits
        WHERE salon_id = ${tenantId}::uuid
      ), metrics AS (
        SELECT customer_id, COUNT(*)::int AS visit_count,
          MIN(visited_at) AS first_visit_at,
          MAX(visited_at) AS last_visit_at,
          CASE WHEN COUNT(*) FILTER (WHERE gap_days > 0) = 0 THEN NULL
            ELSE GREATEST(1, ROUND((AVG(gap_days) FILTER (WHERE gap_days > 0))::numeric))::int
          END AS average_return_interval_days
        FROM gaps GROUP BY customer_id
      ), ranked AS (
        SELECT c.id, c.first_name AS "firstName", c.last_name AS "lastName",
          COALESCE(m.visit_count, 0)::int AS "visitCount",
          m.first_visit_at AS "firstVisitAt", m.last_visit_at AS "lastVisitAt",
          m.average_return_interval_days AS "averageReturnIntervalDays",
          CASE WHEN m.last_visit_at IS NULL THEN ${noVisitRank}::int
            ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
              ${asOf}::timestamptz - m.last_visit_at
            )) / 86400))::int END AS "rankDays"
        FROM customers c
        LEFT JOIN metrics m ON m.customer_id = c.id
        WHERE c.salon_id = ${tenantId}::uuid
      )
      SELECT * FROM ranked
      WHERE true
        ${after ? Prisma.sql`AND (
          "rankDays" < ${after.days}::int OR
          ("rankDays" = ${after.days}::int AND id ${after.inclusive ? Prisma.sql`<=` : Prisma.sql`<`} ${after.id}::uuid)
        )` : Prisma.empty}
      ORDER BY "rankDays" DESC, id DESC
      LIMIT ${INTELLIGENCE_SCAN_BATCH_SIZE}
    `);
    return rows.map((row) => ({
      customer: { id: row.id, firstName: row.firstName, lastName: row.lastName },
      behavior: behaviorFromAggregate(row, asOf), rankDays: Number(row.rankDays),
    }));
};
if (variant === 'baseline') intelligence.loadRankedChunk = baselineRankedChunk;
const summary = new GetIntelligenceSummaryUseCase(intelligence, service);
const segments = new ListCustomerSegmentsUseCase(intelligence);
const opportunities = new ListOpportunitiesUseCase(intelligence, service);
const customer = new GetCustomerIntelligenceUseCase(intelligence, service);

function id(prefix: string, size: number): string {
  // PostgreSQL md5(...)::uuid uses the same 32-hex-digit representation.
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('md5').update(`phase7-${size}-${prefix}`).digest('hex')
    .replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
}

async function seed(size: number): Promise<{ salonId: string; customerId: string }> {
  const salonId = id('salon', size);
  const userId = id('user', size);
  const marker = `phase7-${size}`;
  const existing = await raw.salon.findUnique({ where: { id: salonId } });
  if (existing) return { salonId, customerId: id('customer-19', size) };
  await raw.salon.create({ data: { id: salonId, name: marker } });
  await raw.user.create({ data: {
    id: userId, salonId, name: 'Synthetic owner', email: `${marker}@example.test`,
    passwordHash: 'unused-benchmark-hash', role: 'OWNER',
  } });
  const asOf = new Date();
  await raw.$executeRaw(Prisma.sql`
    INSERT INTO customers (id, salon_id, first_name, last_name, phone_number, created_at, updated_at)
    SELECT md5(${marker} || '-customer-' || g)::uuid, ${salonId}::uuid,
      'Synthetic', g::text, '09' || lpad(g::text, 9, '0'),
      ${asOf}::timestamptz - g * interval '1 second', ${asOf}::timestamptz
    FROM generate_series(1, ${size}) g
  `);
  await raw.$executeRaw(Prisma.sql`
    INSERT INTO visits (id, salon_id, customer_id, visited_at, created_at, updated_at)
    SELECT md5(${marker} || '-old-' || g)::uuid, ${salonId}::uuid,
      md5(${marker} || '-customer-' || g)::uuid,
      ${asOf}::timestamptz -
        (CASE WHEN g % 20 = 0 THEN 130 ELSE 500 END) * interval '1 day',
      ${asOf}::timestamptz, ${asOf}::timestamptz
    FROM generate_series(1, ${size}) g WHERE g % 20 < 10
  `);
  await raw.$executeRaw(Prisma.sql`
    INSERT INTO visits (id, salon_id, customer_id, visited_at, created_at, updated_at)
    SELECT md5(${marker} || '-last-' || g)::uuid, ${salonId}::uuid,
      md5(${marker} || '-customer-' || g)::uuid,
      ${asOf}::timestamptz - 90 * interval '1 day',
      ${asOf}::timestamptz, ${asOf}::timestamptz
    FROM generate_series(1, ${size}) g WHERE g % 20 < 10
  `);
  await raw.$executeRaw(Prisma.sql`
    INSERT INTO visits (id, salon_id, customer_id, visited_at, created_at, updated_at)
    SELECT md5(${marker} || '-single-' || g)::uuid, ${salonId}::uuid,
      md5(${marker} || '-customer-' || g)::uuid,
      ${asOf}::timestamptz - 75 * interval '1 day',
      ${asOf}::timestamptz, ${asOf}::timestamptz
    FROM generate_series(1, ${size}) g WHERE g % 20 = 19
  `);
  await raw.$executeRaw(Prisma.sql`
    INSERT INTO transactions (id, salon_id, customer_id, occurred_at, amount, currency,
      status, created_at, updated_at)
    SELECT md5(${marker} || '-tx-' || g)::uuid, ${salonId}::uuid,
      md5(${marker} || '-customer-' || g)::uuid,
      date_trunc('month', ${asOf}::timestamptz) - interval '1 day', 100.00, 'IRR',
      CASE WHEN g % 400 = 19 THEN 'VOIDED' ELSE 'COMPLETED' END::"TransactionStatus",
      ${asOf}::timestamptz, ${asOf}::timestamptz
    FROM generate_series(1, ${size}) g WHERE g % 200 = 19 OR g % 400 = 19
  `);
  await raw.$executeRaw(Prisma.sql`
    INSERT INTO opportunity_actions (id, salon_id, customer_id, opportunity_type,
      status, created_by, created_at, updated_at, dismissed_at, source_visit_id)
    SELECT md5(${marker} || '-action-' || g)::uuid, ${salonId}::uuid,
      md5(${marker} || '-customer-' || g)::uuid, 'REACTIVATION'::"OpportunityActionType",
      'DISMISSED'::"OpportunityActionStatus", ${userId}::uuid,
      ${asOf}::timestamptz, ${asOf}::timestamptz, ${asOf}::timestamptz,
      md5(${marker} || '-last-' || g)::uuid
    FROM generate_series(1, ${size}) g WHERE g % 1000 = 0
  `);
  await raw.$executeRawUnsafe('ANALYZE');
  return { salonId, customerId: id('customer-19', size) };
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)]!;
}

async function time(label: string, size: number, fn: () => Promise<unknown>) {
  const durations: number[] = [];
  const counts: number[] = [];
  const batches: number[] = [];
  const candidates: number[] = [];
  await fn(); // warmup
  for (let i = 0; i < runs; i += 1) {
    queries = 0; rankedQueries = 0; candidateRows = 0;
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
    counts.push(queries); batches.push(rankedQueries); candidates.push(candidateRows);
  }
  console.log(JSON.stringify({ variant, size, label, runs, medianMs: Math.round(median(durations)),
    medianQueries: median(counts), medianRankedBatches: median(batches),
    medianCandidateRows: median(candidates) }));
}

async function traverse(principal: AuthenticatedPrincipal) {
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await opportunities.execute(principal, undefined, cursor);
    for (const item of result.items) {
      const key = `${item.customerId}:${item.type}`;
      if (seen.has(key)) throw new Error(`Duplicate opportunity: ${key}`);
      seen.add(key);
    }
    if (!result.hasMore) return seen.size;
    if (!result.nextCursor || result.nextCursor === cursor) throw new Error('Invalid continuation');
    cursor = result.nextCursor;
  }
  throw new Error('Traversal did not terminate');
}

async function explainRank(size: number) {
  if (!rankSql) return;
  const rows = await raw.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
    Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${rankSql}`,
  );
  console.log(`EXPLAIN_RANK size=${size}\n${rows.map((row) => row['QUERY PLAN']).join('\n')}`);
  rankSql = undefined;
}

async function assertRankParity(size: number, salonId: string) {
  const asOf = new Date('2026-09-27T12:00:00.000Z');
  for (const noVisitRank of [-1, 0] as const) {
    let after: { days: number; id: string } | undefined;
    let compared = 0;
    do {
      const oldRows = await baselineRankedChunk(salonId, asOf, noVisitRank, after);
      const newRows = await currentRankedChunk(salonId, asOf, noVisitRank, after);
      if (!isDeepStrictEqual(oldRows, newRows)) {
        throw new Error(`Ranked result differs at size=${size}, offset=${compared}, noVisitRank=${noVisitRank}`);
      }
      compared += oldRows.length;
      if (oldRows.length < INTELLIGENCE_SCAN_BATCH_SIZE) break;
      const last = oldRows.at(-1)!;
      after = { days: last.rankDays, id: last.customer.id };
    } while (true);
    if (compared !== size) throw new Error(`Ranked traversal lost rows at size=${size}: ${compared}`);
    console.log(JSON.stringify({ parity: 'exact', size, noVisitRank, compared }));
  }
}

async function main() {
  for (const size of sizes) {
    const { salonId, customerId } = await seed(size);
    if (verifyParity) await assertRankParity(size, salonId);
    const principal = { tenantId: salonId } as AuthenticatedPrincipal;
    await time('summary', size, () => summary.execute(principal));
    await time('segments_first', size, () => segments.execute(principal));
    const first = await segments.execute(principal);
    await time('segments_second', size, () => segments.execute(principal, undefined, first.nextCursor!));
    await time('sparse_customer_return_first', size,
      () => opportunities.execute(principal, 'CUSTOMER_RETURN'));
    await time('opportunities_full_traversal', size, () => traverse(principal));
    await time('per_customer', size, () => customer.execute(principal, customerId));
    await explainRank(size);
  }
}

main().finally(() => raw.$disconnect()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { SalonOverallPerformanceRepository } from '../src/salon/salon-overall-performance.repository';

const url = 'postgresql://salon_app@127.0.0.1:55931/salon_metric_oracle_20261030';
const LARGE = '55555555-5555-4555-8555-555555555555';

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url } },
    log: [{ emit: 'event', level: 'query' }],
  });
  let captured: { query: string; params: string } | undefined;
  prisma.$on('query', (event) => {
    captured = { query: event.query, params: event.params };
  });
  const repository = new SalonOverallPerformanceRepository({ client: prisma } as never);
  const row = await repository.load(LARGE);
  if (!captured) throw new Error('no query');
  const params = (JSON.parse(captured.params) as unknown[]).map((value) =>
    typeof value === 'string' && /\d{4}-\d{2}-\d{2}/.test(value) && value.includes('UTC')
      ? new Date(value)
      : value,
  );
  const explained = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': unknown }>>(
    `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON) ${captured.query}`,
    ...params,
  );
  const plan = explained[0]?.['QUERY PLAN'];
  writeFileSync('/tmp/salon-scale-explain.json', JSON.stringify(plan, null, 2));
  writeFileSync('/tmp/salon-scale-explain-query.txt', `${captured.query}\n-- params ${captured.params}\n`);
  const root = Array.isArray(plan) ? (plan[0] as Record<string, unknown>) : {};
  const scans: string[] = [];
  const spills: string[] = [];
  const walk = (node: Record<string, unknown> | undefined): void => {
    if (!node) return;
    if (node['Node Type'] === 'Seq Scan') scans.push(String(node['Relation Name']));
    if (typeof node['Sort Method'] === 'string' && String(node['Sort Space Type'] ?? '').includes('Disk')) {
      spills.push(String(node['Sort Method']));
    }
    const children = node.Plans;
    if (Array.isArray(children)) {
      for (const child of children) walk(child as Record<string, unknown>);
    }
  };
  walk((root.Plan ?? {}) as Record<string, unknown>);
  process.stdout.write(`${JSON.stringify({
    revenue: row.monthlyRecordedRevenueIrr,
    executionMs: root['Execution Time'],
    planningMs: root['Planning Time'],
    sharedHit: (root.Plan as Record<string, unknown> | undefined)?.['Shared Hit Blocks'],
    sharedRead: (root.Plan as Record<string, unknown> | undefined)?.['Shared Read Blocks'],
    tempReadBlocks: (root.Plan as Record<string, unknown> | undefined)?.['Temp Read Blocks'],
    tempWrittenBlocks: (root.Plan as Record<string, unknown> | undefined)?.['Temp Written Blocks'],
    settings: root['Settings'] ?? null,
    sequentialScans: scans,
    sortSpills: spills,
  })}\n`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`FAILED ${error instanceof Error ? error.message : 'failed'}\n`);
  process.exit(1);
});

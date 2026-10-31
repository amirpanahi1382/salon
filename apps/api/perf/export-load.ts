/**
 * Bounded visit-export check against the disposable benchmark API.
 *
 *   tsx perf/export-load.ts
 *
 * Requires the capacity API on 127.0.0.1:18141. Does not truncate.
 * Does not print tokens, phones, or connection strings.
 */
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';
import { createPrismaClient } from '@salon/database';
import { VISIT_EXPORT_HEADERS } from '../src/visit/visit-export.constants';

const BASE = 'http://127.0.0.1:18141';
const LARGE = '55555555-5555-4555-8555-555555555555';
const LARGE_USER = '55555555-5555-4555-8555-555555555511';
const SKEW_USER = '55555555-5555-4555-8555-555555555512';
const SKEW = '55555555-5555-4555-8555-5555555555a1';
const SUPER_URL = 'postgresql://salon@127.0.0.1:55931/salon_metric_oracle_20261030';
const MAX_REQUESTS = 60;
const MAX_BYTES = 16_000_000;
const DURATION_MS = 30_000;
const CONCURRENCY = 5;

function sign(sub: string, extra: Record<string, string>): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return jwt.sign({ sub, ...extra }, secret, { expiresIn: '30m' });
}

function request(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: Buffer; error: string | null }> {
  return new Promise((resolve) => {
    const req = http.request(url, { headers, method: 'GET', timeout: 30_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk as Buffer));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks),
        error: null,
      }));
      res.on('error', (error: NodeJS.ErrnoException) => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks),
        error: error.code ?? error.name,
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: Buffer.alloc(0), error: 'TIMEOUT' });
    });
    req.on('error', (error: NodeJS.ErrnoException) => resolve({
      status: 0,
      body: Buffer.alloc(0),
      error: error.code ?? error.name,
    }));
    req.end();
  });
}

async function main(): Promise<void> {
  const db = createPrismaClient(SUPER_URL, { connectionLimit: 1, poolTimeoutSeconds: 10 });
  const identity = await db.$queryRaw<Array<{ name: string; systemId: string; comment: string | null }>>`
    SELECT current_database() AS name,
           (SELECT system_identifier::text FROM pg_control_system()) AS "systemId",
           (SELECT description FROM pg_shdescription JOIN pg_database ON objoid = pg_database.oid
             WHERE datname = current_database()) AS comment
  `;
  const row = identity[0];
  if (!row || row.name !== 'salon_metric_oracle_20261030' || row.comment !== 'metric-oracle-disposable:20261030'
    || row.systemId === '7700113693112733735') {
    throw new Error('Refusing an unexpected database');
  }
  const customers = await db.$queryRaw<Array<{ id: string; visits: number; fromDay: Date; toDay: Date }>>`
    SELECT c.id::text AS id,
           COUNT(v.id)::int AS visits,
           date_trunc('day', MIN(v.visited_at) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "fromDay",
           (date_trunc('day', MAX(v.visited_at) AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC' AS "toDay"
    FROM customers c
    INNER JOIN visits v ON v.customer_id = c.id AND v.salon_id = c.salon_id
    WHERE c.salon_id = ${LARGE}::uuid
      AND substring(c.id::text, 15, 1) = '4'
      AND substring(c.id::text, 20, 1) IN ('8', '9', 'a', 'b')
    GROUP BY c.id
    ORDER BY COUNT(v.id) DESC, c.id
    LIMIT 1
  `;
  const customer = customers[0];
  if (!customer || customer.visits < 2) {
    throw new Error('No RFC-valid customer with visit history');
  }
  const amounts = await db.$queryRaw<Array<{ amount: string | null }>>`
    SELECT CASE WHEN sale.status = 'COMPLETED' THEN sale.amount::text ELSE NULL END AS amount
    FROM visits v
    LEFT JOIN LATERAL (
      SELECT t.amount, t.status
      FROM transactions t
      WHERE t.visit_id = v.id AND t.salon_id = v.salon_id
      ORDER BY CASE WHEN t.status = 'COMPLETED' THEN 0 ELSE 1 END, t.created_at ASC, t.id ASC
      LIMIT 1
    ) sale ON true
    WHERE v.salon_id = ${LARGE}::uuid AND v.customer_id = ${customer.id}::uuid
    ORDER BY v.visited_at ASC, v.created_at ASC, v.id ASC
  `;
  const from = customer.fromDay.toISOString();
  const to = customer.toDay.toISOString();
  const owner = sign(LARGE_USER, { tid: LARGE, role: 'OWNER' });
  const skew = sign(SKEW_USER, { tid: SKEW, role: 'OWNER' });
  const ownerHeaders = { authorization: `Bearer ${owner}` };
  const query = `customerId=${customer.id}&from=${from}&to=${to}`;
  const preflight = await request(`${BASE}/visits?${query}`, ownerHeaders);
  if (preflight.status !== 200) {
    throw new Error(`Visit preflight returned ${preflight.status}`);
  }
  const listed = JSON.parse(preflight.body.toString('utf8')) as { items?: unknown[] };
  const proof = await request(`${BASE}/visits/export?${query}`, ownerHeaders);
  if (proof.status !== 200 || proof.error) {
    throw new Error(`Export proof returned ${proof.status} ${proof.error ?? ''}`);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(proof.body);
  const sheet = workbook.worksheets[0];
  const headers = VISIT_EXPORT_HEADERS.map((_, index) => String(sheet?.getRow(1).getCell(index + 1).value ?? ''));
  const exportedAmounts: Array<string | null> = [];
  sheet?.eachRow((excelRow, index) => {
    if (index === 1) return;
    const value = excelRow.getCell(3).value;
    exportedAmounts.push(value == null || value === '' ? null : Number(value).toFixed(2));
  });
  const expectedAmounts = amounts.map((item) => item.amount);
  const contentMatches = headers.join('|') === VISIT_EXPORT_HEADERS.join('|')
    && exportedAmounts.length === customer.visits
    && exportedAmounts.join(',') === expectedAmounts.join(',');
  const isolated = await request(`${BASE}/visits/export?${query}`, { authorization: `Bearer ${skew}` });
  const invalid = await request(`${BASE}/visits/export?customerId=55555555-5555-4555-7555-555555555555`, ownerHeaders);

  const started = new Date();
  const until = Date.now() + DURATION_MS;
  let attempted = 0;
  let bytes = 0;
  const statuses: Record<string, number> = {};
  const errors: Record<string, number> = {};
  const samples: number[] = [];
  const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });
  async function worker(): Promise<void> {
    for (;;) {
      if (Date.now() >= until || attempted >= MAX_REQUESTS || bytes >= MAX_BYTES) return;
      attempted += 1;
      const t0 = Date.now();
      const response = await new Promise<{ status: number; length: number; error: string | null }>((resolve) => {
        const req = http.request(`${BASE}/visits/export?${query}`, { agent, headers: ownerHeaders, timeout: 30_000 }, (res) => {
          let length = 0;
          res.on('data', (chunk) => { length += (chunk as Buffer).length; });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, length, error: null }));
        });
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, length: 0, error: 'TIMEOUT' }); });
        req.on('error', (error: NodeJS.ErrnoException) => resolve({ status: 0, length: 0, error: error.code ?? error.name }));
        req.end();
      });
      samples.push(Date.now() - t0);
      bytes += response.length;
      if (response.error) errors[response.error] = (errors[response.error] ?? 0) + 1;
      statuses[String(response.status)] = (statuses[String(response.status)] ?? 0) + 1;
      const pause = Math.max(0, until - Date.now());
      if (pause <= 0) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2_500, pause)));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const audits = await db.$queryRaw<Array<{ audits: number }>>`
    SELECT COUNT(*)::int AS audits
    FROM audit_logs
    WHERE action = 'VISITS_EXPORTED'
      AND tenant_id = ${LARGE}::uuid
      AND created_at >= ${started}
  `;
  await db.$disconnect();
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))] ?? 0;
  const report = {
    database: row.name,
    systemId: row.systemId,
    customerVisits: customer.visits,
    window: { from, to },
    preflightStatus: preflight.status,
    preflightItems: listed.items?.length ?? null,
    proofStatus: proof.status,
    proofBytes: proof.body.length,
    headersMatch: headers.join('|') === VISIT_EXPORT_HEADERS.join('|'),
    contentMatches,
    otherTenantStatus: isolated.status,
    invalidUuidStatus: invalid.status,
    sustained: {
      durationMs: Date.now() - started.getTime(),
      concurrency: CONCURRENCY,
      maxRequests: MAX_REQUESTS,
      maxBytes: MAX_BYTES,
      attempted,
      statuses,
      errors,
      bytes,
      p50: pick(0.5),
      p95: pick(0.95),
      audits: audits[0]?.audits ?? null,
    },
  };
  writeFileSync('perf/reports/export-load.json', JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!contentMatches || isolated.status === 200 || proof.status !== 200) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`FAILED ${error instanceof Error ? error.message : 'failed'}\n`);
  process.exit(1);
});

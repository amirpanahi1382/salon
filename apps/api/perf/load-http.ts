/**
 * Standalone HTTP load runner for the disposable capacity API.
 * Accounts for every attempt. Does not retry. Does not print secrets.
 *
 *   tsx perf/load-http.ts probe
 *   tsx perf/load-http.ts sustain dashboard 10 60
 *   tsx perf/load-http.ts sustain mixed 25 60
 *   tsx perf/load-http.ts sustain routes 10 60
 */
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createPrismaClient } from '@salon/database';
import jwt from 'jsonwebtoken';

const BASE = 'http://127.0.0.1:18141';
const LARGE = '55555555-5555-4555-8555-555555555555';
const LARGE_USER = '55555555-5555-4555-8555-555555555511';
const SKEW = '55555555-5555-4555-8555-5555555555a1';
const SKEW_USER = '55555555-5555-4555-8555-555555555512';
const ADMIN = '55555555-5555-4555-8555-555555555501';
const SUPER_URL = 'postgresql://salon@127.0.0.1:55931/salon_metric_oracle_20261030';

type Outcome = {
  at: number;
  route: string;
  status: number | null;
  error: string | null;
  ms: number;
  connectMs: number | null;
  requestId: string | null;
};

function sign(sub: string, extra: Record<string, string>): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return jwt.sign({ sub, ...extra }, secret, { expiresIn: '2h' });
}

function agentFor(mode: 'fresh' | 'reuse' | 'stale'): http.Agent {
  if (mode === 'stale') return http.globalAgent;
  if (mode === 'fresh') return new http.Agent({ keepAlive: false, maxSockets: 200 });
  const agent = new http.Agent({ keepAlive: true, maxSockets: 200, maxFreeSockets: 50 });
  const timer = setInterval(() => {
    for (const sockets of Object.values(agent.freeSockets)) {
      for (const socket of sockets) socket.destroy();
    }
  }, 1_000);
  timer.unref();
  return agent;
}

function once(url: string, headers: Record<string, string>, agent: http.Agent, timeoutMs: number): Promise<Outcome> {
  const started = performance.now();
  const at = Date.now();
  return new Promise((resolve) => {
    let connectMs: number | null = null;
    let settled = false;
    const finish = (partial: Omit<Outcome, 'at' | 'route' | 'ms' | 'connectMs'> & { status: number | null; error: string | null }) => {
      if (settled) return;
      settled = true;
      resolve({
        at,
        route: new URL(url).pathname,
        ms: performance.now() - started,
        connectMs,
        ...partial,
      });
    };
    const req = http.request(url, { agent, headers, method: 'GET', timeout: timeoutMs }, (res) => {
      res.on('data', () => undefined);
      res.on('end', () => finish({
        status: res.statusCode ?? 0,
        error: null,
        requestId: typeof res.headers['x-request-id'] === 'string' ? res.headers['x-request-id'] : null,
      }));
      res.on('error', (error: NodeJS.ErrnoException) => finish({
        status: res.statusCode ?? null,
        error: error.code ?? error.name,
        requestId: null,
      }));
    });
    req.on('socket', (socket) => {
      if (socket.connecting) {
        socket.once('connect', () => {
          connectMs = performance.now() - started;
        });
      } else {
        connectMs = 0;
      }
    });
    req.on('timeout', () => {
      req.destroy();
      finish({ status: null, error: 'TIMEOUT', requestId: null });
    });
    req.on('error', (error: NodeJS.ErrnoException) => finish({
      status: null,
      error: error.code ?? error.name,
      requestId: null,
    }));
    req.end();
  });
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index] ?? 0;
}

async function runPool(
  concurrency: number,
  until: number,
  next: () => { url: string; headers: Record<string, string> } | null,
  agent: http.Agent,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  async function worker(): Promise<void> {
    for (;;) {
      if (Date.now() >= until) return;
      const job = next();
      if (!job) return;
      const outcome = await once(job.url, job.headers, agent, 30_000);
      outcome.route = new URL(job.url).pathname;
      outcomes.push(outcome);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return outcomes;
}

function summarize(name: string, outcomes: Outcome[], started: number) {
  const success = outcomes.filter((row) => row.status === 200);
  const statuses: Record<string, number> = {};
  const errors: Record<string, number> = {};
  let timeouts = 0;
  for (const row of outcomes) {
    if (row.error === 'TIMEOUT') timeouts += 1;
    if (row.error) errors[row.error] = (errors[row.error] ?? 0) + 1;
    if (row.status != null) statuses[String(row.status)] = (statuses[String(row.status)] ?? 0) + 1;
  }
  const durationMs = Date.now() - started;
  return {
    name,
    durationMs,
    attempted: outcomes.length,
    completed: outcomes.filter((row) => row.status != null).length,
    failed: outcomes.filter((row) => row.error != null || (row.status != null && row.status >= 400)).length,
    timedOut: timeouts,
    statuses,
    errors,
    successSamples: success.length,
    successP50: percentile(success.map((row) => row.ms), 0.5),
    successP95: percentile(success.map((row) => row.ms), 0.95),
    successP99: percentile(success.map((row) => row.ms), 0.99),
    connectP50: percentile(outcomes.map((row) => row.connectMs ?? 0), 0.5),
    rps: outcomes.length / (durationMs / 1000),
    byRoute: routeBreakdown(outcomes),
  };
}

function routeBreakdown(outcomes: Outcome[]) {
  const groups = new Map<string, Outcome[]>();
  for (const row of outcomes) {
    const list = groups.get(row.route) ?? [];
    list.push(row);
    groups.set(row.route, list);
  }
  return [...groups.entries()].map(([route, rows]) => {
    const success = rows.filter((row) => row.status === 200);
    return {
      route,
      attempted: rows.length,
      failed: rows.filter((row) => row.error != null || (row.status != null && row.status >= 400)).length,
      successP50: percentile(success.map((row) => row.ms), 0.5),
      successP95: percentile(success.map((row) => row.ms), 0.95),
    };
  });
}

async function dbStats() {
  const db = createPrismaClient(SUPER_URL, { connectionLimit: 1, poolTimeoutSeconds: 5 });
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT numbackends, xact_commit, xact_rollback, tup_returned, temp_files, temp_bytes, blks_hit, blks_read
    FROM pg_stat_database WHERE datname = current_database()
  `;
  const sessions = await db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT usename, state, wait_event_type, wait_event, COUNT(*)::int AS sessions
    FROM pg_stat_activity WHERE datname = current_database()
    GROUP BY usename, state, wait_event_type, wait_event
  `;
  await db.$disconnect();
  return { database: rows[0], sessions };
}

async function probe(): Promise<void> {
  const waves: unknown[] = [];
  for (const mode of ['stale', 'fresh', 'reuse'] as const) {
    const agent = agentFor(mode);
    const first = await Promise.all(Array.from({ length: 20 }, () =>
      once(`${BASE}/health`, {}, agent, 10_000)));
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    const second = await Promise.all(Array.from({ length: 30 }, () =>
      once(`${BASE}/health`, {}, agent, 10_000)));
    waves.push({
      mode,
      first: summarize(`${mode}-first`, first, Date.now()),
      second: summarize(`${mode}-second`, second, Date.now()),
    });
  }
  const hot = await (async () => {
    const agent = agentFor('stale');
    const started = Date.now();
    const outcomes = await runPool(50, started + 8_000, () => ({ url: `${BASE}/health`, headers: {} }), agent);
    return summarize('stale-hot-8s', outcomes, started);
  })();
  const report = { waves, hot };
  writeFileSync('/tmp/salon-load-probe.json', JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function sustain(kind: string, concurrency: number, seconds: number): Promise<void> {
  const owner = sign(LARGE_USER, { tid: LARGE, role: 'OWNER' });
  const skew = sign(SKEW_USER, { tid: SKEW, role: 'OWNER' });
  const admin = sign(ADMIN, { scp: 'platform' });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const setupAgent = agentFor('reuse');
  const firstDrop = await once(`${BASE}/intelligence/revenue-drops`, auth(owner), setupAgent, 30_000);
  let dropCursor = '';
  if (firstDrop.status === 200) {
    const body = await readJson(`${BASE}/intelligence/revenue-drops`, auth(owner), setupAgent);
    dropCursor = typeof body.nextCursor === 'string' ? body.nextCursor : '';
  }
  const list = await readJson(`${BASE}/admin/vip/lists`, auth(admin), setupAgent);
  const listId = Array.isArray(list.items)
    ? (list.items as Array<{ id?: string; name?: string }>).find((row) => row.name === 'scale-coverage')?.id
    : undefined;
  const customer = await readJson(`${BASE}/customers?q=1000`, auth(owner), setupAgent);
  const customerId = Array.isArray(customer.items) ? (customer.items[0] as { id?: string } | undefined)?.id : undefined;

  const routes = routeSet(kind, { owner, skew, admin, dropCursor, listId, customerId });
  const agent = agentFor('reuse');
  const started = Date.now();
  const before = await dbStats();
  const samples: Array<Record<string, unknown>> = [];
  let stop = false;
  const watcher = (async () => {
    while (!stop) {
      samples.push({ at: Date.now(), ...(await dbStats()) });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  })();
  let index = 0;
  const outcomes = await runPool(concurrency, started + seconds * 1000, () => {
    const route = routes[index % routes.length]!;
    index += 1;
    return route;
  }, agent);
  stop = true;
  await watcher;
  const after = await dbStats();
  const summary = summarize(`${kind}-c${concurrency}`, outcomes, started);
  const waits = samples.flatMap((sample) => {
    const sessions = sample.sessions as Array<Record<string, unknown>>;
    return sessions.filter((row) => row.wait_event_type && row.wait_event_type !== 'Client');
  });
  const report = { summary, before: before.database, after: after.database, waitSamples: waits.length, waits: waits.slice(0, 20) };
  const encoded = JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2);
  writeFileSync(`/tmp/salon-load-${kind}-c${concurrency}.json`, encoded);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

function routeSet(kind: string, input: {
  owner: string; skew: string; admin: string; dropCursor: string; listId?: string; customerId?: string;
}): Array<{ url: string; headers: Record<string, string> }> {
  const owner = { authorization: `Bearer ${input.owner}` };
  const skew = { authorization: `Bearer ${input.skew}` };
  const admin = { authorization: `Bearer ${input.admin}` };
  const dashboard = { url: `${BASE}/salon/overall-performance`, headers: owner };
  if (kind === 'export' && input.customerId) {
    return [{ url: `${BASE}/visits/export?customerId=${input.customerId}`, headers: owner }];
  }
  if (kind === 'dashboard') return [dashboard];
  if (kind === 'mixed') {
    return [
      dashboard,
      { url: `${BASE}/salon/overall-performance`, headers: skew },
    ];
  }
  const routes = [
    dashboard,
    { url: `${BASE}/customers?q=1000`, headers: owner },
    { url: `${BASE}/follow-ups/customers`, headers: owner },
    { url: `${BASE}/follow-ups/vip`, headers: owner },
    { url: `${BASE}/messages/history`, headers: owner },
    { url: `${BASE}/vip/requests`, headers: owner },
    { url: `${BASE}/visits`, headers: owner },
    { url: `${BASE}/intelligence/revenue-drops`, headers: owner },
    { url: `${BASE}/admin/vip/outreach/salons`, headers: admin },
    { url: `${BASE}/admin/vip/salons/${LARGE}/profile`, headers: admin },
  ];
  if (input.customerId) routes.push({ url: `${BASE}/customers/${input.customerId}`, headers: owner });
  if (input.dropCursor) {
    routes.push({ url: `${BASE}/intelligence/revenue-drops?cursor=${encodeURIComponent(input.dropCursor)}`, headers: owner });
  }
  if (input.listId) routes.push({ url: `${BASE}/admin/vip/lists/${input.listId}/salon-results`, headers: admin });
  return routes;
}

function readJson(url: string, headers: Record<string, string>, agent: http.Agent): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { agent, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk as Buffer));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main(): Promise<void> {
  const [command, kind, concurrencyText, secondsText] = process.argv.slice(2);
  if (command === 'probe') {
    await probe();
    return;
  }
  if (command === 'sustain') {
    await sustain(kind ?? 'dashboard', Number(concurrencyText ?? 10), Number(secondsText ?? 60));
    return;
  }
  throw new Error('usage: probe | sustain <kind> <concurrency> <seconds>');
}

main().catch((error: unknown) => {
  process.stderr.write(`FAILED ${error instanceof Error ? error.message : 'failed'}\n`);
  process.exit(1);
});

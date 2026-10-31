import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createPrismaClient } from '@salon/database';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

const LARGE = '55555555-5555-4555-8555-555555555555';
const LARGE_USER = '55555555-5555-4555-8555-555555555511';
const SKEW = '55555555-5555-4555-8555-5555555555a1';
const SKEW_USER = '55555555-5555-4555-8555-555555555512';
const ADMIN = '55555555-5555-4555-8555-555555555501';
const SUPER_URL = 'postgresql://salon@127.0.0.1:55931/salon_metric_oracle_20261030';

const pointed = (() => {
  try {
    const parsed = new URL(process.env.DATABASE_URL ?? '');
    return parsed.hostname === '127.0.0.1' && parsed.port === '55931'
      && decodeURIComponent(parsed.pathname.replace(/^\//, '')) === 'salon_metric_oracle_20261030';
  } catch {
    return false;
  }
})();

const describeIfScale = pointed ? describe : describe.skip;

type Sample = {
  endpoint: string;
  concurrency: number;
  attempted: number;
  completed: number;
  failed: number;
  thrown: number;
  durationMs: number;
  rps: number;
  successP50: number;
  successP95: number;
  successP99: number;
  successSamples: number;
  statuses: Record<string, number>;
  thrownCodes: Record<string, number>;
};

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index] ?? 0;
}

async function hammer(
  endpoint: string,
  concurrency: number,
  total: number,
  call: () => Promise<{ status: number }>,
): Promise<Sample> {
  const success: number[] = [];
  const statuses = new Map<number, number>();
  const thrownCodes = new Map<string, number>();
  let completed = 0;
  let failed = 0;
  let thrown = 0;
  let cursor = 0;
  const started = performance.now();
  async function worker(): Promise<void> {
    for (;;) {
      const mine = cursor;
      cursor += 1;
      if (mine >= total) return;
      const t0 = performance.now();
      try {
        const response = await call();
        completed += 1;
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
        if (response.status >= 400) failed += 1;
        else success.push(performance.now() - t0);
      } catch (error) {
        thrown += 1;
        const err = error as { code?: string; errno?: string; message?: string; name?: string };
        const code = err?.code || err?.errno || err?.name || (typeof error === 'string' ? error : 'unknown');
        thrownCodes.set(String(code), (thrownCodes.get(String(code)) ?? 0) + 1);
        if (thrownCodes.get(String(code)) === 1) {
          process.stderr.write(`THROW ${endpoint} ${String(code)} ${String(err?.message ?? error).slice(0, 180)}\n`);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const durationMs = performance.now() - started;
  return {
    endpoint,
    concurrency,
    attempted: completed + thrown,
    completed,
    failed,
    thrown,
    durationMs,
    rps: (completed + thrown) / (durationMs / 1000),
    successP50: percentile(success, 0.5),
    successP95: percentile(success, 0.95),
    successP99: percentile(success, 0.99),
    successSamples: success.length,
    statuses: Object.fromEntries(statuses),
    thrownCodes: Object.fromEntries(thrownCodes),
  };
}

describeIfScale('large disposable HTTP read baseline', () => {
  jest.setTimeout(720_000);
  let app: INestApplication;
  let ownerToken = '';
  let skewToken = '';
  let adminToken = '';
  let customerId = '';
  let dropCursor = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const prisma = app.get(PrismaService);
    const counts = await prisma.client.$queryRaw<Array<{ customers: number; visits: number }>>`
      SELECT
        (SELECT COUNT(*)::int FROM customers WHERE salon_id = ${LARGE}::uuid) AS customers,
        (SELECT COUNT(*)::int FROM visits WHERE salon_id = ${LARGE}::uuid) AS visits
    `;
    if ((counts[0]?.customers ?? 0) < 50_000 || counts[0]?.visits !== 250_000) {
      throw new Error('Large disposable dataset is not loaded');
    }
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    const jwt = app.get(JwtService);
    ownerToken = await jwt.signAsync({ sub: LARGE_USER, tid: LARGE, role: 'OWNER' });
    skewToken = await jwt.signAsync({ sub: SKEW_USER, tid: SKEW, role: 'OWNER' });
    adminToken = await jwt.signAsync({ sub: ADMIN, scp: 'platform' });
    const customer = await prisma.client.customer.findFirst({
      where: { salonId: LARGE },
      select: { id: true },
    });
    customerId = customer?.id ?? '';
    const first = await request(app.getHttpServer())
      .get('/intelligence/revenue-drops')
      .set('Authorization', `Bearer ${ownerToken}`);
    dropCursor = typeof first.body?.nextCursor === 'string' ? first.body.nextCursor : '';
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  it('measures stepped concurrency on real read routes', async () => {
    const http = app.getHttpServer();
    const routes: Array<{ name: string; auth: string; path: string }> = [
      { name: 'dashboard', auth: ownerToken, path: '/salon/overall-performance' },
      { name: 'dashboard-skew', auth: skewToken, path: '/salon/overall-performance' },
      { name: 'customer-search', auth: ownerToken, path: '/customers?q=1000' },
      { name: 'customer-detail', auth: ownerToken, path: `/customers/${customerId}` },
      { name: 'customer-intelligence', auth: ownerToken, path: `/intelligence/customers/${customerId}` },
      { name: 'revenue-drops', auth: ownerToken, path: '/intelligence/revenue-drops' },
      { name: 'follow-ups', auth: ownerToken, path: '/follow-ups/customers' },
      { name: 'vip-history', auth: ownerToken, path: '/vip/requests' },
      { name: 'message-history', auth: ownerToken, path: '/messages/history' },
      { name: 'visits', auth: ownerToken, path: '/visits' },
      { name: 'admin-vip-folders', auth: adminToken, path: '/admin/vip/outreach/salons' },
      { name: 'admin-vip-lists', auth: adminToken, path: '/admin/vip/lists' },
      { name: 'admin-salon-profile', auth: adminToken, path: `/admin/vip/salons/${LARGE}/profile` },
    ];
    if (dropCursor) {
      routes.push({
        name: 'revenue-drops-page2',
        auth: ownerToken,
        path: `/intelligence/revenue-drops?cursor=${encodeURIComponent(dropCursor)}`,
      });
    }
    const coverageList = await app.get(PrismaService).client.vipTargetList.findFirst({
      where: { name: 'scale-coverage' },
      select: { id: true },
    });
    if (coverageList) {
      routes.push({
        name: 'admin-list-results',
        auth: adminToken,
        path: `/admin/vip/lists/${coverageList.id}/salon-results`,
      });
    }
    const results: Sample[] = [];
    const superDb = createPrismaClient(SUPER_URL, { connectionLimit: 1, poolTimeoutSeconds: 10 });
    const poolSamples: Array<{ endpoint: string; concurrency: number; rows: Array<Record<string, unknown>> }> = [];
    for (const route of routes) {
      for (const concurrency of [10, 25, 50]) {
        const stop = { done: false };
        const watch = (async () => {
          while (!stop.done) {
            const rows = await superDb.$queryRawUnsafe<Array<Record<string, unknown>>>(`
              SELECT usename, state, wait_event_type, wait_event, COUNT(*)::int AS sessions
              FROM pg_stat_activity
              WHERE datname = current_database()
              GROUP BY usename, state, wait_event_type, wait_event
            `);
            poolSamples.push({ endpoint: route.name, concurrency, rows });
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        })();
        results.push(await hammer(route.name, concurrency, 100, () =>
          request(http).get(route.path).agent(httpAgent).set('Authorization', `Bearer ${route.auth}`),
        ));
        stop.done = true;
        await watch;
      }
    }
    let flip = 0;
    for (const concurrency of [10, 25, 50]) {
      results.push(await hammer('dashboard-mixed', concurrency, 100, () => {
        const token = flip % 2 === 0 ? ownerToken : skewToken;
        flip += 1;
        return request(http).get('/salon/overall-performance').agent(httpAgent).set('Authorization', `Bearer ${token}`);
      }));
    }
    const exportResult = await hammer('visits-export-one-customer', 10, 20, () =>
      request(http).get(`/visits/export?customerId=${customerId}`).agent(httpAgent).set('Authorization', `Bearer ${ownerToken}`),
    );
    results.push(exportResult);
    const waiting = poolSamples.flatMap((sample) =>
      sample.rows
        .filter((row) => row.wait_event_type != null && row.wait_event_type !== 'Client')
        .map((row) => ({ endpoint: sample.endpoint, concurrency: sample.concurrency, ...row })),
    );
    await superDb.$disconnect();
    const report = {
      dataset: { largeCustomers: 50_000, largeVisits: 250_000, pool: 10, attemptedPerCell: 100 },
      dropCursorPresent: dropCursor.length > 0,
      results,
      inFlightWaits: waiting.slice(0, 40),
      inFlightSamples: poolSamples.length,
    };
    writeFileSync('/tmp/salon-scale-http.json', JSON.stringify(report, null, 2));
    const dashboard = results.filter((row) => row.endpoint === 'dashboard' && row.concurrency === 10)[0];
    expect(dashboard?.attempted).toBe(100);
    expect(dashboard?.statuses['200'] ?? 0).toBeGreaterThan(0);
  }, 720_000);
});

describeIfScale('production throttle still rejects the 61st request', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let token = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    token = await app.get(JwtService).signAsync({ sub: LARGE_USER, tid: LARGE, role: 'OWNER' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 429 after 60 requests in the default window', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 65; index += 1) {
      const response = await request(app.getHttpServer())
        .get('/customers?q=1')
        .set('Authorization', `Bearer ${token}`);
      statuses.push(response.status);
    }
    const limited = statuses.filter((status) => status === 429).length;
    const allowed = statuses.filter((status) => status === 200).length;
    expect(allowed).toBe(60);
    expect(limited).toBe(5);
    writeFileSync('/tmp/salon-throttle-check.json', JSON.stringify({ attempted: 65, allowed, limited }));
  });
});

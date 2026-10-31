import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { VISIT_EXPORT_HEADERS, VISIT_EXPORT_MAX_ROWS } from '../src/visit/visit-export.constants';
import { formatJalaliDateTimeTehran } from '../src/visit/jalali-format';
import { createProductOwnerSession } from './support/phone-account';

const databaseUrl = process.env.DATABASE_URL ?? '';
const dedicatedUrl = process.env.EXPORT_HIST_DISPOSABLE_DATABASE_URL ?? '';
const REFUSED_SYSTEM_IDS = new Set(['7700113693112733735', '7683163620851879970']);
const disposable = (() => {
  if (!databaseUrl || databaseUrl !== dedicatedUrl) return null;
  try {
    const parsed = new URL(databaseUrl);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55931') return null;
    if (name !== 'salon_export_hist_20261031') return null;
    return name;
  } catch {
    return null;
  }
})();
const describeIf = disposable ? describe : describe.skip;

const WINDOW_COUNT = 3_000;
const PRE_COUNT = 20;
const LIMIT_COUNT = VISIT_EXPORT_MAX_ROWS + 1;
const BASE_MS = Date.parse('2026-04-01T00:00:00.000Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const LIMIT_BASE_MS = Date.parse('2025-01-01T00:00:00.000Z');
const MINUTE_MS = 60_000;

function moneyText(index: number): string {
  const cents = 100050 + index;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function windowInstant(index: number): Date {
  return new Date(BASE_MS + index * HOUR_MS);
}

type ExpectedRow = {
  name: string;
  service: string | null;
  amount: string | null;
  visitedAt: Date;
  days: number | null;
};

function expectedWindowRows(): ExpectedRow[] {
  const history: Array<{ at: Date; index: number | null }> = [];
  for (let day = PRE_COUNT; day >= 1; day -= 1) {
    history.push({ at: new Date(BASE_MS - day * DAY_MS), index: null });
  }
  for (let index = 0; index < WINDOW_COUNT; index += 1) {
    history.push({ at: windowInstant(index), index });
  }
  history.push({ at: windowInstant(WINDOW_COUNT), index: null });
  history.sort((left, right) => left.at.getTime() - right.at.getTime());
  const rows: ExpectedRow[] = [];
  for (let position = 0; position < history.length; position += 1) {
    const current = history[position]!;
    if (current.index == null) continue;
    if (current.at.getTime() < BASE_MS || current.at.getTime() >= BASE_MS + WINDOW_COUNT * HOUR_MS) continue;
    const previous = position === 0 ? null : history[position - 1]!;
    const kind = current.index % 3;
    rows.push({
      name: 'Large History',
      service: kind === 2 ? null : 'برش',
      amount: kind === 0 ? moneyText(current.index) : null,
      visitedAt: current.at,
      days: previous == null ? null : Math.floor((current.at.getTime() - previous.at.getTime()) / DAY_MS),
    });
  }
  return rows.sort((left, right) => right.visitedAt.getTime() - left.visitedAt.getTime());
}

describeIf('visit export history on a disposable database', () => {
  jest.setTimeout(300_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let otherToken = '';
  let customerId = '';
  let limitCustomerId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const identity = await prisma.client.$queryRaw<Array<{ name: string; comment: string | null; systemId: string }>>`
      SELECT current_database() AS name,
             shobj_description(oid, 'pg_database') AS comment,
             (SELECT system_identifier::text FROM pg_control_system()) AS "systemId"
      FROM pg_database WHERE datname = current_database()
    `;
    const row = identity[0];
    if (row?.name !== 'salon_export_hist_20261031' || row.comment !== 'export-hist-disposable:20261031' || REFUSED_SYSTEM_IDS.has(row.systemId)) {
      throw new Error('Refusing visit export history tests without the disposable database');
    }
    const owner = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'Export Hist',
      ownerName: 'Export Owner',
    });
    const other = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'Export Other',
      ownerName: 'Export Other Owner',
    });
    ownerToken = owner.accessToken;
    otherToken = other.accessToken;
    customerId = randomUUID();
    const sameSalonOther = randomUUID();
    const foreignCustomer = randomUUID();
    limitCustomerId = randomUUID();
    const serviceId = randomUUID();
    const otherService = randomUUID();
    const phoneBase = Date.now() % 1_000_000;
    const phone = (suffix: number) => `0913${String(phoneBase + suffix).padStart(7, '0')}`;
    await prisma.client.customer.createMany({
      data: [
        { id: customerId, salonId: owner.salonId, firstName: 'Large', lastName: 'History', phoneNumber: phone(1), updatedAt: new Date() },
        { id: sameSalonOther, salonId: owner.salonId, firstName: 'Same', lastName: 'Neighbor', phoneNumber: phone(2), updatedAt: new Date() },
        { id: foreignCustomer, salonId: other.salonId, firstName: 'Foreign', lastName: 'Tenant', phoneNumber: phone(3), updatedAt: new Date() },
        { id: limitCustomerId, salonId: owner.salonId, firstName: 'Limit', lastName: 'Boundary', phoneNumber: phone(4), updatedAt: new Date() },
      ],
    });
    await prisma.client.service.createMany({
      data: [
        { id: serviceId, salonId: owner.salonId, name: 'برش', updatedAt: new Date() },
        { id: otherService, salonId: other.salonId, name: 'برش', updatedAt: new Date() },
      ],
    });
    await prisma.client.$executeRaw`
      INSERT INTO visits (id, salon_id, customer_id, visited_at, updated_at)
      SELECT gen_random_uuid(),
        ${owner.salonId}::uuid,
        ${customerId}::uuid,
        '2026-04-01T00:00:00.000Z'::timestamptz + (i * interval '1 hour'),
        now()
      FROM generate_series(0, ${WINDOW_COUNT - 1}) AS i
    `;
    await prisma.client.$executeRaw`
      INSERT INTO visits (id, salon_id, customer_id, visited_at, updated_at)
      SELECT gen_random_uuid(),
        ${owner.salonId}::uuid,
        ${customerId}::uuid,
        '2026-04-01T00:00:00.000Z'::timestamptz - (day * interval '1 day'),
        now()
      FROM generate_series(1, ${PRE_COUNT}) AS day
    `;
    await prisma.client.$executeRaw`
      INSERT INTO visits (id, salon_id, customer_id, visited_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${owner.salonId}::uuid,
        ${customerId}::uuid,
        '2026-04-01T00:00:00.000Z'::timestamptz + (${WINDOW_COUNT} * interval '1 hour'),
        now()
      )
    `;
    await prisma.client.$executeRaw`
      INSERT INTO visits (id, salon_id, customer_id, visited_at, updated_at)
      VALUES
        (gen_random_uuid(), ${owner.salonId}::uuid, ${sameSalonOther}::uuid, '2026-04-02T00:00:00.000Z'::timestamptz, now()),
        (gen_random_uuid(), ${owner.salonId}::uuid, ${sameSalonOther}::uuid, '2026-04-03T00:00:00.000Z'::timestamptz, now()),
        (gen_random_uuid(), ${other.salonId}::uuid, ${foreignCustomer}::uuid, '2026-04-02T00:00:00.000Z'::timestamptz, now())
    `;
    await prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO transactions (
          id, salon_id, customer_id, visit_id, occurred_at, amount, status, updated_at
        )
        SELECT gen_random_uuid(),
          v.salon_id,
          v.customer_id,
          v.id,
          v.visited_at,
          ((100050 + hours.i)::numeric / 100),
          CASE WHEN hours.i % 3 = 0 THEN 'COMPLETED'::"TransactionStatus" ELSE 'VOIDED'::"TransactionStatus" END,
          now()
        FROM visits v
        JOIN generate_series(0, ${WINDOW_COUNT - 1}) AS hours(i)
          ON v.visited_at = '2026-04-01T00:00:00.000Z'::timestamptz + (hours.i * interval '1 hour')
        WHERE v.customer_id = ${customerId}::uuid
          AND hours.i % 3 <> 2
      `;
      await tx.$executeRaw`
        INSERT INTO transaction_items (
          id, salon_id, transaction_id, service_id, quantity, unit_price, total_amount
        )
        SELECT gen_random_uuid(),
          t.salon_id,
          t.id,
          ${serviceId}::uuid,
          1,
          t.amount,
          t.amount
        FROM transactions t
        WHERE t.customer_id = ${customerId}::uuid
      `;
    }, { timeout: 60_000 });
    await prisma.client.$executeRaw`
      INSERT INTO visits (id, salon_id, customer_id, visited_at, updated_at)
      SELECT gen_random_uuid(),
        ${owner.salonId}::uuid,
        ${limitCustomerId}::uuid,
        '2025-01-01T00:00:00.000Z'::timestamptz + (i * interval '1 minute'),
        now()
      FROM generate_series(0, ${LIMIT_COUNT - 1}) AS i
    `;
  });

  afterAll(async () => {
    await app.close();
  });

  function exportUrl(id: string, from: string, to: string): string {
    return `/visits/export?customerId=${id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }

  function readWorkbook(server: http.Server, url: string) {
    return request(server)
      .get(url)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk) => data.push(chunk as Buffer));
        res.on('end', () => callback(null, Buffer.concat(data)));
      });
  }

  it('exports the selected window with order, money, prior-visit days, and tenant isolation', async () => {
    const from = new Date(BASE_MS).toISOString();
    const to = windowInstant(WINDOW_COUNT).toISOString();
    const response = await readWorkbook(app.getHttpServer(), exportUrl(customerId, from, to))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as Buffer);
    const sheet = workbook.worksheets[0]!;
    const headers = VISIT_EXPORT_HEADERS.map((_, index) => String(sheet.getRow(1).getCell(index + 1).value ?? ''));
    expect(headers).toEqual([...VISIT_EXPORT_HEADERS]);
    const expected = expectedWindowRows();
    expect(sheet.rowCount - 1).toBe(expected.length);
    expect(expected.length).toBe(WINDOW_COUNT);
    for (let index = 0; index < expected.length; index += 1) {
      const row = sheet.getRow(index + 2);
      const want = expected[index]!;
      expect(String(row.getCell(1).value)).toBe(want.name);
      expect(row.getCell(2).value ?? null).toBe(want.service);
      const amount = row.getCell(3).value;
      expect(amount == null ? null : Number(amount).toFixed(2)).toBe(want.amount);
      expect(String(row.getCell(4).value)).toBe(formatJalaliDateTimeTehran(want.visitedAt));
      const days = row.getCell(5).value;
      expect(days == null ? null : Number(days)).toBe(want.days);
    }
    const names = new Set<string>();
    sheet.eachRow((row, index) => {
      if (index > 1) names.add(String(row.getCell(1).value));
    });
    expect(names).toEqual(new Set(['Large History']));

    const boundary = windowInstant(WINDOW_COUNT).toISOString();
    const excluded = await readWorkbook(
      app.getHttpServer(),
      exportUrl(customerId, boundary, new Date(windowInstant(WINDOW_COUNT).getTime() + HOUR_MS).toISOString()),
    )
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const outside = new ExcelJS.Workbook();
    await outside.xlsx.load(excluded.body as Buffer);
    expect(outside.worksheets[0]!.rowCount - 1).toBe(1);

    await request(app.getHttpServer())
      .get(exportUrl(customerId, from, to))
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('rejects one row past the documented limit and returns the exact boundary', async () => {
    const start = new Date(LIMIT_BASE_MS).toISOString();
    const over = new Date(LIMIT_BASE_MS + LIMIT_COUNT * MINUTE_MS).toISOString();
    const overflow = await request(app.getHttpServer())
      .get(exportUrl(limitCustomerId, start, over))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    expect(`${overflow.text} ${JSON.stringify(overflow.body)}`).toContain(String(VISIT_EXPORT_MAX_ROWS));
    const exactTo = new Date(LIMIT_BASE_MS + VISIT_EXPORT_MAX_ROWS * MINUTE_MS).toISOString();
    const exact = await readWorkbook(app.getHttpServer(), exportUrl(limitCustomerId, start, exactTo))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exact.body as Buffer);
    expect(workbook.worksheets[0]!.rowCount - 1).toBe(VISIT_EXPORT_MAX_ROWS);
  });

  it('sustains a capped export workload and explains the window query', async () => {
    const from = new Date(BASE_MS).toISOString();
    const to = windowInstant(WINDOW_COUNT).toISOString();
    const plan = await prisma.client.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<Record<string, unknown>> }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT COUNT(*) FROM visits
       WHERE salon_id = $1::uuid AND customer_id = $2::uuid
         AND visited_at >= $3::timestamptz AND visited_at < $4::timestamptz`,
      (await prisma.client.customer.findFirstOrThrow({ where: { id: customerId } })).salonId,
      customerId,
      from,
      to,
    );
    const root = plan[0]?.['QUERY PLAN']?.[0];
    expect(root).toBeTruthy();

    const before = await prisma.client.$queryRaw<Array<{ commits: bigint }>>`
      SELECT xact_commit AS commits FROM pg_stat_database WHERE datname = current_database()
    `;
    const auditsBefore = await prisma.client.auditLog.count({ where: { action: 'VISITS_EXPORTED' } });
    const server = app.getHttpServer();
    const wallStart = Date.now();
    const until = wallStart + 30_000;
    const maxRequests = 20;
    const maxBytes = 40_000_000;
    let reserved = 0;
    let attempted = 0;
    let bytes = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const statuses: Record<string, number> = {};
    const samples: number[] = [];
    async function once(): Promise<void> {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const started = Date.now();
      const response = await readWorkbook(server, exportUrl(customerId, from, to))
        .set('Authorization', `Bearer ${ownerToken}`);
      inFlight -= 1;
      attempted += 1;
      bytes += Buffer.isBuffer(response.body) ? response.body.length : Buffer.byteLength(JSON.stringify(response.body));
      statuses[String(response.status)] = (statuses[String(response.status)] ?? 0) + 1;
      samples.push(Date.now() - started);
    }
    const workers = Array.from({ length: 5 }, async () => {
      for (;;) {
        if (Date.now() >= until || bytes >= maxBytes) return;
        if (reserved >= maxRequests) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, until - Date.now())));
          return;
        }
        reserved += 1;
        await once();
        const remaining = until - Date.now();
        if (remaining <= 0) return;
        await new Promise((resolve) => setTimeout(resolve, Math.min(1_500, remaining)));
      }
    });
    await Promise.all(workers);
    const wallMs = Date.now() - wallStart;
    const after = await prisma.client.$queryRaw<Array<{ commits: bigint }>>`
      SELECT xact_commit AS commits FROM pg_stat_database WHERE datname = current_database()
    `;
    const auditsAfter = await prisma.client.auditLog.count({ where: { action: 'VISITS_EXPORTED' } });
    const sorted = [...samples].sort((left, right) => left - right);
    const summary = {
      attempted,
      statuses,
      bytes,
      maxInFlight,
      durationMs: samples.reduce((sum, value) => sum + value, 0),
      wallMs,
      p50: sorted[Math.floor(sorted.length / 2)] ?? null,
      commits: Number(after[0]!.commits - before[0]!.commits),
      audits: auditsAfter - auditsBefore,
      explainMs: root?.['Execution Time'] ?? null,
      explainTempWritten: (root?.Plan as Record<string, unknown> | undefined)?.['Temp Written Blocks'] ?? null,
    };
    process.stdout.write(`export-load ${JSON.stringify(summary)}\n`);
    expect(statuses['200']).toBe(attempted);
    expect(attempted).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(auditsAfter - auditsBefore).toBe(attempted);
  });
});

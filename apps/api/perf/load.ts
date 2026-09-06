/**
 * HTTP concurrency checks. Requires a running API.
 *   set RUN_LOAD=true && pnpm perf:load
 * Not part of unit, e2e, or CI default tests.
 */
import ExcelJS from 'exceljs';

const base = process.env.API_BASE_URL ?? 'http://localhost:3000';
const enabled = process.env.RUN_LOAD === 'true';

type Json = Record<string, unknown>;

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

function report(label: string, samples: number[], extra: Json = {}) {
  console.log(
    JSON.stringify({
      label,
      n: samples.length,
      p50: Number(percentile(samples, 0.5).toFixed(2)),
      p95: Number(percentile(samples, 0.95).toFixed(2)),
      p99: Number(percentile(samples, 0.99).toFixed(2)),
      ...extra,
    }),
  );
}

async function register(label: string) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      salonName: `${label} ${stamp}`,
      ownerName: 'Load Owner',
      email: `load-${label}-${stamp}@example.test`,
      password: 'correct-horse-battery',
    }),
  });
  if (!res.ok) {
    throw new Error(`register ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

function authHeaders(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra };
}

function phone(seed: string): string {
  const digits = seed.replace(/\D/g, '').padEnd(9, '0').slice(-9);
  return `09${digits}`;
}

async function createCustomer(token: string, lastName: string, number: string) {
  const res = await fetch(`${base}/customers`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ firstName: 'Load', lastName, phoneNumber: number }),
  });
  const body = (await res.json()) as { id?: string };
  return { status: res.status, id: body.id };
}

async function timedLoop(label: string, rounds: number, fn: () => Promise<Response>) {
  const samples: number[] = [];
  let errors = 0;
  for (let i = 0; i < rounds; i += 1) {
    const start = performance.now();
    try {
      const res = await fn();
      if (!res.ok && res.status >= 500) {
        errors += 1;
      }
      await res.arrayBuffer();
    } catch {
      errors += 1;
    }
    samples.push(performance.now() - start);
  }
  report(label, samples, { errors });
}

async function xlsxBuffer(rowCount: number, prefix: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customers');
  sheet.addRow(['Name', 'Phone']);
  for (let i = 0; i < rowCount; i += 1) {
    sheet.addRow([`Import ${prefix} ${i}`, phone(`${prefix}${i}`)]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function main() {
  if (!enabled) {
    console.log('Set RUN_LOAD=true to run HTTP load checks against', base);
    return;
  }

  const token = await register('primary');
  const rssStart = process.memoryUsage().rss;

  await timedLoop('GET /customers', 20, () => fetch(`${base}/customers`, { headers: authHeaders(token) }));
  await timedLoop('GET /intelligence/summary', 20, () =>
    fetch(`${base}/intelligence/summary`, { headers: authHeaders(token) }),
  );

  const uniqueStart = performance.now();
  const unique = await Promise.all(
    Array.from({ length: 25 }, (_, i) => createCustomer(token, `U${i}`, phone(`a${Date.now()}${i}`))),
  );
  const uniqueOk = unique.filter((row) => row.status === 201).length;
  report('A concurrent unique customer create', [performance.now() - uniqueStart], {
    created: uniqueOk,
    total: unique.length,
    errorRate: Number(((unique.length - uniqueOk) / unique.length).toFixed(3)),
  });
  if (uniqueOk !== unique.length) {
    throw new Error(`Test A expected ${unique.length} creates, got ${uniqueOk}`);
  }

  const dupPhone = phone(`dup${Date.now()}`);
  const dup = await Promise.all(
    Array.from({ length: 8 }, () => createCustomer(token, 'Dup', dupPhone)),
  );
  const dupCreated = dup.filter((row) => row.status === 201).length;
  const dupConflict = dup.filter((row) => row.status === 409).length;
  console.log(
    JSON.stringify({
      label: 'B concurrent duplicate phone',
      created: dupCreated,
      conflict: dupConflict,
      other: dup.length - dupCreated - dupConflict,
    }),
  );
  if (dupCreated !== 1) {
    throw new Error(`Test B expected exactly one customer, got ${dupCreated}`);
  }

  const visitCustomers = unique.slice(0, 8).map((row) => row.id).filter((id): id is string => Boolean(id));
  const visitStart = performance.now();
  const visitRes = await Promise.all(
    visitCustomers.map((customerId, i) =>
      fetch(`${base}/visits`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ customerId, visitedAt: `2026-05-0${(i % 9) + 1}T10:00:00.000Z` }),
      }),
    ),
  );
  const visitOk = visitRes.filter((res) => res.status === 201).length;
  report('C concurrent visit create', [performance.now() - visitStart], { created: visitOk, total: visitRes.length });
  if (visitOk !== visitRes.length) {
    throw new Error(`Test C expected ${visitRes.length} visits, got ${visitOk}`);
  }

  const idemCustomer = visitCustomers[0];
  if (!idemCustomer) {
    throw new Error('Test D missing customer');
  }
  const idemPayload = { customerId: idemCustomer, visitedAt: '2026-06-15T08:00:00.000Z' };
  const idemKey = `load-idem-${Date.now()}`;
  const idemRes = await Promise.all(
    [1, 2, 3, 4].map(() =>
      fetch(`${base}/visits`, {
        method: 'POST',
        headers: authHeaders(token, { 'Idempotency-Key': idemKey }),
        body: JSON.stringify(idemPayload),
      }),
    ),
  );
  const idemBodies = await Promise.all(idemRes.map(async (res) => ({ status: res.status, body: await res.json() })));
  const idemCreated = idemBodies.filter((row) => row.status === 201);
  const visitIds = new Set(idemCreated.map((row) => (row.body as { id?: string }).id));
  console.log(
    JSON.stringify({
      label: 'D concurrent visit idempotency',
      status201: idemCreated.length,
      uniqueVisitIds: visitIds.size,
    }),
  );
  if (visitIds.size !== 1 || idemCreated.length !== 4) {
    throw new Error('Test D expected four 201 responses for one visit id');
  }

  const victim = await createCustomer(token, 'Victim', phone(`v${Date.now()}`));
  if (!victim.id) {
    throw new Error('Test E could not create customer');
  }
  const [visitDuringDelete, deleteRes] = await Promise.all([
    fetch(`${base}/visits`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ customerId: victim.id, visitedAt: '2026-04-01T10:00:00.000Z' }),
    }),
    fetch(`${base}/customers/${victim.id}`, { method: 'DELETE', headers: authHeaders(token) }),
  ]);
  const eStatuses = [visitDuringDelete.status, deleteRes.status].sort();
  const eUnexpected = [visitDuringDelete, deleteRes].filter((res) => res.status >= 500).length;
  console.log(
    JSON.stringify({
      label: 'E delete vs visit create',
      statuses: eStatuses,
      unexpected500: eUnexpected,
    }),
  );
  if (eUnexpected > 0) {
    throw new Error('Test E returned 500');
  }

  const writePromise = Promise.all(
    Array.from({ length: 10 }, (_, i) => createCustomer(token, `W${i}`, phone(`w${Date.now()}${i}`))),
  );
  const listSamples: number[] = [];
  for (let i = 0; i < 15; i += 1) {
    const start = performance.now();
    const res = await fetch(`${base}/customers`, { headers: authHeaders(token) });
    listSamples.push(performance.now() - start);
    if (res.status >= 500) {
      throw new Error(`Test F list ${res.status}`);
    }
    await res.arrayBuffer();
  }
  await writePromise;
  report('F list during writes', listSamples);

  const intelSamples: number[] = [];
  const intel = await Promise.all(
    Array.from({ length: 12 }, async () => {
      const start = performance.now();
      const res = await fetch(`${base}/intelligence/summary`, { headers: authHeaders(token) });
      intelSamples.push(performance.now() - start);
      return res.status;
    }),
  );
  report('G concurrent intelligence', intelSamples, {
    errors: intel.filter((status) => status >= 500).length,
  });

  const tokens = await Promise.all([register('imp-a'), register('imp-b'), register('imp-c')]);
  const importStart = performance.now();
  const imports = await Promise.all(
    tokens.map(async (impToken, i) => {
      const file = await xlsxBuffer(100, `${i}${Date.now()}`);
      const form = new FormData();
      form.append('file', new Blob([file]), 'customers.xlsx');
      const res = await fetch(`${base}/customers/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${impToken}` },
        body: form,
      });
      return res.status;
    }),
  );
  report('H concurrent import 100 rows x 3 salons', [performance.now() - importStart], {
    statuses: imports,
  });
  if (imports.some((status) => status >= 500)) {
    throw new Error('Test H unexpected 500');
  }

  console.log(
    JSON.stringify({
      label: 'process rss bytes',
      start: rssStart,
      end: process.memoryUsage().rss,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

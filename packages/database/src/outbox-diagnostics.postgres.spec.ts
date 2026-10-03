import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './client';
import { markOutboxDeadLetter, markOutboxRetry } from './outbox';

// Both the target and its database comment must identify this disposable run.
const isolatedUrl = process.env.PHASE11_ISOLATED_DATABASE_URL;
const disposableName = process.env.PHASE11_DISPOSABLE_DATABASE_NAME;
const ownershipToken = process.env.PHASE11_DISPOSABLE_OWNERSHIP_TOKEN;
const target = (() => {
  if (!isolatedUrl || !disposableName || !ownershipToken || isolatedUrl === process.env.DATABASE_URL) return false;
  try {
    const url = new URL(isolatedUrl);
    return url.protocol === 'postgresql:'
      && url.hostname === '127.0.0.1'
      && url.port !== ''
      && /^salon_phase11_[a-z0-9_]+$/.test(disposableName)
      && decodeURIComponent(url.pathname.slice(1)) === disposableName;
  } catch {
    return false;
  }
})();
const describeIsolated = target ? describe : describe.skip;

describeIsolated('PostgreSQL outbox diagnostic persistence', () => {
  const db = createPrismaClient(isolatedUrl ?? 'postgresql://unused');
  const id = randomUUID();
  const synthetic = 'PHONE_FAKE_09120000000 BODY_FAKE_HELLO MONEY_FAKE_1234.56 TOKEN_FAKE_XYZ DBURL_FAKE_postgres OBJECT_FAKE_vip/key';
  const markers = synthetic.split(' ');
  const storedText = (row: object) => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  let verifiedOwner = false;

  beforeAll(async () => {
    const rows = await db.$queryRaw<Array<{ name: string; comment: string | null }>>`
      SELECT datname AS name, shobj_description(oid, 'pg_database') AS comment
      FROM pg_database WHERE datname = current_database()
    `;
    if (rows[0]?.name !== disposableName || rows[0]?.comment !== `phase11-disposable:${ownershipToken}`) {
      throw new Error('Phase 11 disposable database ownership check failed');
    }
    verifiedOwner = true;
  });

  afterAll(async () => {
    if (verifiedOwner) await db.outboxEvent.deleteMany({ where: { id } });
    await db.$disconnect();
  });

  it('stores only stable retry and dead-letter codes and rejects a stale generation', async () => {
    await db.outboxEvent.create({ data: {
      id, eventType: 'VisitCompleted', payload: {}, status: 'PROCESSING',
      claimGeneration: 1n, attemptCount: 1,
    } });

    expect(await markOutboxRetry(db, id, 1n, synthetic, 1000)).toBe(true);
    const retryRow = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(retryRow.lastError).toBe('CONSUMER_FAILED');
    for (const marker of markers) expect(storedText(retryRow)).not.toContain(marker);

    await db.outboxEvent.update({ where: { id }, data: {
      status: 'PROCESSING', claimGeneration: 2n, attemptCount: 2,
    } });
    expect(await markOutboxDeadLetter(db, id, 1n, synthetic)).toBe(false);
    expect(await markOutboxDeadLetter(db, id, 2n, 'PROVIDER_RATE_LIMITED')).toBe(true);
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('DEAD_LETTER');
    expect(row.lastError).toBe('PROVIDER_RATE_LIMITED');
    for (const marker of markers) expect(storedText(row)).not.toContain(marker);
  });
});

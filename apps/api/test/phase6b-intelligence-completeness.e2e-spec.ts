import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.PHASE6B_ISOLATED_DATABASE_URL ? describe : describe.skip;

describeIfDb('Phase 6B intelligence completeness (disposable PostgreSQL)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let token: string;
  let otherToken: string;
  let emptyToken: string;
  let exactToken: string;
  const salonId = randomUUID();
  const otherSalonId = randomUUID();
  const emptySalonId = randomUUID();
  const exactSalonId = randomUUID();
  const customerIds = Array.from({ length: 5201 }, () => randomUUID());
  const exactDualId = '00000000-0000-4000-8000-000000000001';
  const qualifyingIndexes = [...Array.from({ length: 200 }, (_, index) => 1200 + index), 5200];
  const eligibleIds = new Set(qualifyingIndexes.map((index) => customerIds[index]!));

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== process.env.PHASE6B_ISOLATED_DATABASE_URL) {
      throw new Error('Phase 6B requires the explicitly identified disposable DATABASE_URL');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    db = app.get(PrismaService);
    const jwt = app.get(JwtService);
    await db.client.salon.createMany({ data: [
      { id: salonId, name: 'Phase 6B large salon' },
      { id: otherSalonId, name: 'Phase 6B other salon' },
      { id: emptySalonId, name: 'Phase 6B empty salon' },
      { id: exactSalonId, name: 'Phase 6B exact page salon' },
    ] });
    const userId = randomUUID(), otherUserId = randomUUID();
    const emptyUserId = randomUUID(), exactUserId = randomUUID();
    await db.client.user.createMany({ data: [
      { id: userId, salonId, name: 'Owner', email: `${userId}@example.test`, passwordHash: 'unused', role: 'OWNER' },
      { id: otherUserId, salonId: otherSalonId, name: 'Other owner', email: `${otherUserId}@example.test`, passwordHash: 'unused', role: 'OWNER' },
      { id: emptyUserId, salonId: emptySalonId, name: 'Empty owner', email: `${emptyUserId}@example.test`, passwordHash: 'unused', role: 'OWNER' },
      { id: exactUserId, salonId: exactSalonId, name: 'Exact owner', email: `${exactUserId}@example.test`, passwordHash: 'unused', role: 'OWNER' },
    ] });
    token = await jwt.signAsync({ sub: userId, tid: salonId, role: 'OWNER' });
    otherToken = await jwt.signAsync({ sub: otherUserId, tid: otherSalonId, role: 'OWNER' });
    emptyToken = await jwt.signAsync({ sub: emptyUserId, tid: emptySalonId, role: 'OWNER' });
    exactToken = await jwt.signAsync({ sub: exactUserId, tid: exactSalonId, role: 'OWNER' });
    const newer = new Date('2026-01-01T00:00:00.000Z');
    const older = new Date('2025-01-01T00:00:00.000Z');
    await db.client.customer.createMany({ data: customerIds.map((id, index) => ({
      id, salonId, firstName: 'Fixture', lastName: String(index),
      phoneNumber: `09${String(index).padStart(9, '0')}`,
      createdAt: index < 5000 ? newer : older,
    })) });
    const now = Date.now();
    const daysAgo = (days: number) => new Date(now - days * 86_400_000);
    const nonmatching = Array.from({ length: 1000 }, (_, index) => customerIds[index]!);
    await db.client.visit.createMany({ data: [
      ...nonmatching.flatMap((customerId) => [500, 80].map((days) => ({
        id: randomUUID(), salonId, customerId, visitedAt: daysAgo(days),
      }))),
      ...qualifyingIndexes.map((index) => ({
        id: randomUUID(), salonId, customerId: customerIds[index]!, visitedAt: daysAgo(75),
      })),
    ] });
    const otherCustomerId = randomUUID();
    await db.client.customer.create({ data: {
      id: otherCustomerId, salonId: otherSalonId, firstName: 'Other', lastName: 'Tenant',
      phoneNumber: '09129999999',
    } });
    await db.client.visit.create({ data: {
      id: randomUUID(), salonId: otherSalonId, customerId: otherCustomerId,
      visitedAt: daysAgo(75),
    } });
    const exactIds = [exactDualId, ...Array.from({ length: 199 }, () => randomUUID())];
    await db.client.customer.createMany({ data: exactIds.map((id, index) => ({
      id, salonId: exactSalonId, firstName: 'Exact', lastName: String(index),
      phoneNumber: `08${String(index).padStart(9, '0')}`,
    })) });
    await db.client.visit.createMany({ data: exactIds.map((customerId) => ({
      id: randomUUID(), salonId: exactSalonId, customerId, visitedAt: daysAgo(75),
    })) });
    const month = new Date();
    const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const previousMonthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1));
    const previousMonthEnd = new Date(monthStart.getTime() - 1);
    const serviceId = randomUUID(), exactServiceId = randomUUID();
    await db.client.service.createMany({ data: [
      { id: serviceId, salonId, name: 'Synthetic revenue' },
      { id: exactServiceId, salonId: exactSalonId, name: 'Synthetic revenue' },
    ] });
    const revenueRows = [
      { id: randomUUID(), salonId, customerId: customerIds[5200]!, occurredAt: previousMonthStart, amount: '40.00', status: 'COMPLETED' },
      { id: randomUUID(), salonId, customerId: customerIds[5200]!, occurredAt: previousMonthEnd, amount: '60.00', status: 'COMPLETED' },
      { id: randomUUID(), salonId, customerId: customerIds[5200]!, occurredAt: previousMonthEnd, amount: '200.00', status: 'VOIDED' },
      { id: randomUUID(), salonId, customerId: customerIds[5000]!, occurredAt: monthStart, amount: '1.00', status: 'COMPLETED' },
      { id: randomUUID(), salonId: exactSalonId, customerId: exactDualId, occurredAt: previousMonthStart, amount: '10.00', status: 'COMPLETED' },
    ] as const;
    await db.client.$transaction(async (tx) => {
      await tx.ledgerTransaction.createMany({ data: revenueRows.map((row) => ({ ...row, updatedAt: new Date() })) });
      await tx.transactionItem.createMany({ data: revenueRows.map((row) => ({
        id: randomUUID(), salonId: row.salonId, transactionId: row.id,
        serviceId: row.salonId === exactSalonId ? exactServiceId : serviceId,
        quantity: 1, unitPrice: row.amount, totalAmount: row.amount,
      })) });
    });
  }, 120_000);

  afterAll(async () => {
    if (!app) return;
    for (const id of [salonId, otherSalonId, emptySalonId, exactSalonId]) {
      await db.client.$transaction(async (tx) => {
        await tx.transactionItem.deleteMany({ where: { salonId: id } });
        await tx.ledgerTransaction.deleteMany({ where: { salonId: id } });
      });
      await db.client.service.deleteMany({ where: { salonId: id } });
      await db.client.visit.deleteMany({ where: { salonId: id } });
      await db.client.customer.deleteMany({ where: { salonId: id } });
      await db.client.user.deleteMany({ where: { salonId: id } });
      await db.client.salon.delete({ where: { id } });
    }
    await app.close();
  });

  const get = (path: string, accessToken = token) => request(app.getHttpServer()).get(path)
    .set('Authorization', `Bearer ${accessToken}`);

  it('includes every customer and older qualifying visits in the complete summary', async () => {
    const result = await get('/intelligence/summary').expect(200);
    expect(result.body.customers).toBe(5201);
    expect(result.body.new).toBe(4000);
    expect(result.body.returning).toBe(1000);
    expect(result.body.inactive).toBe(201);
    expect(result.body.customerReturnOpportunities).toBe(201);
    expect(result.body.hasMore).toBe(false);
    expect(result.body.totalRevenue).toBe('101.00');
    expect(result.body.completedTransactionCount).toBe(3);
    expect(result.body.revenuePreviousUtcMonth).toBe('100.00');
    expect(result.body.revenueThisUtcMonth).toBe('1.00');
    expect(result.body.revenueDeclineOpportunities).toBe(1);
    const other = await get('/intelligence/summary', otherToken).expect(200);
    expect(other.body.customers).toBe(1);
    expect(other.body.customerReturnOpportunities).toBe(1);
  });

  it('traverses every eligible opportunity with a valid advancing cursor', async () => {
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await get('/intelligence/opportunities')
        .query({ type: 'CUSTOMER_RETURN', ...(cursor ? { cursor } : {}) }).expect(200);
      for (const item of page.body.items) {
        expect(seen.has(item.customerId)).toBe(false);
        seen.add(item.customerId);
      }
      if (!page.body.hasMore) {
        expect(page.body.nextCursor).toBeNull();
        break;
      }
      expect(typeof page.body.nextCursor).toBe('string');
      expect(cursors.has(page.body.nextCursor)).toBe(false);
      cursors.add(page.body.nextCursor);
      cursor = page.body.nextCursor;
    } while (cursors.size < 30);
    expect(seen).toEqual(eligibleIds);
    expect(seen.has(customerIds[5200]!)).toBe(true);
    const summary = await get('/intelligence/summary').expect(200);
    expect(summary.body.customerReturnOpportunities).toBe(201);
    expect(summary.body.totalRevenue).toBe('101.00');
  });

  it('traverses all ranked segments and preserves equal-key ID order', async () => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await get('/intelligence/segments')
        .query({ status: 'INACTIVE', ...(cursor ? { cursor } : {}) }).expect(200);
      for (const item of page.body.items) {
        expect(seen.has(item.customerId)).toBe(false);
        seen.add(item.customerId);
        ordered.push(item.customerId);
      }
      if (!page.body.hasMore) {
        expect(page.body.nextCursor).toBeNull();
        break;
      }
      expect(typeof page.body.nextCursor).toBe('string');
      expect(cursors.has(page.body.nextCursor)).toBe(false);
      cursors.add(page.body.nextCursor);
      cursor = page.body.nextCursor;
    } while (cursors.size < 30);
    expect(seen).toEqual(eligibleIds);
    expect(ordered).toEqual([...eligibleIds].sort().reverse());
    const firstNew = await get('/intelligence/segments').query({ status: 'NEW' }).expect(200);
    expect(firstNew.body.items).toHaveLength(200);
    expect(firstNew.body.hasMore).toBe(true);
    expect(typeof firstNew.body.nextCursor).toBe('string');
  });

  it('traverses the unfiltered ranked contracts without dropping or repeating an item', async () => {
    for (const [route, expectedCount] of [
      ['/intelligence/segments', 5201],
      ['/intelligence/opportunities', 202],
    ] as const) {
      const keys = new Set<string>();
      const statuses: string[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await get(route).query(cursor ? { cursor } : {}).expect(200);
        for (const item of page.body.items) {
          const key = route.endsWith('segments')
            ? item.customerId as string
            : `${item.customerId}:${item.type}`;
          expect(keys.has(key)).toBe(false);
          keys.add(key);
          if (route.endsWith('segments')) statuses.push(item.status);
        }
        if (!page.body.hasMore) {
          expect(page.body.nextCursor).toBeNull();
          break;
        }
        expect(typeof page.body.nextCursor).toBe('string');
        expect(cursors.has(page.body.nextCursor)).toBe(false);
        cursors.add(page.body.nextCursor);
        cursor = page.body.nextCursor;
      } while (cursors.size < 40);
      expect(keys.size).toBe(expectedCount);
      if (route.endsWith('segments')) {
        expect(keys).toEqual(new Set(customerIds));
        expect(statuses).toEqual([
          ...Array(1000).fill('RETURNING'),
          ...Array(201).fill('INACTIVE'),
          ...Array(4000).fill('NEW'),
        ]);
      }
      else expect(keys).toEqual(new Set([
        ...[...eligibleIds].map((id) => `${id}:CUSTOMER_RETURN`),
        `${customerIds[5200]}:REVENUE_DECLINE`,
      ]));
    }
  });

  it('accepts the prior cursor shape without changing the next page', async () => {
    const encode = (parts: string[]) => Buffer.from(parts.join('\n')).toString('base64url');
    for (const [route, query, legacyLength] of [
      ['/intelligence/segments', { status: 'INACTIVE' }, 2],
      ['/intelligence/opportunities', { type: 'CUSTOMER_RETURN' }, 3],
    ] as const) {
      const first = await get(route).query(query).expect(200);
      expect(first.body.hasMore).toBe(true);
      const parts = Buffer.from(first.body.nextCursor, 'base64url').toString('utf8').split('\n');
      const oldCursor = encode(parts.slice(-legacyLength));
      const modern = await get(route).query({ ...query, cursor: first.body.nextCursor }).expect(200);
      const legacy = await get(route).query({ ...query, cursor: oldCursor }).expect(200);
      expect(legacy.body.items).toEqual(modern.body.items);
      expect(legacy.body.hasMore).toBe(modern.body.hasMore);
    }
  });

  it('handles empty, exact-page, filtered revenue and cross-tenant contracts', async () => {
    const emptySummary = await get('/intelligence/summary', emptyToken).expect(200);
    expect(emptySummary.body.customers).toBe(0);
    expect(emptySummary.body.totalRevenue).toBe('0.00');
    for (const route of ['/intelligence/opportunities', '/intelligence/segments']) {
      const empty = await get(route, emptyToken).expect(200);
      expect(empty.body).toEqual({ items: [], hasMore: false, nextCursor: null });
    }
    const exact = await get('/intelligence/opportunities', exactToken)
      .query({ type: 'CUSTOMER_RETURN' }).expect(200);
    expect(exact.body.items).toHaveLength(200);
    expect(exact.body.hasMore).toBe(false);
    expect(exact.body.nextCursor).toBeNull();
    const overflowFirst = await get('/intelligence/opportunities', exactToken).expect(200);
    expect(overflowFirst.body.items).toHaveLength(200);
    expect(overflowFirst.body.hasMore).toBe(true);
    expect(overflowFirst.body.items.at(-1)).toMatchObject({
      customerId: exactDualId, type: 'REVENUE_DECLINE',
    });
    const overflowLast = await get('/intelligence/opportunities', exactToken)
      .query({ cursor: overflowFirst.body.nextCursor }).expect(200);
    expect(overflowLast.body.items).toEqual([expect.objectContaining({
      customerId: exactDualId, type: 'CUSTOMER_RETURN',
    })]);
    expect(overflowLast.body.hasMore).toBe(false);
    expect(overflowLast.body.nextCursor).toBeNull();
    const revenue = await get('/intelligence/opportunities')
      .query({ type: 'REVENUE_DECLINE' }).expect(200);
    expect(revenue.body.items.map((item: { customerId: string }) => item.customerId))
      .toEqual([customerIds[5200]]);
    expect(revenue.body.hasMore).toBe(false);
    const other = await get('/intelligence/opportunities', otherToken).expect(200);
    expect(other.body.items).toHaveLength(1);
    expect(other.body.items[0].customerId).not.toBe(customerIds[5200]);
  });

  it('rejects malformed cursor components and filter-context mismatches', async () => {
    const encode = (parts: string[]) => Buffer.from(parts.join('\n')).toString('base64url');
    const opportunity = await get('/intelligence/opportunities')
      .query({ type: 'CUSTOMER_RETURN' }).expect(200);
    const segment = await get('/intelligence/segments').query({ status: 'INACTIVE' }).expect(200);
    for (const [route, query] of [
      ['/intelligence/opportunities', { type: 'REACTIVATION', cursor: opportunity.body.nextCursor }],
      ['/intelligence/opportunities', { cursor: encode(['bad-days', randomUUID(), 'CUSTOMER_RETURN']) }],
      ['/intelligence/opportunities', { cursor: encode(['12', 'bad-uuid', 'CUSTOMER_RETURN']) }],
      ['/intelligence/opportunities', { cursor: encode(['2026-99-99T00:00:00Z', 'ALL', '12', randomUUID(), 'CUSTOMER_RETURN']) }],
      ['/intelligence/opportunities', { cursor: encode(['12', randomUUID(), 'BAD_TYPE']) }],
      ['/intelligence/segments', { status: 'NEW', cursor: segment.body.nextCursor }],
      ['/intelligence/segments', { cursor: encode(['NaN', randomUUID()]) }],
    ] as const) {
      const response = await get(route).query(query).expect(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
  });
});

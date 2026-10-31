import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { comparableJalaliMonthWindows } from '@salon/shared';
import request from 'supertest';
import { REVENUE_DROP_PAGE_LIMIT } from '../src/intelligence/list-revenue-drops.use-case';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { createProductOwnerSession } from './support/phone-account';

const EXPECTED_DATABASE = 'salon_metric_final_gate20261031';
const EXPECTED_COMMENT = 'metric-final-disposable:gate20261031';
const REFUSED_SYSTEM_IDS = new Set(['7700113693112733735', '7683163620851879970']);

const pointedAtOracle = (() => {
  try {
    const parsed = new URL(process.env.DATABASE_URL ?? '');
    return parsed.hostname === '127.0.0.1' && parsed.port === '55931'
      && decodeURIComponent(parsed.pathname.replace(/^\//, '')) === EXPECTED_DATABASE;
  } catch {
    return false;
  }
})();

const describeIfOracle = pointedAtOracle ? describe : describe.skip;

async function walkFollowUps(
  http: ReturnType<INestApplication['getHttpServer']>,
  token: string,
  path: string,
): Promise<{ ids: string[]; openCount: number }> {
  const ids: string[] = [];
  let cursor: string | undefined;
  let openCount = 0;
  for (let page = 0; page < 20; page += 1) {
    const response = await request(http)
      .get(path)
      .query({ limit: 2, ...(cursor ? { cursor } : {}) })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    openCount = response.body.openCount as number;
    const items = response.body.items as Array<{ id: string }>;
    ids.push(...items.map((item) => item.id));
    if (!response.body.hasMore) break;
    cursor = response.body.nextCursor as string;
  }
  return { ids, openCount };
}

describeIfOracle('operational agreed-return count on the disposable oracle', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const rows = await prisma.client.$queryRaw<Array<{ name: string; systemId: string; comment: string | null }>>`
      SELECT current_database() AS name,
             (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemId",
             (SELECT description FROM pg_catalog.pg_shdescription
                JOIN pg_catalog.pg_database ON objoid = pg_database.oid
               WHERE datname = current_database()) AS comment
    `;
    const row = rows[0];
    if (!row || row.name !== EXPECTED_DATABASE || row.comment !== EXPECTED_COMMENT || REFUSED_SYSTEM_IDS.has(row.systemId)) {
      throw new Error('Refusing agreed-return tests outside the disposable oracle database');
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts separate open intentions and commitments and reconciles follow-up pages', async () => {
    const owner = await createProductOwnerSession(prisma.client, app.getHttpServer(), { salonName: 'Agreed' });
    const other = await createProductOwnerSession(prisma.client, app.getHttpServer(), { salonName: 'Agreed other' });
    const now = new Date();
    const admin = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: admin,
        phone: `0918${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
        passwordHash: 'not-a-login',
        name: 'Admin',
        updatedAt: now,
      },
    });
    const http = app.getHttpServer();
    const customers = [];
    for (let index = 0; index < 4; index += 1) {
      const created = await request(http)
        .post('/customers')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          firstName: 'Neda',
          lastName: `Row${index}`,
          phoneNumber: `0919${String(1000000 + index).padStart(7, '0')}`.slice(0, 11),
        })
        .expect(201);
      customers.push(created.body.id as string);
    }
    const otherCustomer = (await request(http)
      .post('/customers')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ firstName: 'Other', lastName: 'One', phoneNumber: '09190000099' })
      .expect(201)).body.id as string;

    async function message(salonId: string, userId: string, customerId: string, day: number) {
      const requestId = randomUUID();
      const deliveryId = randomUUID();
      const submittedAt = new Date(`2026-03-0${day}T10:00:00.000Z`);
      await prisma.client.messageRequest.create({
        data: {
          id: requestId,
          salonId,
          customerId,
          createdByUserId: userId,
          recipientPhoneNumber: `0919${String(2000000 + day).padStart(7, '0')}`,
          messageText: 'fixture',
          messageBusinessDate: new Date(Date.UTC(2026, 2, day)),
          countsTowardDailyLimit: false,
          status: 'SENT',
          requestedAt: submittedAt,
          updatedAt: now,
        },
      });
      await prisma.client.messageDelivery.create({
        data: {
          id: deliveryId,
          salonId,
          messageRequestId: requestId,
          customerId,
          mode: 'MANUAL',
          channel: 'TEXT',
          status: 'SENT',
          providerRequestId: requestId,
          attempts: 1,
          createdBy: userId,
          submittedAt,
          updatedAt: now,
        },
      });
      return { requestId, deliveryId, submittedAt };
    }

    const openSalon = await message(owner.salonId, owner.userId, customers[0]!, 1);
    const openAdmin = await message(owner.salonId, owner.userId, customers[0]!, 2);
    const fulfilled = await message(owner.salonId, owner.userId, customers[1]!, 3);
    const settled = await message(owner.salonId, owner.userId, customers[2]!, 4);
    const visit = (await request(http)
      .post('/visits')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customers[1], visitedAt: '2026-03-05T10:00:00.000Z' })
      .expect(201)).body.id as string;
    const settleVisit = (await request(http)
      .post('/visits')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ customerId: customers[2], visitedAt: '2026-03-06T10:00:00.000Z' })
      .expect(201)).body.id as string;
    await prisma.client.returnCommitment.createMany({
      data: [
        {
          id: randomUUID(), salonId: owner.salonId, customerId: customers[0]!,
          sourceMessageRequestId: openSalon.requestId, sourceMessageDeliveryId: openSalon.deliveryId,
          expectedAt: new Date('2026-03-08T10:00:00.000Z'),
          createdByUserId: owner.userId, updatedByUserId: owner.userId, updatedAt: now,
        },
        {
          id: randomUUID(), salonId: owner.salonId, customerId: customers[0]!,
          sourceMessageRequestId: openAdmin.requestId, sourceMessageDeliveryId: openAdmin.deliveryId,
          expectedAt: new Date('2026-03-09T10:00:00.000Z'),
          createdByPlatformAdminId: admin, updatedByPlatformAdminId: admin, updatedAt: now,
        },
        {
          id: randomUUID(), salonId: owner.salonId, customerId: customers[1]!,
          sourceMessageRequestId: fulfilled.requestId, sourceMessageDeliveryId: fulfilled.deliveryId,
          expectedAt: new Date('2026-03-04T10:00:00.000Z'), actualVisitId: visit,
          createdByUserId: owner.userId, updatedByUserId: owner.userId, updatedAt: now,
        },
        {
          id: randomUUID(), salonId: owner.salonId, customerId: customers[2]!,
          sourceMessageRequestId: settled.requestId, sourceMessageDeliveryId: settled.deliveryId,
          expectedAt: new Date('2026-03-04T10:00:00.000Z'),
          createdByUserId: owner.userId, updatedByUserId: owner.userId, updatedAt: now,
        },
      ],
    });

    const listId = randomUUID();
    const vipRequestId = randomUUID();
    await prisma.client.vipTargetList.create({
      data: { id: listId, name: 'Agreed VIP', status: 'ACTIVE', contactCount: 30, createdByAdminId: admin, updatedAt: now },
    });
    await prisma.client.vipRequest.create({
      data: {
        id: vipRequestId, salonId: owner.salonId, listId, createdByUserId: owner.userId,
        requestedCount: 30, geographicRange: 'fixture', status: 'SUBMITTED',
        reservedUntil: now, submittedAt: now, updatedAt: now,
      },
    });
    const intentionIds = {
      unknown: randomUUID(),
      date: randomUUID(),
      instant: randomUUID(),
      linked: randomUUID(),
      vipUnknown: randomUUID(),
      vipDate: randomUUID(),
    };
    await prisma.client.visitIntention.createMany({
      data: [
        {
          id: intentionIds.unknown, salonId: owner.salonId, subject: 'CUSTOMER', customerId: customers[3]!,
          timePrecision: 'UNKNOWN', reportChannel: 'SALON_STAFF', contactBasis: 'WITHHELD',
          createdByUserId: owner.userId, updatedByUserId: owner.userId, updatedAt: now,
        },
        {
          id: intentionIds.date, salonId: owner.salonId, subject: 'CUSTOMER', customerId: customers[1]!,
          timePrecision: 'DATE', agreedDate: new Date('2026-11-02T00:00:00.000Z'),
          reportChannel: 'TOLD_PLATFORM_ADMIN', contactBasis: 'WITHHELD',
          createdByPlatformAdminId: admin, updatedByPlatformAdminId: admin, updatedAt: now,
        },
        {
          id: intentionIds.instant, salonId: owner.salonId, subject: 'VIP_PROSPECT', vipRequestId,
          timePrecision: 'INSTANT', agreedInstant: new Date('2026-11-03T09:30:00.000Z'),
          reportChannel: 'INBOUND_TO_SALON', contactBasis: 'WITHHELD',
          createdByUserId: owner.userId, updatedByUserId: owner.userId, updatedAt: now,
        },
        {
          id: intentionIds.linked, salonId: owner.salonId, subject: 'CUSTOMER', customerId: customers[2]!,
          timePrecision: 'INSTANT', agreedInstant: now, reportChannel: 'SALON_STAFF', contactBasis: 'WITHHELD',
          linkedVisitId: settleVisit, linkedCustomerId: customers[2],
          createdByUserId: owner.userId, updatedByUserId: owner.userId, updatedAt: now,
        },
        {
          id: intentionIds.vipUnknown, salonId: owner.salonId, subject: 'VIP_PROSPECT', vipRequestId,
          timePrecision: 'UNKNOWN', reportChannel: 'INBOUND_TO_SALON', contactBasis: 'WITHHELD',
          createdByUserId: owner.userId, updatedByUserId: owner.userId, updatedAt: now,
        },
        {
          id: intentionIds.vipDate, salonId: other.salonId, subject: 'CUSTOMER', customerId: otherCustomer,
          timePrecision: 'DATE', agreedDate: new Date('2026-11-04T00:00:00.000Z'),
          reportChannel: 'SALON_STAFF', contactBasis: 'WITHHELD',
          createdByUserId: other.userId, updatedByUserId: other.userId, updatedAt: now,
        },
      ],
    });

    const historicalCommitments = 4;
    const openCommitments = 2;
    const openIntentions = 4;
    const operational = openCommitments + openIntentions;
    expect(new Set([historicalCommitments, openCommitments, operational]).size).toBe(3);

    const before = await request(http)
      .get('/salon/overall-performance')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(before.body.agreedReturnCount).toBe(operational);
    expect(before.body.agreedReturnCount).not.toBe(historicalCommitments);
    expect(before.body.agreedReturnCount).not.toBe(openCommitments);
    const customerPages = await walkFollowUps(http, owner.accessToken, '/follow-ups/customers');
    const vipPages = await walkFollowUps(http, owner.accessToken, '/follow-ups/vip');
    expect(new Set(customerPages.ids).size).toBe(customerPages.ids.length);
    expect(new Set(vipPages.ids).size).toBe(vipPages.ids.length);
    expect(customerPages.openCount + vipPages.openCount).toBe(before.body.agreedReturnCount);
    expect(customerPages.ids).toEqual(expect.arrayContaining([intentionIds.unknown, intentionIds.date]));
    expect(customerPages.ids).not.toContain(intentionIds.linked);
    expect(vipPages.ids).toEqual(expect.arrayContaining([intentionIds.instant, intentionIds.vipUnknown]));
    expect(vipPages.ids).not.toContain(intentionIds.vipDate);

    const arriveKey = randomUUID();
    const arrived = await request(http)
      .post(`/visit-intentions/${intentionIds.unknown}/arrive`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('Idempotency-Key', arriveKey)
      .send({ visitedAt: '2026-10-15T08:00:00.000Z' })
      .expect(201);
    const afterArrive = await request(http)
      .get('/salon/overall-performance')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(afterArrive.body.agreedReturnCount).toBe(5);
    await request(http)
      .post(`/visit-intentions/${intentionIds.unknown}/arrive`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('Idempotency-Key', arriveKey)
      .send({ visitedAt: '2026-10-15T08:00:00.000Z' })
      .expect(201);
    const afterReplay = await request(http)
      .get('/salon/overall-performance')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(afterReplay.body.agreedReturnCount).toBe(5);
    expect(arrived.body.id).toBe(intentionIds.unknown);

    const isolated = await request(http)
      .get('/salon/overall-performance')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(200);
    expect(isolated.body.agreedReturnCount).toBe(1);
  });

  it('pages revenue drops with a fixed asOf and no duplicate customers', async () => {
    const owner = await createProductOwnerSession(prisma.client, app.getHttpServer(), { salonName: 'Drops' });
    const windows = comparableJalaliMonthWindows(new Date());
    const previousAt = new Date(windows.previousStart.getTime() + 3_600_000);
    const qualifying = REVENUE_DROP_PAGE_LIMIT * 5 + 1;
    const serviceId = randomUUID();
    await prisma.client.service.create({
      data: { id: serviceId, salonId: owner.salonId, name: 'Cut', updatedAt: new Date() },
    });
    await prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO customers (id, salon_id, first_name, last_name, phone_number, created_at, updated_at)
        SELECT gen_random_uuid(), $1::uuid, 'Drop', i::text,
               '092' || lpad(i::text, 8, '0'),
               NOW(), NOW()
        FROM generate_series(1, ${qualifying}) AS i
      `, owner.salonId);
      await tx.$executeRawUnsafe(`
        INSERT INTO transactions (
          id, salon_id, customer_id, occurred_at, amount, currency, status, created_at, updated_at
        )
        SELECT gen_random_uuid(), c.salon_id, c.id, $2, (1000 + row_number() OVER (ORDER BY c.id))::numeric(19,2),
               'IRR', 'COMPLETED', NOW(), NOW()
        FROM customers c
        WHERE c.salon_id = $1::uuid
      `, owner.salonId, previousAt);
      await tx.$executeRawUnsafe(`
        INSERT INTO transaction_items (id, salon_id, transaction_id, service_id, quantity, unit_price, total_amount)
        SELECT gen_random_uuid(), t.salon_id, t.id, $2::uuid, 1, t.amount, t.amount
        FROM transactions t
        WHERE t.salon_id = $1::uuid
      `, owner.salonId, serviceId);
    }, { timeout: 60_000 });

    const http = app.getHttpServer();
    const seen = new Set<string>();
    let cursor: string | undefined;
    let asOf = '';
    let pages = 0;
    do {
      const response = await request(http)
        .get('/intelligence/revenue-drops')
        .query(cursor ? { cursor } : {})
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      pages += 1;
      if (!asOf) asOf = response.body.asOf as string;
      expect(response.body.asOf).toBe(asOf);
      const ids = (response.body.items as Array<{ customerId: string }>).map((item) => item.customerId);
      for (const id of ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      cursor = response.body.hasMore ? response.body.nextCursor as string : undefined;
    } while (cursor);
    expect(pages).toBeGreaterThanOrEqual(5);
    expect(seen.size).toBe(qualifying);
  });
});

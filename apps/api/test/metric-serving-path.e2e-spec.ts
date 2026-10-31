import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { comparableJalaliMonthWindows } from '@salon/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { createProductOwnerSession } from './support/phone-account';

const EXPECTED_DATABASE = 'salon_metric_final_gate20261031';
const EXPECTED_COMMENT = 'metric-final-disposable:gate20261031';
const REFUSED_SYSTEM_IDS = new Set(['7700113693112733735', '7683163620851879970']);

const databaseUrl = process.env.DATABASE_URL ?? '';
const pointedAtOracle = (() => {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname === '127.0.0.1'
      && parsed.port === '55931'
      && decodeURIComponent(parsed.pathname.replace(/^\//, '')) === EXPECTED_DATABASE;
  } catch {
    return false;
  }
})();

const describeIfOracle = pointedAtOracle ? describe : describe.skip;

describeIfOracle('metric serving path on the disposable oracle database', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
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
      throw new Error('Refusing metric serving-path tests outside the disposable oracle database');
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves approved message quantities and exact monthly revenue over HTTP', async () => {
    const owner = await createProductOwnerSession(prisma.client, app.getHttpServer(), { salonName: 'Metric HTTP' });
    const now = new Date();
    const windows = comparableJalaliMonthWindows(now);
    const inMonth = new Date(windows.currentStart.getTime() + 3_600_000);
    const customer = randomUUID();
    const service = randomUUID();
    await prisma.client.customer.create({
      data: {
        id: customer,
        salonId: owner.salonId,
        firstName: 'Sara',
        lastName: 'HTTP',
        phoneNumber: `0912${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
        updatedAt: now,
      },
    });
    await prisma.client.service.create({
      data: { id: service, salonId: owner.salonId, name: 'Cut', updatedAt: now },
    });
    const amounts = [
      { amount: '1500.50', status: 'COMPLETED' as const },
      { amount: '999.99', status: 'VOIDED' as const },
      { amount: '0.01', status: 'COMPLETED' as const },
      { amount: '12345678901234567.89', status: 'COMPLETED' as const },
    ];
    await prisma.client.$transaction(async (tx) => {
      for (const [index, row] of amounts.entries()) {
        const id = randomUUID();
        await tx.ledgerTransaction.create({
          data: {
            id,
            salonId: owner.salonId,
            customerId: customer,
            occurredAt: inMonth,
            amount: row.amount,
            status: row.status,
            updatedAt: now,
          },
        });
        await tx.transactionItem.create({
          data: {
            id: randomUUID(),
            salonId: owner.salonId,
            transactionId: id,
            serviceId: service,
            quantity: 1,
            unitPrice: row.amount,
            totalAmount: row.amount,
          },
        });
        void index;
      }
    });

    const ordinary = [
      { status: 'SENT' as const, sent: true },
      { status: 'SENT' as const, sent: true },
      { status: 'QUEUED' as const, sent: false },
      { status: 'CANCELLED' as const, sent: false },
      { status: 'SENT' as const, sent: true },
    ];
    for (const [index, row] of ordinary.entries()) {
      const requestId = randomUUID();
      await prisma.client.messageRequest.create({
        data: {
          id: requestId,
          salonId: owner.salonId,
          customerId: customer,
          createdByUserId: owner.userId,
          recipientPhoneNumber: `0912${String(1000000 + index)}`,
          messageText: 'fixture',
          messageBusinessDate: new Date(Date.UTC(2026, 9, index + 1)),
          countsTowardDailyLimit: true,
          status: row.status,
          requestedAt: now,
          updatedAt: now,
        },
      });
      if (row.sent) {
        await prisma.client.messageDelivery.create({
          data: {
            id: randomUUID(),
            salonId: owner.salonId,
            messageRequestId: requestId,
            customerId: customer,
            mode: 'MANUAL',
            channel: 'TEXT',
            status: 'SENT',
            providerRequestId: requestId,
            attempts: index === 0 ? 3 : 1,
            createdBy: owner.userId,
            submittedAt: now,
            updatedAt: now,
          },
        });
      }
    }

    const admin = randomUUID();
    await prisma.client.platformAdmin.create({
      data: { id: admin, phone: `0913${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`, passwordHash: 'not-a-login', name: 'Admin', updatedAt: now },
    });
    const vipFacts = [
      { status: 'AWAITING_SAMPLE_WORK' as const, count: 30 },
      { status: 'SUBMITTED' as const, count: 50 },
      { status: 'BALE_NOT_IMPLEMENTED' as const, count: 30 },
      { status: 'MANUAL_QUEUED' as const, count: 50 },
      { status: 'CANCELLED' as const, count: 30 },
    ];
    let manualId = '';
    for (const fact of vipFacts) {
      const listId = randomUUID();
      const requestId = randomUUID();
      if (fact.status === 'MANUAL_QUEUED') manualId = requestId;
      await prisma.client.vipTargetList.create({
        data: {
          id: listId,
          name: `HTTP ${fact.status}`,
          status: fact.status === 'AWAITING_SAMPLE_WORK' ? 'IN_USE' : 'ACTIVE',
          contactCount: fact.count,
          createdByAdminId: admin,
          reservedBySalonId: fact.status === 'AWAITING_SAMPLE_WORK' ? owner.salonId : null,
          reservedAt: fact.status === 'AWAITING_SAMPLE_WORK' ? now : null,
          updatedAt: now,
        },
      });
      await prisma.client.vipRequest.create({
        data: {
          id: requestId,
          salonId: owner.salonId,
          listId,
          createdByUserId: owner.userId,
          requestedCount: fact.count,
          geographicRange: 'fixture',
          status: fact.status,
          reservedUntil: fact.status === 'AWAITING_SAMPLE_WORK'
            ? new Date(now.getTime() + 86_400_000)
            : new Date(now.getTime() - 86_400_000),
          submittedAt: fact.status === 'AWAITING_SAMPLE_WORK' || fact.status === 'CANCELLED' ? null : now,
          cancelledAt: fact.status === 'CANCELLED' ? now : null,
          updatedAt: now,
        },
      });
    }
    for (let index = 0; index < 10; index += 1) {
      const requestId = randomUUID();
      await prisma.client.messageRequest.create({
        data: {
          id: requestId,
          salonId: owner.salonId,
          createdByUserId: owner.userId,
          vipRequestId: manualId,
          recipientPhoneNumber: `0914${String(index).padStart(7, '0')}`,
          messageText: 'fixture',
          messageBusinessDate: new Date('2026-10-05T00:00:00.000Z'),
          countsTowardDailyLimit: false,
          status: 'SENT',
          requestedAt: now,
          updatedAt: now,
        },
      });
      await prisma.client.messageDelivery.create({
        data: {
          id: randomUUID(),
          salonId: owner.salonId,
          messageRequestId: requestId,
          mode: 'MANUAL',
          channel: 'TEXT',
          status: 'SENT',
          providerRequestId: requestId,
          attempts: index === 0 ? 3 : 1,
          createdBy: owner.userId,
          submittedAt: now,
          updatedAt: now,
        },
      });
    }

    const response = await request(app.getHttpServer())
      .get('/salon/overall-performance')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(response.body.salonCustomerSentMessageCount).toBe(3);
    expect(response.body.salonCustomerMessageRequestCount).toBe(5);
    expect(response.body.vipSentMessageCount).toBe(10);
    expect(response.body.vipMessageRequestCount).toBe(130);
    expect(response.body.monthlyRecordedRevenueIrr).toBe('12345678901236068.40');
    expect(response.text).toContain('"monthlyRecordedRevenueIrr":"12345678901236068.40"');
  });

  it('does not cancel another salon draft from VIP reads and reclaims one expired list', async () => {
    const holder = await createProductOwnerSession(prisma.client, app.getHttpServer(), { salonName: 'Holder' });
    const reader = await createProductOwnerSession(prisma.client, app.getHttpServer(), { salonName: 'Reader' });
    const now = new Date();
    const admin = randomUUID();
    await prisma.client.platformAdmin.create({
      data: { id: admin, phone: `0915${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`, passwordHash: 'not-a-login', name: 'Admin', updatedAt: now },
    });
    for (const salonId of [holder.salonId, reader.salonId]) {
      await prisma.client.vipSalonEntitlement.create({
        data: { id: randomUUID(), salonId, grantedByAdminId: admin, grantedAt: now, updatedAt: now },
      });
    }
    const staleList = randomUUID();
    const freshList = randomUUID();
    for (const listId of [staleList, freshList]) {
      await prisma.client.vipTargetList.create({
        data: {
          id: listId,
          name: listId,
          status: listId === staleList ? 'IN_USE' : 'ACTIVE',
          contactCount: 30,
          regionCode: '01',
          catalogMembership: 'ORIGINAL_TEHRAN',
          createdByAdminId: admin,
          reservedBySalonId: listId === staleList ? holder.salonId : null,
          reservedAt: listId === staleList ? now : null,
          updatedAt: now,
        },
      });
      const phonePrefix = listId === staleList ? '0916' : '0917';
      for (let index = 0; index < 30; index += 1) {
        await prisma.client.vipTargetContact.create({
          data: {
            id: randomUUID(),
            listId,
            sortOrder: index + 1,
            phoneNumber: `${phonePrefix}${String(index).padStart(7, '0')}`,
            createdAt: now,
          },
        });
      }
    }
    const draftId = randomUUID();
    await prisma.client.vipRequest.create({
      data: {
        id: draftId,
        salonId: holder.salonId,
        listId: staleList,
        createdByUserId: holder.userId,
        requestedCount: 30,
        geographicRange: 'stale',
        status: 'AWAITING_SAMPLE_WORK',
        reservedUntil: new Date(now.getTime() - 60_000),
        updatedAt: now,
      },
    });

    await request(app.getHttpServer()).get('/vip/capability').set('Authorization', `Bearer ${reader.accessToken}`).expect(200);
    await request(app.getHttpServer()).get('/vip/regions').set('Authorization', `Bearer ${reader.accessToken}`).expect(200);
    await request(app.getHttpServer()).get('/vip/lists?regionCode=01').set('Authorization', `Bearer ${reader.accessToken}`).expect(200);
    const unchanged = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: draftId } });
    expect(unchanged.status).toBe('AWAITING_SAMPLE_WORK');

    const [left, right] = await Promise.all([
      request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${holder.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ listId: staleList, requestedCount: 30, geographicRange: 'race' }),
      request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${reader.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ listId: staleList, requestedCount: 30, geographicRange: 'race' }),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([201, 409]);
    const storedDraft = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: draftId } });
    const holderWon = left.status === 201;
    expect(storedDraft.status).toBe(holderWon ? 'CANCELLED' : 'AWAITING_SAMPLE_WORK');
    const list = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: staleList } });
    expect(list.status).toBe('IN_USE');
    expect(list.reservedBySalonId).toBe(holderWon ? holder.salonId : reader.salonId);
    const held = await prisma.client.vipRequest.count({
      where: { listId: staleList, status: 'AWAITING_SAMPLE_WORK' },
    });
    expect(held).toBe(holderWon ? 1 : 2);
  });
});

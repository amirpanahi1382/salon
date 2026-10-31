import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { createPlatformAdminSession, createProductOwnerSession } from './support/phone-account';

const EXPECTED_DATABASE = 'salon_metric_final_gate20261031';
const EXPECTED_COMMENT = 'metric-final-disposable:gate20261031';
const REFUSED = new Set(['7700113693112733735']);

const pointed = (() => {
  try {
    const parsed = new URL(process.env.DATABASE_URL ?? '');
    return parsed.hostname === '127.0.0.1' && parsed.port === '55931'
      && decodeURIComponent(parsed.pathname.replace(/^\//, '')) === EXPECTED_DATABASE;
  } catch {
    return false;
  }
})();
const describeIf = pointed ? describe : describe.skip;

describeIf('VIP execution graph on the disposable oracle', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const rows = await prisma.client.$queryRaw<Array<{ comment: string | null; systemId: string }>>`
      SELECT (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemId",
             (SELECT description FROM pg_catalog.pg_shdescription
                JOIN pg_catalog.pg_database ON objoid = pg_database.oid
               WHERE datname = current_database()) AS comment
    `;
    const name = await prisma.client.$queryRaw<Array<{ name: string }>>`
      SELECT current_database() AS name
    `;
    if (
      name[0]?.name !== EXPECTED_DATABASE
      || rows[0]?.comment !== EXPECTED_COMMENT
      || REFUSED.has(rows[0]?.systemId ?? '')
    ) {
      throw new Error('Refusing VIP graph tests outside the fully migrated disposable database');
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('matches dashboard, history, folders, list results, and profile to the fixture', async () => {
    const http = app.getHttpServer();
    const salonA = await createProductOwnerSession(prisma.client, http, { salonName: 'Graph A' });
    const salonB = await createProductOwnerSession(prisma.client, http, { salonName: 'Graph B' });
    const admin = await createPlatformAdminSession(prisma.client, http, { name: 'Graph Admin' });
    const now = new Date();
    const listId = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId, name: 'graph-list', status: 'ACTIVE', contactCount: 5,
        regionCode: '02', catalogMembership: 'ORIGINAL_TEHRAN',
        createdByAdminId: admin.adminId, updatedAt: now,
      },
    });
    const contacts = [];
    for (let index = 0; index < 5; index += 1) {
      const id = randomUUID();
      await prisma.client.vipTargetContact.create({
        data: {
          id, listId, sortOrder: index + 1,
          phoneNumber: `0970000${String(index).padStart(4, '0')}`,
          displayName: `R${index}`, createdAt: now,
        },
      });
      contacts.push(id);
    }
    const filler = 50;
    const detailList = randomUUID();
    const unmaterializedList = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: detailList, name: 'graph-detail', status: 'IN_USE', contactCount: 5,
        regionCode: '02', catalogMembership: 'ORIGINAL_TEHRAN',
        createdByAdminId: admin.adminId, reservedBySalonId: salonB.salonId, reservedAt: now, updatedAt: now,
      },
    });
    await prisma.client.vipTargetContact.updateMany({
      where: { listId },
      data: { listId: detailList },
    });
    await prisma.client.$executeRaw`
      INSERT INTO vip_target_lists (
        id, name, status, contact_count, created_by_admin_id, created_at, updated_at
      )
      SELECT gen_random_uuid(), 'filler-' || i, 'ACTIVE', 30, ${admin.adminId}::uuid,
             ${now}::timestamptz + (i * interval '1 second'),
             ${now}::timestamptz
      FROM generate_series(1, ${filler}) AS i
    `;
    await prisma.client.$executeRaw`
      INSERT INTO vip_requests (
        id, salon_id, list_id, created_by_user_id, requested_count, geographic_range,
        status, reserved_until, submitted_at, created_at, updated_at
      )
      SELECT gen_random_uuid(), ${salonA.salonId}::uuid, l.id, ${salonA.userId}::uuid, 30, 'filler',
             'SUBMITTED', l.created_at, l.created_at, l.created_at, l.created_at
      FROM vip_target_lists l
      WHERE l.created_by_admin_id = ${admin.adminId}::uuid
        AND l.name LIKE 'filler-%'
    `;
    const unmaterialized = randomUUID();
    const partial = randomUUID();
    const cancelled = randomUUID();
    const salonBRequest = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: unmaterializedList, name: 'graph-unmaterialized', status: 'ACTIVE', contactCount: 50,
        createdByAdminId: admin.adminId, updatedAt: now,
      },
    });
    await prisma.client.vipRequest.createMany({
      data: [
        {
          id: unmaterialized, salonId: salonA.salonId, listId: unmaterializedList, createdByUserId: salonA.userId,
          requestedCount: 50, geographicRange: 'before-dispatch', status: 'SUBMITTED',
          reservedUntil: now, submittedAt: now, updatedAt: now,
        },
        {
          id: partial, salonId: salonA.salonId, listId: detailList, createdByUserId: salonA.userId,
          requestedCount: 30, geographicRange: 'partial', status: 'MANUAL_QUEUED',
          reservedUntil: now, submittedAt: now, updatedAt: now,
        },
        {
          id: cancelled, salonId: salonA.salonId, listId: detailList, createdByUserId: salonA.userId,
          requestedCount: 30, geographicRange: 'cancelled-draft', status: 'CANCELLED',
          reservedUntil: now, cancelledAt: now, updatedAt: now,
        },
        {
          id: salonBRequest, salonId: salonB.salonId, listId: detailList, createdByUserId: salonB.userId,
          requestedCount: 30, geographicRange: 'bale', status: 'BALE_NOT_IMPLEMENTED',
          reservedUntil: now, submittedAt: now, updatedAt: now,
        },
      ],
    });

    const phones = ['09710000001', '09710000002', '09710000003', '09710000004', '09710000005'];
    const recipientIds = phones.map(() => randomUUID());
    for (let index = 0; index < phones.length; index += 1) {
      await prisma.client.vipRequestRecipient.create({
        data: {
          id: recipientIds[index], vipRequestId: partial, salonId: salonA.salonId,
          sortOrder: index + 1, sourceContactId: contacts[index]!,
          phoneNumber: phones[index]!, messageText: 'fixture', createdAt: now,
        },
      });
    }
    async function vipMessage(index: number, status: 'SENT' | 'FAILED' | 'CANCELLED' | 'QUEUED', sent: boolean) {
      const id = randomUUID();
      await prisma.client.messageRequest.create({
        data: {
          id, salonId: salonA.salonId, createdByUserId: salonA.userId, vipRequestId: partial,
          recipientPhoneNumber: phones[index]!, messageText: 'fixture',
          messageBusinessDate: new Date(Date.UTC(2026, 3, index + 1)),
          countsTowardDailyLimit: false, status, requestedAt: now, updatedAt: now,
        },
      });
      await prisma.client.vipRequestRecipient.update({
        where: { id: recipientIds[index] },
        data: { messageRequestId: id },
      });
      if (sent || status === 'FAILED') {
        await prisma.client.messageDelivery.create({
          data: {
            id: randomUUID(), salonId: salonA.salonId, messageRequestId: id,
            mode: 'MANUAL', channel: 'TEXT', status: sent ? 'SENT' : 'FAILED',
            providerRequestId: id, attempts: sent ? 3 : 1, createdBy: salonA.userId,
            submittedAt: sent ? now : null, failedAt: sent ? null : now, updatedAt: now,
          },
        });
      }
      return id;
    }
    await vipMessage(0, 'SENT', true);
    await vipMessage(1, 'FAILED', false);
    await vipMessage(2, 'CANCELLED', false);
    await vipMessage(3, 'QUEUED', false);
    await prisma.client.messageGlobalStopOutcome.create({
      data: {
        id: randomUUID(), salonId: salonA.salonId, phoneNumber: phones[4]!,
        reasonCode: 'RECIPIENT_REQUEST', vipRequestRecipientId: recipientIds[4], createdAt: now,
      },
    });
    const bareRecipient = randomUUID();
    await prisma.client.vipRequestRecipient.create({
      data: {
        id: bareRecipient, vipRequestId: salonBRequest, salonId: salonB.salonId,
        sortOrder: 1, sourceContactId: contacts[0]!, phoneNumber: '09720000001',
        messageText: 'fixture', createdAt: now,
      },
    });

    const customer = (await request(http).post('/customers').set('Authorization', `Bearer ${salonA.accessToken}`)
      .send({ firstName: 'Graph', lastName: 'One', phoneNumber: '09730000001' }).expect(201)).body.id as string;
    const visit = (await request(http).post('/visits').set('Authorization', `Bearer ${salonA.accessToken}`)
      .send({ customerId: customer, visitedAt: '2026-10-01T08:00:00.000Z' }).expect(201)).body.id as string;
    await prisma.client.visitIntention.createMany({
      data: [
        {
          id: randomUUID(), salonId: salonA.salonId, subject: 'CUSTOMER', customerId: customer,
          timePrecision: 'UNKNOWN', reportChannel: 'TOLD_PLATFORM_ADMIN', contactBasis: 'WITHHELD',
          createdByPlatformAdminId: admin.adminId, updatedByPlatformAdminId: admin.adminId, updatedAt: now,
        },
        {
          id: randomUUID(), salonId: salonA.salonId, subject: 'CUSTOMER', customerId: customer,
          timePrecision: 'INSTANT', agreedInstant: now, reportChannel: 'SALON_STAFF', contactBasis: 'WITHHELD',
          linkedVisitId: visit, linkedCustomerId: customer,
          createdByUserId: salonA.userId, updatedByUserId: salonA.userId, updatedAt: now,
        },
      ],
    });

    const performance = await request(http).get('/salon/overall-performance')
      .set('Authorization', `Bearer ${salonA.accessToken}`).expect(200);
    expect(performance.body.vipMessageRequestCount).toBe(filler * 30 + 50 + 30);
    expect(performance.body.vipSentMessageCount).toBe(1);
    expect(performance.body.agreedReturnCount).toBe(1);

    const historyIds: string[] = [];
    const historyTimes: string[] = [];
    let cursor: string | undefined;
    let unavailable = 0;
    let sentSum = 0;
    let requestedSum = 0;
    let pageNumber = 0;
    do {
      const page = await request(http).get('/vip/requests').query(cursor ? { cursor } : {})
        .set('Authorization', `Bearer ${salonA.accessToken}`).expect(200);
      pageNumber += 1;
      const items = page.body.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(50);
      if (pageNumber === 1) expect(items.length).toBe(50);
      for (const item of items) {
        historyIds.push(item.id as string);
        historyTimes.push(item.createdAt as string);
        sentSum += item.recordedSendCount as number;
        requestedSum += item.requestedCount as number;
        if (item.metricsAvailability === 'UNAVAILABLE') {
          unavailable += 1;
          expect(item.recipientDenominator).toBeNull();
        }
      }
      cursor = page.body.hasMore ? page.body.nextCursor as string : undefined;
    } while (cursor);
    expect(pageNumber).toBe(2);
    expect(new Set(historyIds).size).toBe(historyIds.length);
    expect(historyIds.length).toBe(filler + 3);
    for (let index = 1; index < historyTimes.length; index += 1) {
      expect(historyTimes[index - 1]! >= historyTimes[index]!).toBe(true);
    }
    expect(unavailable).toBe(1);
    expect(sentSum).toBe(1);
    expect(requestedSum).toBe(filler * 30 + 50 + 30 + 30);

    const profile = await request(http).get(`/admin/vip/salons/${salonA.salonId}/profile`)
      .set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    expect(profile.body.counts).toMatchObject({
      distinctVipListsRequested: filler + 2,
      vipRequestCount: filler + 3,
      vipOpenRequestCount: filler + 2,
      vipRecordedSendCount: 1,
      ordinaryMessageRequestCount: 0,
      ordinaryRecordedSendCount: 0,
    });

    const results = await request(http).get(`/admin/vip/lists/${detailList}/salon-results`)
      .set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    const bySalon = new Map((results.body.items as Array<Record<string, unknown>>).map((item) => [item.salonId, item]));
    expect(bySalon.get(salonA.salonId)).toMatchObject({
      requestCount: 2,
      sentMessageCount: 1,
      failedMessageCount: 1,
      cancelledMessageCount: 1,
      globallyStoppedMessageCount: 1,
    });
    expect(bySalon.get(salonB.salonId)).toMatchObject({
      requestCount: 1,
      recipientCount: 1,
      sentMessageCount: 0,
    });

    const folders = await request(http).get('/admin/vip/outreach/salons')
      .set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    const folder = (folders.body.items as Array<Record<string, unknown>>).find((item) => item.salonId === salonA.salonId);
    expect(folder).toMatchObject({ sentMessageCount: 1, requestCount: filler + 3 });

    const other = await request(http).get('/salon/overall-performance')
      .set('Authorization', `Bearer ${salonB.accessToken}`).expect(200);
    expect(other.body.vipMessageRequestCount).toBe(30);
    expect(other.body.vipSentMessageCount).toBe(0);
  });
});

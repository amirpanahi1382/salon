import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { Prisma } from '@salon/database';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';
import { RECORDED_SEND_PREDICATE } from '../src/vip/admin-salon-profile.use-case';
import { createPlatformAdminSession, createProductOwnerSession } from './support/phone-account';

const databaseUrl = process.env.DATABASE_URL;
const dedicatedUrl = process.env.ADMIN_VIP_PROFILE_DISPOSABLE_DATABASE_URL;
const disposableTarget = (() => {
  if (!databaseUrl || !dedicatedUrl || databaseUrl !== dedicatedUrl) return null;
  if (process.env.OTPY_API_KEY || process.env.BALE_SAFIR_API_ACCESS_KEY) return null;
  try {
    const parsed = new URL(databaseUrl);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    const forbiddenPorts = new Set(['5432', '15442', '15450', '15452']);
    if (parsed.hostname !== '127.0.0.1' || parsed.port === '' || forbiddenPorts.has(parsed.port)) {
      return null;
    }
    if (name === 'salon' || name === 'salon_preview' || name === 'postgres') return null;
    if (!/^salon_admin_vip_profile_[a-z0-9]+$/.test(name)) return null;
    return { name, token: name.slice('salon_admin_vip_profile_'.length), port: parsed.port };
  } catch {
    return null;
  }
})();
const describeIfDisposable = disposableTarget ? describe : describe.skip;

describeIfDisposable('Admin VIP salon profile and inventory SQL (e2e)', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  let salonAToken: string;
  let salonAId: string;
  let salonAUserId: string;
  let salonBId: string;
  let salonBUserId: string;
  let importedActiveId: string;
  let reviewedRequestableId: string;
  let inUseId: string;
  let salonBListId: string;
  let queuedListId: string;
  let baleListId: string;
  let phoneSerial = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new MemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const identity = await prisma.client.$queryRaw<
      Array<{ name: string; comment: string | null; sysid: string; port: string }>
    >`
      SELECT current_database() AS name,
             shobj_description(oid, 'pg_database') AS comment,
             (SELECT system_identifier::text FROM pg_control_system()) AS sysid,
             inet_server_port()::text AS port
      FROM pg_database
      WHERE datname = current_database()
    `;
    const row = identity[0];
    if (
      !disposableTarget ||
      row?.name !== disposableTarget.name ||
      row.comment !== `admin-vip-profile-disposable:${disposableTarget.token}` ||
      row.name === 'salon' ||
      row.name === 'salon_preview'
    ) {
      throw new Error('Refusing admin VIP profile tests without this run’s disposable database');
    }
    writeFileSync(
      '/tmp/salon-admin-vip-profile-identity.json',
      `${JSON.stringify({
        database: row.name,
        comment: row.comment,
        systemIdentifier: row.sysid,
        serverPort: row.port,
        hostPort: disposableTarget.port,
        container: 'salon-admin-vip-profile-pg-20261025T101452Z',
      })}\n`,
    );

    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), {
      name: 'Admin VIP Profile Ops',
      password: 'platform-admin-pass',
    });
    adminToken = admin.accessToken;
    adminId = admin.adminId;

    const salonA = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'AdminVipProfile-A',
      ownerName: 'Owner A',
    });
    salonAToken = salonA.accessToken;
    salonAId = salonA.salonId;
    salonAUserId = salonA.userId;
    const salonB = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'AdminVipProfile-B',
      ownerName: 'Owner B',
    });
    salonBId = salonB.salonId;
    salonBUserId = salonB.userId;
    await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'AdminVipProfile-Search-Other',
      ownerName: 'Owner C',
    });

    const now = new Date('2026-10-25T10:00:00.000Z');
    await prisma.client.vipSalonEntitlement.createMany({
      data: [
        { id: randomUUID(), salonId: salonAId, grantedByAdminId: adminId, grantedAt: now, updatedAt: now },
        { id: randomUUID(), salonId: salonBId, grantedByAdminId: adminId, grantedAt: now, updatedAt: now },
      ],
    });

    const fillerCreated = new Date('2026-01-01T00:00:00.000Z');
    for (let index = 0; index < 51; index += 1) {
      await createList({
        name: `filler-${String(index).padStart(2, '0')}`,
        status: 'ACTIVE',
        regionCode: '14',
        catalogMembership: null,
        contacts: 1,
        createdAt: new Date(fillerCreated.getTime() + index * 1000),
      });
    }

    importedActiveId = await createList({
      name: 'imported-active-unreviewed',
      status: 'ACTIVE',
      regionCode: '02',
      catalogMembership: null,
      contacts: 3,
      createdAt: new Date('2026-10-25T09:00:00.000Z'),
    });
    reviewedRequestableId = await createList({
      name: 'reviewed-requestable',
      status: 'ACTIVE',
      regionCode: '01',
      catalogMembership: 'ORIGINAL_TEHRAN',
      contacts: 2,
      createdAt: new Date('2026-10-25T09:10:00.000Z'),
    });
    inUseId = await createList({
      name: 'in-use-reserved',
      status: 'IN_USE',
      regionCode: '01',
      catalogMembership: 'ORIGINAL_TEHRAN',
      contacts: 2,
      reservedBySalonId: salonAId,
      reservedAt: now,
      createdAt: new Date('2026-10-25T09:20:00.000Z'),
    });
    queuedListId = await createList({
      name: 'queued-in-use',
      status: 'IN_USE',
      regionCode: '04',
      catalogMembership: 'ORIGINAL_TEHRAN',
      contacts: 1,
      reservedBySalonId: salonAId,
      reservedAt: now,
      createdAt: new Date('2026-10-25T09:30:00.000Z'),
    });
    baleListId = await createList({
      name: 'bale-in-use',
      status: 'IN_USE',
      regionCode: '05',
      catalogMembership: 'ORIGINAL_TEHRAN',
      contacts: 1,
      reservedBySalonId: salonAId,
      reservedAt: now,
      createdAt: new Date('2026-10-25T09:40:00.000Z'),
    });
    salonBListId = await createList({
      name: 'salon-b-only',
      status: 'IN_USE',
      regionCode: '03',
      catalogMembership: 'ORIGINAL_TEHRAN',
      contacts: 1,
      reservedBySalonId: salonBId,
      reservedAt: now,
      createdAt: new Date('2026-10-25T09:50:00.000Z'),
    });

    await createVipRequest({
      listId: reviewedRequestableId,
      salonId: salonAId,
      userId: salonAUserId,
      status: 'SUBMITTED',
      submittedAt: now,
    });
    await createVipRequest({
      listId: reviewedRequestableId,
      salonId: salonAId,
      userId: salonAUserId,
      status: 'CANCELLED',
      cancelledAt: now,
    });
    await createVipRequest({
      listId: inUseId,
      salonId: salonAId,
      userId: salonAUserId,
      status: 'AWAITING_SAMPLE_WORK',
    });
    const queuedRequestId = await createVipRequest({
      listId: queuedListId,
      salonId: salonAId,
      userId: salonAUserId,
      status: 'MANUAL_QUEUED',
      submittedAt: now,
    });
    await createVipRequest({
      listId: baleListId,
      salonId: salonAId,
      userId: salonAUserId,
      status: 'BALE_NOT_IMPLEMENTED',
      submittedAt: now,
    });
    const salonBRequestId = await createVipRequest({
      listId: salonBListId,
      salonId: salonBId,
      userId: salonBUserId,
      status: 'SUBMITTED',
      submittedAt: now,
    });

    const customerA1 = await createCustomer(salonAId, '09121110001');
    const customerA2 = await createCustomer(salonAId, '09121110002');
    const customerA3 = await createCustomer(salonAId, '09121110003');
    const customerA4 = await createCustomer(salonAId, '09121110004');

    await createOrdinaryMessage({
      salonId: salonAId,
      userId: salonAUserId,
      customerId: customerA1,
      requestStatus: 'SENT',
      deliveryStatus: 'SENT',
      submittedAt: now,
    });
    await createOrdinaryMessage({
      salonId: salonAId,
      userId: salonAUserId,
      customerId: customerA2,
      requestStatus: 'QUEUED',
    });
    await createOrdinaryMessage({
      salonId: salonAId,
      userId: salonAUserId,
      customerId: customerA3,
      requestStatus: 'FAILED',
      deliveryStatus: 'FAILED',
    });
    await createOrdinaryMessage({
      salonId: salonAId,
      userId: salonAUserId,
      customerId: customerA4,
      requestStatus: 'DISPATCHED',
      deliveryStatus: 'PROCESSING',
      attempts: 3,
      executionGeneration: 1,
    });

    await createVipMessage({
      salonId: salonAId,
      userId: salonAUserId,
      vipRequestId: queuedRequestId,
      phone: '09123330001',
      requestStatus: 'SENT',
      deliveryStatus: 'SENT',
      submittedAt: now,
    });
    await createVipMessage({
      salonId: salonAId,
      userId: salonAUserId,
      vipRequestId: queuedRequestId,
      phone: '09123330002',
      requestStatus: 'SENT',
      deliveryStatus: 'SENT',
      submittedAt: now,
      attempts: 4,
      executionGeneration: 2,
    });
    await createVipMessage({
      salonId: salonAId,
      userId: salonAUserId,
      vipRequestId: queuedRequestId,
      phone: '09123330003',
      requestStatus: 'QUEUED',
      deliveryStatus: 'PENDING',
    });
    await createVipMessage({
      salonId: salonAId,
      userId: salonAUserId,
      vipRequestId: queuedRequestId,
      phone: '09123330004',
      requestStatus: 'FAILED',
      deliveryStatus: 'FAILED',
    });
    await createVipMessage({
      salonId: salonAId,
      userId: salonAUserId,
      vipRequestId: queuedRequestId,
      phone: '09123330005',
      requestStatus: 'DISPATCHED',
      deliveryStatus: 'PROCESSING',
      attempts: 2,
      executionGeneration: 1,
    });
    await createVipMessage({
      salonId: salonBId,
      userId: salonBUserId,
      vipRequestId: salonBRequestId,
      phone: '09124440001',
      requestStatus: 'SENT',
      deliveryStatus: 'SENT',
      submittedAt: now,
    });
  });

  beforeEach(() => {
    const storage = app.get(ThrottlerStorage) as {
      storage: Map<string, { totalHits: Map<string, number>; isBlocked: boolean }>;
      timeoutIds?: Map<string, NodeJS.Timeout[]>;
    };
    storage.timeoutIds?.forEach((ids) => {
      for (const id of ids) clearTimeout(id);
    });
    storage.timeoutIds?.clear();
    storage.storage.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  function nextPhone() {
    phoneSerial += 1;
    return `0913${String(phoneSerial).padStart(7, '0')}`;
  }

  async function createList(input: {
    name: string;
    status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'IN_USE';
    regionCode: string | null;
    catalogMembership: 'ORIGINAL_TEHRAN' | null;
    contacts: number;
    createdAt: Date;
    reservedBySalonId?: string | null;
    reservedAt?: Date | null;
  }) {
    const id = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id,
        name: input.name,
        status: input.status,
        contactCount: input.contacts,
        regionCode: input.regionCode,
        catalogMembership: input.catalogMembership,
        createdByAdminId: adminId,
        reservedBySalonId: input.reservedBySalonId ?? null,
        reservedAt: input.reservedAt ?? null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        contacts: {
          create: Array.from({ length: input.contacts }, (_, index) => ({
            id: randomUUID(),
            sortOrder: index + 1,
            displayName: null,
            phoneNumber: nextPhone(),
          })),
        },
      },
    });
    return id;
  }

  async function createVipRequest(input: {
    listId: string;
    salonId: string;
    userId: string;
    status: 'AWAITING_SAMPLE_WORK' | 'SUBMITTED' | 'MANUAL_QUEUED' | 'BALE_NOT_IMPLEMENTED' | 'CANCELLED';
    submittedAt?: Date | null;
    cancelledAt?: Date | null;
  }) {
    const id = randomUUID();
    const now = new Date('2026-10-25T10:00:00.000Z');
    await prisma.client.vipRequest.create({
      data: {
        id,
        salonId: input.salonId,
        listId: input.listId,
        createdByUserId: input.userId,
        requestedCount: 30,
        geographicRange: 'منطقه آزمایش',
        status: input.status,
        reservedUntil: new Date('2026-10-25T10:30:00.000Z'),
        submittedAt: input.submittedAt ?? null,
        cancelledAt: input.cancelledAt ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }

  async function createCustomer(salonId: string, phoneNumber: string) {
    const id = randomUUID();
    await prisma.client.customer.create({
      data: {
        id,
        salonId,
        firstName: 'سارا',
        lastName: phoneNumber.slice(-4),
        phoneNumber,
        updatedAt: new Date(),
      },
    });
    return id;
  }

  async function createOrdinaryMessage(input: {
    salonId: string;
    userId: string;
    customerId: string;
    requestStatus: 'QUEUED' | 'DISPATCHED' | 'SENT' | 'FAILED';
    deliveryStatus?: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
    submittedAt?: Date | null;
    attempts?: number;
    executionGeneration?: number;
  }) {
    const requestId = randomUUID();
    const customer = await prisma.client.customer.findUniqueOrThrow({
      where: { id: input.customerId },
    });
    const now = new Date('2026-10-25T10:00:00.000Z');
    await prisma.client.messageRequest.create({
      data: {
        id: requestId,
        salonId: input.salonId,
        customerId: input.customerId,
        createdByUserId: input.userId,
        recipientPhoneNumber: customer.phoneNumber,
        messageText: 'سلام',
        requestedAt: now,
        messageBusinessDate: new Date('2026-10-25T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: input.requestStatus,
        updatedAt: now,
      },
    });
    if (!input.deliveryStatus) return requestId;
    await prisma.client.messageDelivery.create({
      data: {
        id: randomUUID(),
        salonId: input.salonId,
        messageRequestId: requestId,
        customerId: input.customerId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: input.deliveryStatus,
        providerRequestId: randomUUID(),
        createdBy: input.userId,
        attempts: input.attempts ?? 1,
        executionGeneration: input.executionGeneration ?? 0,
        submittedAt: input.deliveryStatus === 'SENT' ? input.submittedAt ?? now : null,
        failedAt: input.deliveryStatus === 'FAILED' ? now : null,
        updatedAt: now,
      },
    });
    return requestId;
  }

  async function createVipMessage(input: {
    salonId: string;
    userId: string;
    vipRequestId: string;
    phone: string;
    requestStatus: 'QUEUED' | 'DISPATCHED' | 'SENT' | 'FAILED';
    deliveryStatus: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
    submittedAt?: Date | null;
    attempts?: number;
    executionGeneration?: number;
  }) {
    const requestId = randomUUID();
    const now = new Date('2026-10-25T10:00:00.000Z');
    await prisma.client.messageRequest.create({
      data: {
        id: requestId,
        salonId: input.salonId,
        createdByUserId: input.userId,
        vipRequestId: input.vipRequestId,
        recipientDisplayName: 'VIP',
        recipientPhoneNumber: input.phone,
        messageText: 'VIP سلام',
        requestedAt: now,
        messageBusinessDate: new Date('2026-10-25T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: input.requestStatus,
        updatedAt: now,
      },
    });
    await prisma.client.messageDelivery.create({
      data: {
        id: randomUUID(),
        salonId: input.salonId,
        messageRequestId: requestId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: input.deliveryStatus,
        providerRequestId: randomUUID(),
        createdBy: input.userId,
        attempts: input.attempts ?? 1,
        executionGeneration: input.executionGeneration ?? 0,
        submittedAt: input.deliveryStatus === 'SENT' ? input.submittedAt ?? now : null,
        failedAt: input.deliveryStatus === 'FAILED' ? now : null,
        updatedAt: now,
      },
    });
  }

  it('rejects unauthenticated and salon JWT access to the admin profile', async () => {
    await request(app.getHttpServer())
      .get(`/admin/vip/salons/${salonAId}/profile`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/admin/vip/salons/${salonAId}/profile`)
      .set('Authorization', `Bearer ${salonAToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .set('Authorization', `Bearer ${salonAToken}`)
      .expect(403);
  });

  it('returns live salon A aggregates from SQL, isolated from salon B', async () => {
    const profileA = await request(app.getHttpServer())
      .get(`/admin/vip/salons/${salonAId}/profile`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(profileA.body).toMatchObject({
      salonId: salonAId,
      salonName: 'AdminVipProfile-A',
      entitled: true,
      consistency: 'LIVE_READ',
      counts: {
        distinctVipListsRequested: 4,
        vipRequestCount: 5,
        vipOpenRequestCount: 4,
        ordinaryMessageRequestCount: 4,
        vipRecordedSendCount: 2,
        ordinaryRecordedSendCount: 1,
      },
    });
    expect(profileA.body.counts.vipRequestCount).toBeGreaterThan(
      profileA.body.counts.vipOpenRequestCount,
    );
    expect(profileA.body.counts.distinctVipListsRequested).toBeLessThan(
      profileA.body.counts.vipRequestCount,
    );

    const profileB = await request(app.getHttpServer())
      .get(`/admin/vip/salons/${salonBId}/profile`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(profileB.body.counts).toEqual({
      distinctVipListsRequested: 1,
      vipRequestCount: 1,
      vipOpenRequestCount: 1,
      ordinaryMessageRequestCount: 0,
      vipRecordedSendCount: 1,
      ordinaryRecordedSendCount: 0,
    });
  });

  it('counts list-level total and open requests, including cancelled, and keeps ACTIVE unreviewed unavailable', async () => {
    const imported = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${importedActiveId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(imported.body).toMatchObject({
      id: importedActiveId,
      status: 'ACTIVE',
      catalogMembership: null,
      requestableBySalons: false,
      totalRequestCount: 0,
      openRequestCount: 0,
      contactCount: 3,
      regionCode: '02',
    });

    const reviewed = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${reviewedRequestableId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(reviewed.body).toMatchObject({
      id: reviewedRequestableId,
      status: 'ACTIVE',
      catalogMembership: 'ORIGINAL_TEHRAN',
      requestableBySalons: false,
      nextReservationOpen: false,
      totalRequestCount: 2,
      openRequestCount: 1,
    });

    const inUse = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${inUseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(inUse.body).toMatchObject({
      id: inUseId,
      status: 'IN_USE',
      catalogMembership: 'ORIGINAL_TEHRAN',
      requestableBySalons: true,
      nextReservationOpen: false,
      liveRequestCount: 0,
      totalRequestCount: 1,
      openRequestCount: 1,
    });
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${inUseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(409);
    const deactivated = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${inUseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'INACTIVE' })
      .expect(200);
    expect(deactivated.body).toMatchObject({
      status: 'INACTIVE',
      requestableBySalons: false,
      nextReservationOpen: false,
      openRequestCount: 1,
    });
  });

  it('paginates inventory and searches salons on nonempty data', async () => {
    const first = await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.listCount).toBeGreaterThanOrEqual(57);
    expect(first.body.items.some((row: { id: string }) => row.id === importedActiveId)).toBe(true);
    expect(first.body.items.find((row: { id: string }) => row.id === importedActiveId)).toMatchObject({
      requestableBySalons: false,
      catalogMembership: null,
    });
    const second = await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .query({ cursor: first.body.nextCursor })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(second.body.items.length).toBeGreaterThan(0);
    const ids = [...first.body.items, ...second.body.items].map((row: { id: string }) => row.id);
    expect(new Set(ids).size).toBe(ids.length);

    const search = await request(app.getHttpServer())
      .get('/admin/vip/salons')
      .query({ q: 'AdminVipProfile-A' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(search.body.items).toEqual([
      expect.objectContaining({ id: salonAId, name: 'AdminVipProfile-A', entitled: true }),
    ]);
  });

  it('explains the live aggregate SQL against nonempty tables', async () => {
    const profilePlan = await prisma.client.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
      EXPLAIN
      SELECT
        (
          SELECT COUNT(DISTINCT r.list_id)::int
          FROM vip_requests r
          WHERE r.salon_id = ${salonAId}::uuid
        ) AS "distinctVipListCount",
        (
          SELECT COUNT(*)::int
          FROM vip_requests r
          WHERE r.salon_id = ${salonAId}::uuid
        ) AS "vipRequestCount",
        (
          SELECT COUNT(*)::int
          FROM message_deliveries d
          INNER JOIN message_requests m
            ON m.id = d.message_request_id AND m.salon_id = d.salon_id
          WHERE d.salon_id = ${salonAId}::uuid
            AND ${RECORDED_SEND_PREDICATE}
            AND m.vip_request_id IS NOT NULL
        ) AS "vipRecordedSendCount"
    `);
    const profileText = profilePlan.map((row) => row['QUERY PLAN']).join('\n');
    expect(profileText).toMatch(/vip_requests/);
    expect(profileText).toMatch(/message_deliveries/);
    expect(profileText).toMatch(/message_requests/);

    const listPlan = await prisma.client.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
      EXPLAIN
      SELECT
        r.list_id AS "listId",
        COUNT(*)::int AS "totalRequestCount",
        COUNT(*) FILTER (
          WHERE r.status::text IN ('AWAITING_SAMPLE_WORK', 'SUBMITTED', 'MANUAL_QUEUED', 'BALE_NOT_IMPLEMENTED')
        )::int AS "openRequestCount"
      FROM vip_requests r
      WHERE r.list_id IN (${Prisma.join(
        [reviewedRequestableId, importedActiveId, inUseId].map((id) => Prisma.sql`${id}::uuid`),
      )})
      GROUP BY r.list_id
    `);
    const listText = listPlan.map((row) => row['QUERY PLAN']).join('\n');
    expect(listText).toMatch(/vip_requests/);
    writeFileSync(
      '/tmp/salon-admin-vip-profile-explain.txt',
      `${profileText}\n---\n${listText}\n`,
    );
  });
});

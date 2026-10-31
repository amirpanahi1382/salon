import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';
import { createPlatformAdminSession, createProductOwnerSession } from './support/phone-account';

const databaseUrl = process.env.DATABASE_URL;
const dedicatedUrl = process.env.ADMIN_VIP_ACTIVATION_DISPOSABLE_DATABASE_URL;
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
    if (name === 'salon' || name === 'salon_preview' || name === 'postgres' || name === 'phone_first_product' || name === 'salon-db') {
      return null;
    }
    if (!/^salon_admin_vip_activate_[a-z0-9]+$/.test(name)) return null;
    return { name, token: name.slice('salon_admin_vip_activate_'.length), port: parsed.port };
  } catch {
    return null;
  }
})();
const describeIfDisposable = disposableTarget ? describe : describe.skip;

async function vipXlsx(count: number, prefix: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('VIP');
  sheet.addRow(['نام', 'شماره تلفن']);
  for (let i = 0; i < count; i += 1) {
    sheet.addRow([`مخاطب ${i + 1}`, `${prefix}${String(i).padStart(7, '0')}`]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describeIfDisposable('Admin VIP activation makes lists requestable (e2e)', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  let entitledToken: string;
  let entitledSalonId: string;
  let otherToken: string;
  let otherSalonId: string;
  let unauthorizedToken: string;
  let probeToken: string;
  let probeSalonId: string;
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
      row.comment !== `admin-vip-activate-disposable:${disposableTarget.token}` ||
      row.name === 'salon' ||
      row.name === 'salon_preview' ||
      row.name === 'phone_first_product' ||
      row.name === 'salon-db'
    ) {
      throw new Error('Refusing admin VIP activation tests without this run’s disposable database');
    }
    writeFileSync(
      '/tmp/salon-admin-vip-activate-identity.json',
      `${JSON.stringify({
        database: row.name,
        comment: row.comment,
        systemIdentifier: row.sysid,
        serverPort: row.port,
        hostPort: disposableTarget.port,
      })}\n`,
    );

    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), {
      name: 'Admin VIP Activate Ops',
      password: 'platform-admin-pass',
    });
    adminToken = admin.accessToken;
    adminId = admin.adminId;

    const entitled = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'Activate-Entitled',
      ownerName: 'Owner Entitled',
    });
    entitledToken = entitled.accessToken;
    entitledSalonId = entitled.salonId;
    const other = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'Activate-Other',
      ownerName: 'Owner Other',
    });
    otherToken = other.accessToken;
    otherSalonId = other.salonId;
    const unauthorized = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'Activate-NoVip',
      ownerName: 'Owner NoVip',
    });
    unauthorizedToken = unauthorized.accessToken;
    const probe = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'Activate-Probe',
      ownerName: 'Owner Probe',
    });
    probeToken = probe.accessToken;
    probeSalonId = probe.salonId;

    await request(app.getHttpServer())
      .post('/admin/vip/entitlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `grant-${entitledSalonId}`)
      .send({ salonId: entitledSalonId })
      .expect(201);
    await request(app.getHttpServer())
      .post('/admin/vip/entitlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `grant-${otherSalonId}`)
      .send({ salonId: otherSalonId })
      .expect(201);
    await request(app.getHttpServer())
      .post('/admin/vip/entitlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `grant-${probe.salonId}`)
      .send({ salonId: probe.salonId })
      .expect(201);
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
    await app.close();
  });

  async function importList(count = 30) {
    phoneSerial += 1;
    const file = await vipXlsx(count, `09${String(20 + phoneSerial).padStart(2, '0')}`);
    const response = await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `import-${randomUUID()}`)
      .attach('file', file, 'vip.xlsx')
      .expect(201);
    return response.body.id as string;
  }

  it('imports PENDING invisible, then region+activate makes it requestable and reservable', async () => {
    const entitlementsBefore = await prisma.client.vipSalonEntitlement.count();
    const listId = await importList();
    const imported = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(imported.body).toMatchObject({
      id: listId,
      status: 'PENDING',
      regionCode: null,
      catalogMembership: null,
      requestableBySalons: false,
    });

    const beforeRegions = await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${entitledToken}`)
      .expect(200);
    const before03 = beforeRegions.body.items.find((row: { regionCode: string }) => row.regionCode === '03');
    const beforeCount = before03.availableListCount as number;
    const beforeLists = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03' })
      .set('Authorization', `Bearer ${entitledToken}`)
      .expect(200);
    expect(beforeLists.body.items.map((row: { id: string }) => row.id)).not.toContain(listId);

    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '15' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '1' })
      .expect(400);

    const activated = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '03' })
      .expect(200);
    expect(activated.body).toMatchObject({
      id: listId,
      status: 'ACTIVE',
      regionCode: '03',
      catalogMembership: 'ORIGINAL_TEHRAN',
      requestableBySalons: true,
    });
    const stored = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(stored.status).toBe('ACTIVE');
    expect(stored.regionCode).toBe('03');
    expect(stored.catalogMembership).toBe('ORIGINAL_TEHRAN');
    expect(await prisma.client.vipSalonEntitlement.count()).toBe(entitlementsBefore);

    const afterRegions = await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${entitledToken}`)
      .expect(200);
    const after03 = afterRegions.body.items.find((row: { regionCode: string }) => row.regionCode === '03');
    expect(after03.availableListCount).toBe(beforeCount + 1);
    const afterLists = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03' })
      .set('Authorization', `Bearer ${entitledToken}`)
      .expect(200);
    expect(afterLists.body.items.map((row: { id: string }) => row.id)).toContain(listId);

    await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${unauthorizedToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${unauthorizedToken}`)
      .set('Idempotency-Key', `no-entitlement-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'سعادت‌آباد' })
      .expect(403);

    const reserved = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${entitledToken}`)
      .set('Idempotency-Key', `reserve-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'سعادت‌آباد' })
      .expect(201);
    expect(reserved.body.listId).toBe(listId);
    const afterReserve = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(afterReserve.status).toBe('IN_USE');
    expect(afterReserve.reservedBySalonId).toBe(entitledSalonId);
    const adminAfter = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminAfter.body.requestableBySalons).toBe(false);
    expect(adminAfter.body.status).toBe('IN_USE');
    const hidden = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03' })
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(hidden.body.items.map((row: { id: string }) => row.id)).not.toContain(listId);
    const liveDraft = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: reserved.body.id as string },
    });
    expect(liveDraft.status).toBe('AWAITING_SAMPLE_WORK');
    expect(liveDraft.reservedUntil.getTime()).toBeGreaterThan(Date.now());
    const hiddenCount = await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    const hidden03 = hiddenCount.body.items.find((row: { regionCode: string }) => row.regionCode === '03');
    expect(hidden03.availableListCount).toBe(beforeCount);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Idempotency-Key', `live-conflict-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'سعادت‌آباد' })
      .expect(409);
  });

  it('shows an expired IN_USE hold as reclaimable without a read-side write', async () => {
    const listId = await importList();
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '12' })
      .expect(200);
    const reserved = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${probeToken}`)
      .set('Idempotency-Key', `expire-hold-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'یوسف‌آباد' })
      .expect(201);
    const overdue = new Date(Date.now() - 60_000);
    const whileLive = await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    const liveCount = whileLive.body.items.find((row: { regionCode: string }) => row.regionCode === '12').availableListCount as number;
    const liveBrowse = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '12' })
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(liveBrowse.body.items.map((row: { id: string }) => row.id)).not.toContain(listId);
    await prisma.client.vipRequest.update({
      where: { id: reserved.body.id as string },
      data: { reservedUntil: overdue },
    });

    const beforeRead = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: reserved.body.id as string },
    });
    const adminRead = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const regions = await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    const browsed = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '12' })
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    const afterRead = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: reserved.body.id as string },
    });
    const stored = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(adminRead.body.requestableBySalons).toBe(true);
    expect(adminRead.body.status).toBe('IN_USE');
    expect(browsed.body.items.map((row: { id: string }) => row.id)).toContain(listId);
    const region12 = regions.body.items.find((row: { regionCode: string }) => row.regionCode === '12');
    expect(region12.availableListCount).toBe(liveCount + 1);
    expect(afterRead.status).toBe(beforeRead.status);
    expect(afterRead.reservedUntil.toISOString()).toBe(beforeRead.reservedUntil.toISOString());
    expect(stored.status).toBe('IN_USE');
    expect(stored.reservedBySalonId).toBe(probeSalonId);

    const reclaimed = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Idempotency-Key', `reclaim-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'یوسف‌آباد' })
      .expect(201);
    const previous = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: reserved.body.id as string },
    });
    const held = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(previous.status).toBe('AWAITING_SAMPLE_WORK');
    expect(reclaimed.body.listId).toBe(listId);
    expect(held.status).toBe('IN_USE');
    expect(held.regionCode).toBe('12');
    expect(held.reservedBySalonId).toBe(otherSalonId);
    expect(held.catalogMembership).toBe('ORIGINAL_TEHRAN');
    await prisma.client.vipRequest.updateMany({
      where: { listId, status: 'AWAITING_SAMPLE_WORK' },
      data: { status: 'CANCELLED', cancelledAt: new Date(), reservedUntil: new Date(Date.now() - 1_000) },
    });
    await prisma.client.vipTargetList.update({
      where: { id: listId },
      data: { status: 'ACTIVE', reservedBySalonId: null, reservedAt: null },
    });
  });

  it('lets exactly one salon reclaim an expired hold, and a later live state blocks reserve', async () => {
    const listId = await importList();
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '11' })
      .expect(200);
    const held = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${probeToken}`)
      .set('Idempotency-Key', `race-hold-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'ونک' })
      .expect(201);
    await prisma.client.vipRequest.update({
      where: { id: held.body.id as string },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    const visible = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(visible.body.requestableBySalons).toBe(true);
    expect(visible.body.status).toBe('IN_USE');

    await prisma.client.vipRequest.update({
      where: { id: held.body.id as string },
      data: { reservedUntil: new Date(Date.now() + 60_000) },
    });
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Idempotency-Key', `after-get-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'ونک' })
      .expect(409);
    const unchanged = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: held.body.id as string },
    });
    expect(unchanged.status).toBe('AWAITING_SAMPLE_WORK');

    await prisma.client.vipRequest.update({
      where: { id: held.body.id as string },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    const raced = await Promise.all([
      request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${otherToken}`)
        .set('Idempotency-Key', `race-a-${randomUUID()}`)
        .send({ listId, requestedCount: 30, geographicRange: 'ونک' }),
      request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${probeToken}`)
        .set('Idempotency-Key', `race-b-${randomUUID()}`)
        .send({ listId, requestedCount: 30, geographicRange: 'ونک' }),
    ]);
    const statuses = raced.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);
    const winner = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(winner.status).toBe('IN_USE');
    expect([otherSalonId, probeSalonId]).toContain(winner.reservedBySalonId);
    const freshDrafts = await prisma.client.vipRequest.count({
      where: { listId, status: 'AWAITING_SAMPLE_WORK', reservedUntil: { gt: new Date() } },
    });
    expect(freshDrafts).toBe(1);
    const original = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: held.body.id as string },
    });
    expect(original.status).toBe(winner.reservedBySalonId === probeSalonId ? 'CANCELLED' : 'AWAITING_SAMPLE_WORK');
    await prisma.client.vipRequest.updateMany({
      where: { listId, status: 'AWAITING_SAMPLE_WORK' },
      data: { status: 'CANCELLED', cancelledAt: new Date(), reservedUntil: new Date(Date.now() - 1_000) },
    });
    await prisma.client.vipTargetList.update({
      where: { id: listId },
      data: { status: 'ACTIVE', reservedBySalonId: null, reservedAt: null },
    });
  });

  it('rejects missing/invalid region, IN_USE changes, and unauthorized admin writes', async () => {
    const listId = await importList();
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .send({ availability: 'ACTIVE', regionCode: '04' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${entitledToken}`)
      .send({ availability: 'ACTIVE', regionCode: '04' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '04' })
      .expect(200);

    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Idempotency-Key', `inuse-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'صادقیه' })
      .expect(201);
    expect(created.body.listId).toBe(listId);

    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '04' })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'INACTIVE' })
      .expect(200);
    const deactivated = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(deactivated.status).toBe('INACTIVE');
    expect(deactivated.regionCode).toBe('04');
    expect(deactivated.nextReservationOpen).toBe(false);
    const kept = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: created.body.id as string } });
    expect(kept.status).toBe('AWAITING_SAMPLE_WORK');
  });

  it('completes an already ACTIVE unclassified list without deactivate/reactivate, and keeps inactive lists hidden', async () => {
    const historicalId = randomUUID();
    const now = new Date();
    await prisma.client.vipTargetList.create({
      data: {
        id: historicalId,
        name: 'historical-active-unclassified',
        status: 'ACTIVE',
        contactCount: 30,
        regionCode: null,
        catalogMembership: null,
        createdByAdminId: adminId,
        createdAt: now,
        updatedAt: now,
        contacts: {
          create: Array.from({ length: 30 }, (_, index) => ({
            id: randomUUID(),
            sortOrder: index + 1,
            displayName: `قدیمی ${index + 1}`,
            phoneNumber: `0918${String(index).padStart(7, '0')}`,
          })),
        },
      },
    });

    const before = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${historicalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(before.body).toMatchObject({
      status: 'ACTIVE',
      regionCode: null,
      catalogMembership: null,
      requestableBySalons: false,
    });
    const hiddenBefore = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '07' })
      .set('Authorization', `Bearer ${entitledToken}`)
      .expect(200);
    expect(hiddenBefore.body.items.map((row: { id: string }) => row.id)).not.toContain(historicalId);

    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${historicalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(400);

    const completed = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${historicalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '07' })
      .expect(200);
    expect(completed.body).toMatchObject({
      status: 'ACTIVE',
      regionCode: '07',
      catalogMembership: 'ORIGINAL_TEHRAN',
      requestableBySalons: true,
    });
    const stored = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: historicalId } });
    expect(stored.status).toBe('ACTIVE');
    expect(stored.regionCode).toBe('07');
    expect(stored.catalogMembership).toBe('ORIGINAL_TEHRAN');

    const visible = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '07' })
      .set('Authorization', `Bearer ${entitledToken}`)
      .expect(200);
    expect(visible.body.items.map((row: { id: string }) => row.id)).toContain(historicalId);

    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${historicalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'INACTIVE' })
      .expect(200);
    const inactive = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: historicalId } });
    expect(inactive.status).toBe('INACTIVE');
    expect(inactive.regionCode).toBe('07');
    expect(inactive.catalogMembership).toBe('ORIGINAL_TEHRAN');
    const adminInactive = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${historicalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminInactive.body.requestableBySalons).toBe(false);
    const hiddenAfter = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '07' })
      .set('Authorization', `Bearer ${entitledToken}`)
      .expect(200);
    expect(hiddenAfter.body.items.map((row: { id: string }) => row.id)).not.toContain(historicalId);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${probeToken}`)
      .set('Idempotency-Key', `inactive-${randomUUID()}`)
      .send({ listId: historicalId, requestedCount: 30, geographicRange: 'نارمک' })
      .expect(409);
  });

  it('keeps an existing canonical region and rejects a different one without a success audit', async () => {
    const listId = await importList();
    await prisma.client.vipTargetList.update({
      where: { id: listId },
      data: { regionCode: '06' },
    });
    const before = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(before.regionCode).toBe('06');
    expect(before.status).toBe('PENDING');
    const auditsBefore = await prisma.client.auditLog.count({
      where: { resourceId: listId, action: 'VIP_LIST_ACTIVATED', result: 'SUCCESS' },
    });

    const omitted = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    expect(omitted.body).toMatchObject({
      status: 'ACTIVE',
      regionCode: '06',
      catalogMembership: 'ORIGINAL_TEHRAN',
      requestableBySalons: true,
    });
    const same = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '06' })
      .expect(200);
    expect(same.body.regionCode).toBe('06');

    const auditsAfterKeep = await prisma.client.auditLog.count({
      where: { resourceId: listId, action: 'VIP_LIST_ACTIVATED', result: 'SUCCESS' },
    });
    expect(auditsAfterKeep).toBe(auditsBefore + 2);

    const rejected = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '09' })
      .expect(409);
    expect(rejected.body).toMatchObject({
      error: 'CONFLICT',
      message: 'Activation cannot change an existing canonical VIP list region',
    });
    const stored = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(stored.regionCode).toBe('06');
    expect(stored.status).toBe('ACTIVE');
    expect(stored.catalogMembership).toBe('ORIGINAL_TEHRAN');
    expect(stored.reservedBySalonId).toBeNull();
    expect(
      await prisma.client.auditLog.count({
        where: { resourceId: listId, action: 'VIP_LIST_ACTIVATED', result: 'SUCCESS' },
      }),
    ).toBe(auditsAfterKeep);

    const adminRead = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminRead.body.requestableBySalons).toBe(true);
    const browsed = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '06' })
      .set('Authorization', `Bearer ${entitledToken}`)
      .expect(200);
    expect(browsed.body.items.map((row: { id: string }) => row.id)).toContain(listId);
    const reserved = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${probeToken}`)
      .set('Idempotency-Key', `keep-region-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'پونک' })
      .expect(201);
    expect(reserved.body.listId).toBe(listId);
    const reservedRequest = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: reserved.body.id as string },
    });
    const inUse = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(inUse.status).toBe('IN_USE');
    expect(inUse.regionCode).toBe('06');
    expect(inUse.reservedBySalonId).toBe(reservedRequest.salonId);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '06' })
      .expect(409);
    const deactivatedResponse = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'INACTIVE' })
      .expect(200);
    expect(deactivatedResponse.body.status).toBe('INACTIVE');
    expect(deactivatedResponse.body.nextReservationOpen).toBe(false);
    const still = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(still.status).toBe('INACTIVE');
    expect(still.regionCode).toBe('06');
    expect(still.reservedBySalonId).toBeNull();
    const keptRequest = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: reserved.body.id as string },
    });
    expect(keptRequest.status).toBe('AWAITING_SAMPLE_WORK');
  });
});

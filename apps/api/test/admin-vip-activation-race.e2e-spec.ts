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
import { VipRepository } from '../src/vip/vip.repository';
import { createPlatformAdminSession, createProductOwnerSession } from './support/phone-account';

const databaseUrl = process.env.DATABASE_URL;
const dedicatedUrl = process.env.ADMIN_VIP_ACTIVATION_RACE_DISPOSABLE_DATABASE_URL;
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
    if (name === 'salon' || name === 'salon_preview' || name === 'postgres' || name === 'phone_first_product') {
      return null;
    }
    if (!/^salon_admin_vip_act_race_[a-z0-9]+$/.test(name)) return null;
    return { name, token: name.slice('salon_admin_vip_act_race_'.length), port: parsed.port };
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

describeIfDisposable('Admin VIP activation concurrent reservation (e2e)', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let vip: VipRepository;
  let adminToken: string;
  let entitledToken: string;
  let entitledSalonId: string;
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
    vip = app.get(VipRepository);
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
      row.comment !== `admin-vip-act-race-disposable:${disposableTarget.token}` ||
      row.name === 'salon' ||
      row.name === 'salon_preview' ||
      row.name === 'phone_first_product'
    ) {
      throw new Error('Refusing admin VIP activation race tests without this run’s disposable database');
    }
    writeFileSync(
      '/tmp/salon-admin-vip-act-race-identity.json',
      `${JSON.stringify({
        database: row.name,
        comment: row.comment,
        systemIdentifier: row.sysid,
        serverPort: row.port,
        hostPort: disposableTarget.port,
      })}\n`,
    );

    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), {
      name: 'Admin VIP Race Ops',
      password: 'platform-admin-pass',
    });
    adminToken = admin.accessToken;
    const entitled = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'Activate-Race-Entitled',
      ownerName: 'Owner Race',
    });
    entitledToken = entitled.accessToken;
    entitledSalonId = entitled.salonId;
    await request(app.getHttpServer())
      .post('/admin/vip/entitlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `grant-${entitledSalonId}`)
      .send({ salonId: entitledSalonId })
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

  async function importList() {
    phoneSerial += 1;
    const file = await vipXlsx(30, `09${String(30 + phoneSerial).padStart(2, '0')}`);
    const response = await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `import-${randomUUID()}`)
      .attach('file', file, 'vip.xlsx')
      .expect(201);
    return response.body.id as string;
  }

  async function activate(listId: string, regionCode: string) {
    return request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode })
      .expect(200);
  }

  it('activates and deactivates an unreserved list', async () => {
    const listId = await importList();
    const activated = await activate(listId, '05');
    expect(activated.body).toMatchObject({
      id: listId,
      status: 'ACTIVE',
      regionCode: '05',
      catalogMembership: 'ORIGINAL_TEHRAN',
      requestableBySalons: true,
    });
    const storedActive = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(storedActive.status).toBe('ACTIVE');
    expect(storedActive.reservedBySalonId).toBeNull();

    const deactivated = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'INACTIVE' })
      .expect(200);
    expect(deactivated.body).toMatchObject({
      id: listId,
      status: 'INACTIVE',
      regionCode: '05',
      catalogMembership: 'ORIGINAL_TEHRAN',
      requestableBySalons: false,
    });
    const storedInactive = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(storedInactive.status).toBe('INACTIVE');
    expect(storedInactive.reservedBySalonId).toBeNull();
    expect(storedInactive.regionCode).toBe('05');
    expect(storedInactive.catalogMembership).toBe('ORIGINAL_TEHRAN');

    const visible = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '05' })
      .set('Authorization', `Bearer ${entitledToken}`)
      .expect(200);
    expect(visible.body.items.map((row: { id: string }) => row.id)).not.toContain(listId);
  });

  it('rejects a stale admin availability write after a salon reservation, without a success audit', async () => {
    const listId = await importList();
    await activate(listId, '03');
    const adminRead = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminRead.body).toMatchObject({
      status: 'ACTIVE',
      regionCode: '03',
      catalogMembership: 'ORIGINAL_TEHRAN',
      requestableBySalons: true,
      reservedBySalonId: null,
    });
    const auditsBefore = await prisma.client.auditLog.count({
      where: { resourceId: listId, action: { in: ['VIP_LIST_ACTIVATED', 'VIP_LIST_DEACTIVATED'] }, result: 'SUCCESS' },
    });
    expect(auditsBefore).toBe(1);

    const reserved = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${entitledToken}`)
      .set('Idempotency-Key', `reserve-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'سعادت‌آباد' })
      .expect(201);
    const requestId = reserved.body.id as string;
    const afterReserve = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(afterReserve.status).toBe('IN_USE');
    expect(afterReserve.reservedBySalonId).toBe(entitledSalonId);

    const staleActivate = await prisma.client.$transaction((tx) =>
      vip.tryActivateUnreservedList(tx, {
        id: listId,
        regionCode: adminRead.body.regionCode,
        now: new Date(),
      }),
    );
    expect(staleActivate).toBe(false);
    const staleDeactivate = await prisma.client.$transaction((tx) =>
      vip.tryDeactivateUnreservedList(tx, { id: listId, now: new Date() }),
    );
    expect(staleDeactivate).toBe(false);

    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: adminRead.body.regionCode })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'INACTIVE' })
      .expect(409);

    const stored = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(stored.status).toBe('IN_USE');
    expect(stored.reservedBySalonId).toBe(entitledSalonId);
    expect(stored.reservedAt).toEqual(afterReserve.reservedAt);
    expect(stored.regionCode).toBe('03');
    expect(stored.catalogMembership).toBe('ORIGINAL_TEHRAN');
    const vipRequest = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(vipRequest.listId).toBe(listId);
    expect(vipRequest.salonId).toBe(entitledSalonId);
    expect(vipRequest.status).toBe('AWAITING_SAMPLE_WORK');
    expect(
      await prisma.client.auditLog.count({
        where: { resourceId: listId, action: { in: ['VIP_LIST_ACTIVATED', 'VIP_LIST_DEACTIVATED'] }, result: 'SUCCESS' },
      }),
    ).toBe(auditsBefore);
  });
});

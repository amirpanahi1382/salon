import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { classifyVipCatalogMembership, VipCatalogClassificationError } from '@salon/database';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

type ManifestRow = {
  id: string;
  regionCode: string;
  status: string;
  recordedContacts: number;
  contactRows: number;
  reservedBySalonId: string;
  vipRequests: number;
};

describeIfDb('VIP catalog membership (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let adminToken = '';
  let adminId = '';
  let expectedDatabase = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new MemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    const connected = await prisma.client.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
    expectedDatabase = connected[0]!.db;
    if (expectedDatabase === 'salon') {
      throw new Error('Refusing to run catalog tests against persistent database salon');
    }
    adminId = randomUUID();
    const email = `catalog-admin-${Date.now()}@example.test`;
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email,
        name: 'Catalog Ops',
        passwordHash: await argon2.hash('catalog-admin-pass', { type: argon2.argon2id }),
        updatedAt: new Date(),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: 'catalog-admin-pass' })
      .expect(201);
    adminToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  function csv(rows: ManifestRow[]): string {
    const header = 'id,name,region_code,status,recorded_contacts,contact_rows,reserved_by_salon_id,vip_requests,created_at';
    const lines = rows.map((row) =>
      [row.id, 'synthetic', row.regionCode, row.status, row.recordedContacts, row.contactRows, row.reservedBySalonId, row.vipRequests, '2026-01-01'].join(','),
    );
    return `${header}\n${lines.join('\n')}\n`;
  }

  async function auditCount(): Promise<number> {
    const rows = await prisma.client.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM audit_logs WHERE action = 'VIP_CATALOG_MEMBERSHIP_CLASSIFIED' AND actor_id = ${adminId}::uuid
    `;
    return Number(rows[0]?.n ?? 0);
  }

  async function createList(input: {
    id?: string;
    name: string;
    status?: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'IN_USE';
    regionCode?: string | null;
    createdAt?: Date;
    contacts?: number;
    reservedBySalonId?: string | null;
    reservedAt?: Date | null;
  }): Promise<string> {
    const id = input.id ?? randomUUID();
    const contacts = input.contacts ?? 1;
    const now = new Date();
    await prisma.client.vipTargetList.create({
      data: {
        id,
        name: input.name,
        status: input.status ?? 'ACTIVE',
        contactCount: contacts,
        regionCode: input.regionCode === undefined ? '01' : input.regionCode,
        createdByAdminId: adminId,
        reservedBySalonId: input.reservedBySalonId ?? null,
        reservedAt: input.reservedAt ?? null,
        createdAt: input.createdAt ?? now,
        updatedAt: now,
        contacts: {
          create: Array.from({ length: contacts }, (_, index) => ({
            id: randomUUID(),
            sortOrder: index + 1,
            displayName: null,
            phoneNumber: `0912${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
          })),
        },
      },
    });
    return id;
  }

  async function classify(rows: ManifestRow[]) {
    return classifyVipCatalogMembership(prisma.client, {
      manifestCsv: csv(rows),
      actorAdminId: adminId,
      expectedDatabase,
    });
  }

  it('rolls back when the manifest does not match and does not write an audit', async () => {
    const before = await auditCount();
    const present = await createList({ name: 'rollback-present', regionCode: '01' });
    const region = await createList({ name: 'rollback-region', regionCode: '01' });
    const partialKept = await createList({ name: 'rollback-partial-kept' });
    const partialNull = await createList({ name: 'rollback-partial-null' });
    await prisma.client.$executeRaw`
      UPDATE vip_target_lists
      SET catalog_membership = 'ORIGINAL_TEHRAN'::"VipCatalogMembership"
      WHERE id = ${partialKept}::uuid
    `;

    await expect(classify([
      { id: present, regionCode: '01', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
      { id: '00000000-0000-4000-8000-00000000eeee', regionCode: '01', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
    ])).rejects.toMatchObject({ code: 'LIST_MISSING' });

    await expect(classify([
      { id: region, regionCode: '02', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
    ])).rejects.toBeInstanceOf(VipCatalogClassificationError);

    await expect(classify([
      { id: partialKept, regionCode: '01', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
      { id: partialNull, regionCode: '01', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
    ])).rejects.toMatchObject({ code: 'MEMBERSHIP_PARTIAL' });

    const rows = await prisma.client.vipTargetList.findMany({
      where: { id: { in: [present, region, partialNull] } },
      select: { id: true, catalogMembership: true },
    });
    expect(rows.every((row) => row.catalogMembership === null)).toBe(true);
    expect(await auditCount()).toBe(before);
    await prisma.client.$executeRaw`
      UPDATE vip_target_lists
      SET catalog_membership = NULL
      WHERE id = ${partialKept}::uuid
    `;
  });

  it('classifies only the manifest, replays without another audit, and serves both admin views', async () => {
    const salonId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    await prisma.client.salon.create({ data: { id: salonId, name: 'Catalog Salon', updatedAt: now } });
    await prisma.client.user.create({
      data: {
        id: userId,
        salonId,
        name: 'Catalog Owner',
        email: `catalog-owner-${Date.now()}@example.test`,
        passwordHash: await argon2.hash('owner-pass', { type: argon2.argon2id }),
        role: 'OWNER',
        updatedAt: now,
      },
    });
    await prisma.client.vipSalonEntitlement.create({
      data: {
        id: randomUUID(),
        salonId,
        grantedByAdminId: adminId,
        grantedAt: now,
        updatedAt: now,
      },
    });

    const pendingId = await createList({ name: 'اصلی در انتظار', status: 'PENDING', regionCode: '04', createdAt: new Date('2024-06-01T00:00:00.000Z') });
    const activeOriginalId = await createList({ name: 'اصلی فعال', status: 'ACTIVE', regionCode: '03', createdAt: new Date('2024-06-02T00:00:00.000Z') });
    const inUseId = await createList({
      name: 'اصلی در حال استفاده',
      status: 'IN_USE',
      regionCode: '05',
      createdAt: new Date('2024-06-03T00:00:00.000Z'),
      reservedBySalonId: salonId,
      reservedAt: new Date('2024-06-03T00:00:00.000Z'),
    });
    const requestId = randomUUID();
    const submittedAt = new Date('2024-06-03T01:00:00.000Z');
    await prisma.client.vipRequest.create({
      data: {
        id: requestId,
        salonId,
        listId: inUseId,
        createdByUserId: userId,
        requestedCount: 30,
        geographicRange: 'منطقه',
        status: 'SUBMITTED',
        reservedUntil: new Date('2030-01-01T00:00:00.000Z'),
        submittedAt,
        updatedAt: now,
      },
    });
    const syntheticId = await createList({ name: 'منطقه‌ای خارج از مجموعه', status: 'ACTIVE', regionCode: '03', createdAt: new Date('2025-01-01T00:00:00.000Z') });
    const [greaterId, lesserId] = [randomUUID(), randomUUID()].sort().reverse() as [string, string];
    const pairAt = new Date('2020-06-01T00:00:00.000Z');
    await createList({ id: greaterId, name: 'مرز بزرگ', regionCode: '02', createdAt: pairAt });
    await createList({ id: lesserId, name: 'مرز کوچک', regionCode: '02', createdAt: pairAt });
    const oldestId = await createList({ name: 'قدیمی', regionCode: '02', createdAt: new Date('2020-01-01T00:00:00.000Z') });
    const fillerIds: string[] = [];
    for (let index = 0; index < 46; index += 1) {
      fillerIds.push(await createList({
        name: `پرکننده ${index}`,
        regionCode: '02',
        createdAt: new Date(Date.UTC(2023, 0, 1, 0, index)),
      }));
    }

    const members = [pendingId, activeOriginalId, inUseId, greaterId, lesserId, oldestId, ...fillerIds];
    const manifest: ManifestRow[] = [
      { id: pendingId, regionCode: '04', status: 'PENDING', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
      { id: activeOriginalId, regionCode: '03', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
      { id: inUseId, regionCode: '05', status: 'IN_USE', recordedContacts: 1, contactRows: 1, reservedBySalonId: salonId, vipRequests: 1 },
      { id: greaterId, regionCode: '02', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
      { id: lesserId, regionCode: '02', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
      { id: oldestId, regionCode: '02', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 },
      ...fillerIds.map((id) => ({ id, regionCode: '02', status: 'ACTIVE', recordedContacts: 1, contactRows: 1, reservedBySalonId: '', vipRequests: 0 })),
    ];
    const beforeUpdate = await prisma.client.vipTargetList.findUniqueOrThrow({
      where: { id: inUseId },
      select: { updatedAt: true, status: true, reservedAt: true },
    });
    const auditsBefore = await auditCount();
    const first = await classify(manifest);
    expect(first.unchanged).toBe(false);
    expect(first.listCount).toBe(members.length);
    expect(first.contactRowCount).toBe(members.length);
    const second = await classify(manifest);
    expect(second.unchanged).toBe(true);
    expect(await auditCount()).toBe(auditsBefore + 1);
    const afterUpdate = await prisma.client.vipTargetList.findUniqueOrThrow({
      where: { id: inUseId },
      select: { updatedAt: true, status: true, reservedAt: true, catalogMembership: true },
    });
    expect(afterUpdate.catalogMembership).toBe('ORIGINAL_TEHRAN');
    expect(afterUpdate.status).toBe('IN_USE');
    expect(afterUpdate.updatedAt.toISOString()).toBe(beforeUpdate.updatedAt.toISOString());
    expect(afterUpdate.reservedAt?.toISOString()).toBe(beforeUpdate.reservedAt?.toISOString());
    const storedRequest = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(storedRequest.status).toBe('SUBMITTED');
    expect(storedRequest.submittedAt?.toISOString()).toBe(submittedAt.toISOString());
    expect(storedRequest.listId).toBe(inUseId);

    const originalIds = new Set<string>();
    let originalCursor: string | undefined;
    let originalPages = 0;
    do {
      const response = await request(app.getHttpServer())
        .get('/admin/vip/lists')
        .query({ catalogMembership: 'ORIGINAL_TEHRAN', ...(originalCursor ? { cursor: originalCursor } : {}) })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      originalPages += 1;
      expect(response.body.listCount).toBe(members.length);
      expect(response.body.contactRowCount).toBe(members.length);
      expect(response.body.recordedContactCount).toBe(members.length);
      for (const item of response.body.items as Array<{ id: string; status: string }>) {
        originalIds.add(item.id);
      }
      if (originalPages === 1) {
        expect(response.body.items).toHaveLength(50);
        expect(response.body.hasMore).toBe(true);
        expect(response.body.items.at(-1).id).toBe(greaterId);
        expect(response.body.items.some((item: { id: string; status: string }) => item.id === pendingId && item.status === 'PENDING')).toBe(true);
        expect(response.body.items.some((item: { id: string; status: string }) => item.id === inUseId && item.status === 'IN_USE')).toBe(true);
      }
      originalCursor = response.body.nextCursor ?? undefined;
      if (response.body.hasMore) expect(originalCursor).toEqual(expect.any(String));
    } while (originalCursor);
    expect(originalIds).toEqual(new Set(members));
    expect(originalIds.has(syntheticId)).toBe(false);

    const all = await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const allIds = (all.body.items as Array<{ id: string }>).map((item) => item.id);
    expect(allIds).toContain(syntheticId);
    expect(allIds).toContain(activeOriginalId);
    expect(all.body.listCount).toBeGreaterThan(members.length);

    await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .query({ cursor: originalCursorFrom(all.body.nextCursor), catalogMembership: 'ORIGINAL_TEHRAN' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    const originalFirst = await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .query({ catalogMembership: 'ORIGINAL_TEHRAN' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .query({ cursor: originalFirst.body.nextCursor })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    const salonToken = await jwt.signAsync({ sub: userId, tid: salonId, role: 'OWNER' });
    await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .query({ catalogMembership: 'ORIGINAL_TEHRAN' })
      .set('Authorization', `Bearer ${salonToken}`)
      .expect(403);
    const salonLists = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03' })
      .set('Authorization', `Bearer ${salonToken}`)
      .expect(200);
    const salonIds = (salonLists.body.items as Array<{ id: string }>).map((item) => item.id);
    expect(salonIds).toEqual([syntheticId, activeOriginalId]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('VIP');
    sheet.addRow(['نام', 'شماره تلفن']);
    sheet.addRow(['ورود آزمایشی', '09123334444']);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const imported = await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `catalog-import-${randomUUID()}`)
      .attach('file', file, 'vip.xlsx')
      .expect(201);
    expect(imported.body.catalogMembership).toBeNull();
    const afterImport = await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((afterImport.body.items as Array<{ id: string }>).some((item) => item.id === imported.body.id)).toBe(true);
    const originalAfterImport = await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .query({ catalogMembership: 'ORIGINAL_TEHRAN' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((originalAfterImport.body.items as Array<{ id: string }>).some((item) => item.id === imported.body.id)).toBe(false);
    expect(originalAfterImport.body.listCount).toBe(members.length);
  });
});

function originalCursorFrom(cursor: string): string {
  return cursor;
}

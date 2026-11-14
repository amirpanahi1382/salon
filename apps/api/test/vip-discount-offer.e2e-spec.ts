import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';
import { createPlatformAdminSession, createProductOwnerSession } from './support/phone-account';

const databaseUrl = process.env.DATABASE_URL ?? '';
const dedicatedUrl = process.env.VIP_DISCOUNT_DISPOSABLE_DATABASE_URL ?? '';
const disposableTarget = (() => {
  if (!databaseUrl || !dedicatedUrl || databaseUrl !== dedicatedUrl) return null;
  if (process.env.OTPY_API_KEY || process.env.BALE_SAFIR_API_ACCESS_KEY) return null;
  try {
    const parsed = new URL(databaseUrl);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    const forbiddenPorts = new Set(['5432', '15442', '15490']);
    if (parsed.hostname !== '127.0.0.1' || !parsed.port || forbiddenPorts.has(parsed.port)) return null;
    if (name === 'salon' || name === 'salon_preview' || name === 'salon-db' || name === 'phone_first_product') return null;
    if (!/^salon_vip_discount_[a-z0-9]+$/.test(name)) return null;
    return { name, token: name.slice('salon_vip_discount_'.length) };
  } catch {
    return null;
  }
})();
const describeIf = disposableTarget ? describe : describe.skip;

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0xff, 0xc4, 0x00, 0x14,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9,
]);

async function vipXlsx(count: number, prefix: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('VIP');
  sheet.addRow(['نام', 'شماره تلفن']);
  for (let i = 0; i < count; i += 1) {
    sheet.addRow([`مخاطب ${i + 1}`, `${prefix}${String(i).padStart(7, '0')}`]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describeIf('VIP discount offer serving path (audit)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

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
    const identity = await prisma.client.$queryRaw<Array<{ name: string; comment: string | null; sysid: string }>>`
      SELECT current_database() AS name,
             shobj_description(oid, 'pg_database') AS comment,
             (SELECT system_identifier::text FROM pg_control_system()) AS sysid
      FROM pg_database
      WHERE datname = current_database()
    `;
    const row = identity[0];
    if (
      !disposableTarget
      || row?.name !== disposableTarget.name
      || row.comment !== `vip-discount-disposable:${disposableTarget.token}`
      || row.sysid === '7700113693112733735'
    ) {
      throw new Error('Refusing discount serving-path tests without this run’s disposable database');
    }
    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), { name: 'Discount Ops' });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function readyList(count: number, prefix: string): Promise<string> {
    const imported = await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', randomUUID())
      .attach('file', await vipXlsx(count, prefix), 'vip.xlsx')
      .expect(201);
    const listId = imported.body.id as string;
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '04' })
      .expect(200);
    return listId;
  }

  async function entitleOwner(label: string) {
    const owner = await createProductOwnerSession(prisma.client, app.getHttpServer(), { salonName: label });
    await request(app.getHttpServer())
      .post('/admin/vip/entitlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ salonId: owner.salonId })
      .expect(201);
    return owner;
  }

  function create(owner: Awaited<ReturnType<typeof createProductOwnerSession>>, body: Record<string, unknown>, key = randomUUID()) {
    return request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);
  }

  it('persists none, percent, and rial offers into the immutable recipient snapshot', async () => {
    const noneOwner = await entitleOwner('None Offer');
    const noneList = await readyList(30, '0917');
    const noneKey = randomUUID();
    const none = await create(noneOwner, {
      listId: noneList,
      requestedCount: 30,
      geographicRange: 'ونک',
    }, noneKey);
    expect(none.status).toBe(201);
    expect(none.body.discountKind).toBeNull();
    expect(none.body.discountAmount).toBeNull();
    const noneRecipients = await prisma.client.vipRequestRecipient.findMany({ where: { vipRequestId: none.body.id } });
    expect(noneRecipients).toHaveLength(30);
    expect(noneRecipients.every((row) => row.messageText.includes('نمونه کارها خدمتتون ارسال شده.') && !row.messageText.includes('تخفیف'))).toBe(true);
    const replayNone = await create(noneOwner, {
      listId: noneList,
      requestedCount: 30,
      geographicRange: 'ونک',
      discountKind: 'PERCENT',
      discountAmount: '20',
    }, noneKey);
    expect(replayNone.status).toBe(409);

    const percentOwner = await entitleOwner('Percent Offer');
    const percentList = await readyList(30, '0918');
    const percent = await create(percentOwner, {
      listId: percentList,
      requestedCount: 30,
      geographicRange: 'ونک',
      discountKind: 'PERCENT',
      discountAmount: '20',
    });
    expect(percent.status).toBe(201);
    expect(percent.body.discountKind).toBe('PERCENT');
    expect(percent.body.discountAmount).toBe('20');
    const percentRow = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: percent.body.id } });
    expect(percentRow.discountKind).toBe('PERCENT');
    expect(String(percentRow.discountAmount)).toBe('20');
    const percentText = (await prisma.client.vipRequestRecipient.findFirstOrThrow({ where: { vipRequestId: percent.body.id } })).messageText;
    expect(percentText).toContain('این پیام با ۲۰٪ تخفیف است.');

    const rialOwner = await entitleOwner('Rial Offer');
    const rialList = await readyList(30, '0919');
    const rial = await create(rialOwner, {
      listId: rialList,
      requestedCount: 30,
      geographicRange: 'ونک',
      discountKind: 'RIAL',
      discountAmount: '50000.00',
    });
    expect(rial.status).toBe(201);
    expect(rial.body.discountKind).toBe('RIAL');
    expect(rial.body.discountAmount).toBe('50000.00');
    const rialText = (await prisma.client.vipRequestRecipient.findFirstOrThrow({ where: { vipRequestId: rial.body.id } })).messageText;
    expect(rialText).toContain('این پیام با ۵۰۰۰۰.۰۰ ریال تخفیف است.');

    await request(app.getHttpServer())
      .post(`/vip/requests/${rial.body.id}/sample-works`)
      .set('Authorization', `Bearer ${rialOwner.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .attach('file', JPEG, 'sample.jpg')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/vip/requests/${rial.body.id}/submit`)
      .set('Authorization', `Bearer ${rialOwner.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${rial.body.id}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const queued = await prisma.client.messageRequest.findFirstOrThrow({
      where: { vipRequestId: rial.body.id },
    });
    expect(queued.messageText).toContain('این پیام با ۵۰۰۰۰.۰۰ ریال تخفیف است.');
    expect(queued.messageText).toBe(rialText);
    const audits = await prisma.client.auditLog.findMany({
      where: { resourceId: { in: [none.body.id, percent.body.id, rial.body.id] } },
    });
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(queued.messageText);
    expect(serialized).not.toContain('0919');
  });

  it('rejects invalid percent, rial precision, and money bounds', async () => {
    const owner = await entitleOwner('Invalid Offer');
    const listId = await readyList(30, '0920');
    const base = { listId, requestedCount: 30, geographicRange: 'ونک' };
    expect((await create(owner, { ...base, discountKind: 'PERCENT', discountAmount: '0' })).status).toBe(400);
    expect((await create(owner, { ...base, discountKind: 'PERCENT', discountAmount: '101' })).status).toBe(400);
    expect((await create(owner, { ...base, discountKind: 'PERCENT', discountAmount: '20.5' })).status).toBe(400);
    expect((await create(owner, { ...base, discountKind: 'RIAL', discountAmount: '0.00' })).status).toBe(400);
    expect((await create(owner, { ...base, discountKind: 'RIAL', discountAmount: '-1.00' })).status).toBe(400);
    expect((await create(owner, { ...base, discountKind: 'RIAL', discountAmount: '1.001' })).status).toBe(400);
    expect((await create(owner, { ...base, discountKind: 'RIAL', discountAmount: '1' })).status).toBe(201);
  });
});

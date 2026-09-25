import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import {
  VIP_QUOTA_MAX,
  VIP_QUOTA_WINDOW_DAYS,
  VIP_REGION_CATALOG,
  VIP_REGION_CODES,
} from '@salon/shared';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';
const adminPassword = 'platform-admin-pass';

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0xff, 0xc4, 0x00, 0x14,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9,
]);

async function vipXlsx(count: number, prefix = '0912'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('VIP');
  sheet.addRow(['نام', 'شماره تلفن']);
  for (let i = 0; i < count; i += 1) {
    sheet.addRow([`مشتری ${i + 1}`, `${prefix}${String(i).padStart(7, '0')}`]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describeIfDb('VIP outreach (e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const adminEmail = `vip-platform-${Date.now()}@example.test`;
    await prisma.client.platformAdmin.create({
      data: {
        id: randomUUID(),
        email: adminEmail,
        name: 'Ops',
        passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
        updatedAt: new Date(),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOwner(label: string) {
    const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
    const salonId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    await prisma.client.salon.create({
      data: { id: salonId, name: `${label} Salon`, updatedAt: now },
    });
    await prisma.client.user.create({
      data: {
        id: userId,
        salonId,
        name: `${label} Owner`,
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'OWNER',
        updatedAt: now,
      },
    });
    const accessToken = await jwt.signAsync({
      sub: userId,
      tid: salonId,
      role: 'OWNER',
    });
    return {
      token: accessToken,
      userId,
      tenantId: salonId,
    };
  }

  async function grantVip(salonId: string) {
    await request(app.getHttpServer())
      .post('/admin/vip/entitlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `grant-${salonId}-${Date.now()}`)
      .send({ salonId })
      .expect(201);
  }

  async function importList(count: number, prefix?: string) {
    const file = await vipXlsx(count, prefix);
    const response = await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `import-${randomUUID()}`)
      .attach('file', file, 'vip.xlsx')
      .expect(201);
    return response.body.id as string;
  }

  async function importPhoneOnlyList(count: number, prefix = '0938') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('VIP');
    sheet.addRow(['شماره تلفن']);
    for (let i = 0; i < count; i += 1) {
      sheet.addRow([`${prefix}${String(i).padStart(7, '0')}`]);
    }
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const response = await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `import-phone-only-${randomUUID()}`)
      .attach('file', file, 'vip.xlsx')
      .expect(201);
    return response.body.id as string;
  }

  it('rejects salon access to admin VIP endpoints and non-VIP salon VIP APIs', async () => {
    const salon = await createOwner('vip-deny');
    await request(app.getHttpServer())
      .get('/admin/vip/lists')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/vip/lists')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(403);
    const capability = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(capability.body.entitled).toBe(false);
  });

  it('rejects the entire import when Excel has more than 100 rows', async () => {
    await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `import-too-big-${randomUUID()}`)
      .attach('file', await vipXlsx(101), 'vip.xlsx')
      .expect(400);
  });

  it('imports a phone-only list, snapshots null names, and completes sample-work', async () => {
    const salon = await createOwner('vip-unnamed');
    await grantVip(salon.tenantId);
    const listId = await importPhoneOnlyList(30, '0938');
    const detail = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.contactCount).toBe(30);
    expect(detail.body.contacts).toHaveLength(30);
    expect(detail.body.contacts.every((row: { displayName: string | null }) => row.displayName === null)).toBe(
      true,
    );

    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    await prisma.client.vipTargetList.update({
      where: { id: listId },
      data: { regionCode: '02' },
    });

    const lists = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '02' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(lists.body.items.some((row: { id: string }) => row.id === listId)).toBe(true);

    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `unnamed-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'ونک' })
      .expect(201);
    const requestId = created.body.id as string;
    const recipients = await prisma.client.vipRequestRecipient.findMany({
      where: { vipRequestId: requestId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(recipients).toHaveLength(30);
    expect(recipients.every((row) => row.displayName === null)).toBe(true);
    expect(recipients[0]?.messageText).toBe(
      'نمونه کارها خدمتتون ارسال شده. ما در محدوده ونک تا حالا سعادت حضور شما را نداشتیم و برای رزرو با من تماس بگیرید.',
    );
    expect(recipients[0]?.messageText).not.toContain('عزیز');

    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/sample-works`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `unnamed-img-${randomUUID()}`)
      .attach('file', JPEG, 'work.jpg')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `unnamed-sub-${randomUUID()}`)
      .expect(201);

    const exported = await request(app.getHttpServer())
      .get(`/admin/vip/requests/${requestId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk as Buffer));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as Buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(2).getCell(1).value == null || sheet.getRow(2).getCell(1).value === '').toBe(true);
    expect(String(sheet.getRow(2).getCell(2).value)).toMatch(/^0938/);
  });

  it('rejects unknown JSON fields', async () => {
    const salon = await createOwner('vip-unknown');
    await grantVip(salon.tenantId);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `create-${randomUUID()}`)
      .send({ listId: randomUUID(), requestedCount: 30, geographicRange: 'ونک', extra: true })
      .expect(400);
  });

  it('completes admin import, salon reservation, sample work, export, and manual dispatch', async () => {
    const salon = await createOwner('vip-happy');
    const other = await createOwner('vip-other');
    await grantVip(salon.tenantId);
    const listId = await importList(30, '0913');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'لیست ونک', availability: 'ACTIVE' })
      .expect(200);

    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `create-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'ونک' })
      .expect(201);
    const requestId = created.body.id as string;
    expect(created.body.status).toBe('AWAITING_SAMPLE_WORK');
    expect(created.body.geographicRange).toBe('ونک');

    await request(app.getHttpServer())
      .get(`/vip/requests/${requestId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/sample-works`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `img-${randomUUID()}`)
      .attach('file', JPEG, 'work.jpg')
      .expect(201);

    const submitted = await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `submit-${randomUUID()}`)
      .expect(201);
    expect(submitted.body.status).toBe('SUBMITTED');
    expect(submitted.body.sampleWorks).toHaveLength(1);

    const adminList = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminList.body.attentionRequestId).toBe(requestId);
    expect(adminList.body.request.salonId).toBe(salon.tenantId);
    expect(adminList.body.request.geographicRange).toBe('ونک');

    const imageId = submitted.body.sampleWorks[0].id as string;
    await request(app.getHttpServer())
      .get(`/admin/vip/sample-works/${imageId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/admin/vip/sample-works/${imageId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(403);

    const exported = await request(app.getHttpServer())
      .get(`/admin/vip/requests/${requestId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');

    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-bale`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `bale-${randomUUID()}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe('BALE_NOT_IMPLEMENTED');
      });
    expect(
      await prisma.client.messageDelivery.count({
        where: { salonId: salon.tenantId, mode: 'BALE' },
      }),
    ).toBe(0);

    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `manual-${randomUUID()}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe('MANUAL_QUEUED');
      });

    const queued = await prisma.client.messageRequest.count({
      where: { salonId: salon.tenantId, vipRequestId: requestId, status: 'QUEUED' },
    });
    expect(queued).toBe(30);
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-bale`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `bale-after-manual-${randomUUID()}`)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `manual-replay-${randomUUID()}`)
      .expect(201)
      .expect((res) => expect(res.body.status).toBe('MANUAL_QUEUED'));
    expect(await prisma.client.messageRequest.count({ where: { salonId: salon.tenantId, vipRequestId: requestId } })).toBe(30);
    const snapshot = await prisma.client.vipRequestRecipient.findFirst({
      where: { vipRequestId: requestId },
    });
    expect(snapshot?.messageText).toContain('ونک');
    expect(snapshot?.messageText).toContain('عزیز');
  });

  it('keeps one manual VIP dispatch under concurrent manual and Bale commands', async () => {
    const salon = await createOwner('vip-dispatch-race');
    await grantVip(salon.tenantId);
    const listId = await importList(30, '0916');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `race-create-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'race test' })
      .expect(201);
    const requestId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/sample-works`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `race-image-${randomUUID()}`)
      .attach('file', JPEG, 'work.jpg')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `race-submit-${randomUUID()}`)
      .expect(201);

    const results = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `race-manual-${randomUUID()}`),
      request(app.getHttpServer())
        .post(`/admin/vip/requests/${requestId}/dispatch-bale`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `race-bale-${randomUUID()}`),
    ]);
    expect(results.every((response) => [201, 409].includes(response.status))).toBe(true);
    const final = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(final.status).toBe('MANUAL_QUEUED');
    expect(await prisma.client.messageRequest.count({ where: { vipRequestId: requestId } })).toBe(30);
    expect(await prisma.client.outboxEvent.count({ where: { eventType: 'MessageRequested', payload: { path: ['vipRequestId'], equals: requestId } } })).toBe(30);
    const dispatchAudits = await prisma.client.auditLog.findMany({
      where: { resource: 'vip_request', resourceId: requestId, action: 'VIP_DISPATCH_SELECTED' },
    });
    expect(dispatchAudits.filter((entry) => (entry.metadata as { mode?: string } | null)?.mode === 'MANUAL')).toHaveLength(1);
  });

  it('lets only one of two concurrent 100-count requests consume quota', async () => {
    const salon = await createOwner('vip-quota');
    await grantVip(salon.tenantId);
    const listA = await importList(100, '0914');
    const listB = await importList(100, '0915');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listA}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listB}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `q1-${randomUUID()}`)
        .send({ listId: listA, requestedCount: 100, geographicRange: 'جردن' }),
      request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `q2-${randomUUID()}`)
        .send({ listId: listB, requestedCount: 100, geographicRange: 'جردن' }),
    ]);
    const statuses = responses.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 201]);
  });

  it('lets only one of two concurrent 100-count requests consume remaining quota of 100', async () => {
    const salon = await createOwner('vip-quota-remain');
    await grantVip(salon.tenantId);
    const usedLists = await Promise.all(
      Array.from({ length: 4 }, (_, index) => importList(100, `096${index}`)),
    );
    const raced = await Promise.all([importList(100, '0964'), importList(100, '0965')]);
    for (const listId of [...usedLists, ...raced]) {
      await request(app.getHttpServer())
        .patch(`/admin/vip/lists/${listId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ availability: 'ACTIVE' })
        .expect(200);
    }
    for (const [index, listId] of usedLists.entries()) {
      await request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `pre-${index}-${randomUUID()}`)
        .send({ listId, requestedCount: 100, geographicRange: 'جردن' })
        .expect(201);
    }
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `r1-${randomUUID()}`)
        .send({ listId: raced[0], requestedCount: 100, geographicRange: 'جردن' }),
      request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `r2-${randomUUID()}`)
        .send({ listId: raced[1], requestedCount: 100, geographicRange: 'جردن' }),
    ]);
    const statuses = responses.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('lets only one salon reserve the same ACTIVE list', async () => {
    const salons = await Promise.all(
      Array.from({ length: 4 }, (_, index) => createOwner(`vip-race-${index}`)),
    );
    await Promise.all(salons.map((salon) => grantVip(salon.tenantId)));
    const listId = await importList(30, '0916');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);

    const responses = await Promise.all(
      salons.map((salon) =>
        request(app.getHttpServer())
          .post('/vip/requests')
          .set('Authorization', `Bearer ${salon.token}`)
          .set('Idempotency-Key', `race-${salon.tenantId}-${randomUUID()}`)
          .send({ listId, requestedCount: 30, geographicRange: 'سعادت‌آباد' }),
      ),
    );
    expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 409)).toHaveLength(3);
    expect(responses.every((res) => res.status === 201 || res.status === 409)).toBe(true);
  });

  it('replays identical VIP request idempotency keys without duplicating quota', async () => {
    const salon = await createOwner('vip-idem');
    await grantVip(salon.tenantId);
    const listId = await importList(30, '0917');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    const key = `same-${randomUUID()}`;
    const body = { listId, requestedCount: 30, geographicRange: 'پاسداران' };
    const first = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(second.body.id).toBe(first.body.id);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send({ ...body, geographicRange: 'دیگر' })
      .expect(409);
    expect(
      await prisma.client.vipRequest.count({
        where: { salonId: salon.tenantId, status: { not: 'CANCELLED' } },
      }),
    ).toBe(1);
  });

  it('imports exactly 100 rows and rejects a non-xlsx filename', async () => {
    const listId = await importList(100, '0920');
    const detail = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.contactCount).toBe(100);
    await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `import-fake-${randomUUID()}`)
      .attach('file', await vipXlsx(2, '0921'), 'vip.exe')
      .expect(400);
  });

  it('enforces sequential rolling 7-day quota of 500: 5x100 ok then 30 rejected', async () => {
    const salon = await createOwner('vip-quota-seq');
    await grantVip(salon.tenantId);
    const cap = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(cap.body.quotaMax).toBe(VIP_QUOTA_MAX);
    expect(cap.body.quotaWindowDays).toBe(VIP_QUOTA_WINDOW_DAYS);
    expect(cap.body.remainingQuota).toBe(VIP_QUOTA_MAX);
    expect(cap.body.usedQuota).toBe(0);

    const lists = await Promise.all(
      Array.from({ length: 6 }, (_, index) => importList(index === 5 ? 30 : 100, `097${index}`)),
    );
    for (const listId of lists) {
      await request(app.getHttpServer())
        .patch(`/admin/vip/lists/${listId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ availability: 'ACTIVE' })
        .expect(200);
    }
    for (let index = 0; index < 5; index += 1) {
      await request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `qs${index}-${randomUUID()}`)
        .send({ listId: lists[index], requestedCount: 100, geographicRange: 'ونک' })
        .expect(201);
    }
    const exhausted = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(exhausted.body.remainingQuota).toBe(0);
    expect(exhausted.body.usedQuota).toBe(VIP_QUOTA_MAX);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `qs5-${randomUUID()}`)
      .send({ listId: lists[5], requestedCount: 30, geographicRange: 'ونک' })
      .expect(409);

    const salonB = await createOwner('vip-quota-470');
    await grantVip(salonB.tenantId);
    const used = await Promise.all([
      ...Array.from({ length: 4 }, (_, index) => importList(100, `098${index}`)),
      importList(50, '0984'),
      importList(30, '0985'),
      importList(50, '0986'),
      importList(30, '0987'),
    ]);
    for (const listId of used) {
      await request(app.getHttpServer())
        .patch(`/admin/vip/lists/${listId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ availability: 'ACTIVE' })
        .expect(200);
    }
    const sequential = [
      { listId: used[0], count: 100 },
      { listId: used[1], count: 100 },
      { listId: used[2], count: 100 },
      { listId: used[3], count: 100 },
      { listId: used[4], count: 50 },
      { listId: used[5], count: 30 },
    ];
    for (const [index, item] of sequential.entries()) {
      await request(app.getHttpServer())
        .post('/vip/requests')
        .set('Authorization', `Bearer ${salonB.token}`)
        .set('Idempotency-Key', `q470-${index}-${randomUUID()}`)
        .send({ listId: item.listId, requestedCount: item.count, geographicRange: 'ونک' })
        .expect(201);
    }
    const mid = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(mid.body.usedQuota).toBe(480);
    expect(mid.body.remainingQuota).toBe(20);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salonB.token}`)
      .set('Idempotency-Key', `q470-deny50-${randomUUID()}`)
      .send({ listId: used[6], requestedCount: 50, geographicRange: 'ونک' })
      .expect(409);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salonB.token}`)
      .set('Idempotency-Key', `q470-deny30-${randomUUID()}`)
      .send({ listId: used[7], requestedCount: 30, geographicRange: 'ونک' })
      .expect(409);

    const salonC = await createOwner('vip-quota-window');
    await grantVip(salonC.tenantId);
    const windowList = await importList(100, '0988');
    const laterList = await importList(100, '0989');
    for (const listId of [windowList, laterList]) {
      await request(app.getHttpServer())
        .patch(`/admin/vip/lists/${listId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ availability: 'ACTIVE' })
        .expect(200);
    }
    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salonC.token}`)
      .set('Idempotency-Key', `qwin-${randomUUID()}`)
      .send({ listId: windowList, requestedCount: 100, geographicRange: 'ونک' })
      .expect(201);
    await prisma.client.vipRequest.update({
      where: { id: created.body.id },
      data: { createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000) },
    });
    const afterWindow = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${salonC.token}`)
      .expect(200);
    expect(afterWindow.body.usedQuota).toBe(0);
    expect(afterWindow.body.remainingQuota).toBe(VIP_QUOTA_MAX);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salonC.token}`)
      .set('Idempotency-Key', `qwin2-${randomUUID()}`)
      .send({ listId: laterList, requestedCount: 100, geographicRange: 'ونک' })
      .expect(201);
  });

  it('lets only one of ten salons reserve the same ACTIVE list', async () => {
    const salons: Awaited<ReturnType<typeof createOwner>>[] = [];
    for (let index = 0; index < 10; index += 1) {
      salons.push(await createOwner(`vip-race10-${index}`));
    }
    await Promise.all(salons.map((salon) => grantVip(salon.tenantId)));
    const listId = await importList(30, '0927');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);

    const responses = await Promise.all(
      salons.map((salon) =>
        request(app.getHttpServer())
          .post('/vip/requests')
          .set('Authorization', `Bearer ${salon.token}`)
          .set('Idempotency-Key', `race10-${salon.tenantId}-${randomUUID()}`)
          .send({ listId, requestedCount: 30, geographicRange: 'سعادت‌آباد' }),
      ),
    );
    expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 409)).toHaveLength(9);
    expect(responses.every((res) => res.status === 201 || res.status === 409)).toBe(true);
    const holders = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(holders.status).toBe('IN_USE');
    expect(holders.reservedBySalonId).toBeTruthy();
  });

  it('releases an expired reservation without stealing a newer one', async () => {
    const first = await createOwner('vip-expire-a');
    const second = await createOwner('vip-expire-b');
    await grantVip(first.tenantId);
    await grantVip(second.tenantId);
    const listId = await importList(30, '0928');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${first.token}`)
      .set('Idempotency-Key', `exp-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'ونک' })
      .expect(201);
    await prisma.client.vipRequest.update({
      where: { id: created.body.id as string },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    const reclaimed = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${second.token}`)
      .set('Idempotency-Key', `exp2-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'ونک' })
      .expect(201);
    expect(reclaimed.body.id).not.toBe(created.body.id);
    const expired = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: created.body.id as string },
    });
    expect(expired.status).toBe('CANCELLED');
    await prisma.client.vipRequest.update({
      where: { id: created.body.id as string },
      data: { reservedUntil: new Date(Date.now() - 120_000) },
    });
    await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200);
    const list = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(list.status).toBe('IN_USE');
    expect(list.reservedBySalonId).toBe(second.tenantId);
  });

  it('requires 1–3 sample images and keeps historical export text after list edits', async () => {
    const salon = await createOwner('vip-samples');
    await grantVip(salon.tenantId);
    const listId = await importList(30, '0929');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'نام اولیه', availability: 'ACTIVE' })
      .expect(200);
    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `smp-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'محدوده تاریخی' })
      .expect(201);
    const requestId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `sub0-${randomUUID()}`)
      .expect(400);

    for (let i = 0; i < 3; i += 1) {
      const bytes = Buffer.from(JPEG);
      bytes[bytes.length - 3] = i;
      await request(app.getHttpServer())
        .post(`/vip/requests/${requestId}/sample-works`)
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `img-${i}-${randomUUID()}`)
        .attach('file', bytes, `work-${i}.jpg`)
        .expect(201);
    }
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/sample-works`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `img-4-${randomUUID()}`)
      .attach('file', JPEG, 'work-4.jpg')
      .expect(400);

    const submitKey = `sub-${randomUUID()}`;
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', submitKey)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', submitKey)
      .expect(201);
    expect(
      await prisma.client.outboxEvent.count({
        where: { tenantId: salon.tenantId, eventType: 'VipRequestSubmitted' },
      }),
    ).toBe(1);

    const snapshotBefore = await prisma.client.vipRequestRecipient.findFirstOrThrow({
      where: { vipRequestId: requestId, sortOrder: 1 },
    });
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'نام عوض‌شده' })
      .expect(200);
    await prisma.client.vipTargetContact.updateMany({
      where: { listId },
      data: { displayName: 'نام جعلی بعدی' },
    });
    const exported = await request(app.getHttpServer())
      .get(`/admin/vip/requests/${requestId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on('data', (chunk) => data.push(chunk as Buffer));
        res.on('end', () => callback(null, Buffer.concat(data)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as Buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).getCell(1).value).toBe('نام');
    expect(sheet.getRow(1).getCell(2).value).toBe('شماره تلفن');
    expect(sheet.getRow(1).getCell(3).value).toBe('تمپلیت');
    expect(String(sheet.getRow(2).getCell(1).value)).toBe(snapshotBefore.displayName);
    expect(String(sheet.getRow(2).getCell(3).value)).toBe(snapshotBefore.messageText);
    expect(String(sheet.getRow(2).getCell(3).value)).toContain('محدوده تاریخی');
    expect(String(sheet.getRow(2).getCell(1).value)).not.toBe('نام جعلی بعدی');

    const dispatchKey = `man-${randomUUID()}`;
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', dispatchKey)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', dispatchKey)
      .expect(201);
    expect(
      await prisma.client.messageRequest.count({
        where: { vipRequestId: requestId },
      }),
    ).toBe(30);
    expect(
      await prisma.client.outboxEvent.count({
        where: { tenantId: salon.tenantId, eventType: 'MessageRequested' },
      }),
    ).toBe(30);
  });

  async function awaitingWithSample(label: string, prefix: string) {
    const salon = await createOwner(label);
    await grantVip(salon.tenantId);
    const listId = await importList(30, prefix);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `ttl-${randomUUID()}`)
      .send({ listId, requestedCount: 30, geographicRange: 'ونک' })
      .expect(201);
    const requestId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/sample-works`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `ttl-img-${randomUUID()}`)
      .attach('file', JPEG, 'work.jpg')
      .expect(201);
    return { salon, requestId };
  }

  it('rejects submit after reservation expiry and does not resurrect cancelled requests', async () => {
    const { salon, requestId } = await awaitingWithSample('vip-ttl-exp', '0935');
    await prisma.client.vipRequest.update({
      where: { id: requestId },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    const key = `sub-exp-${randomUUID()}`;
    const expired = await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .expect(409);
    expect(expired.body.message).toMatch(/expired|cannot be submitted/i);
    const row = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.status).toBe('CANCELLED');
    expect(row.submittedAt).toBeNull();
    expect(
      await prisma.client.outboxEvent.count({
        where: { tenantId: salon.tenantId, eventType: 'VipRequestSubmitted' },
      }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `sub-exp-2-${randomUUID()}`)
      .expect(409);
    const again = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(again.status).toBe('CANCELLED');
    expect(again.submittedAt).toBeNull();
  });

  it('lets unexpired submit succeed and serializes concurrent submit', async () => {
    const { salon, requestId } = await awaitingWithSample('vip-ttl-ok', '0936');
    const key = `sub-ok-${randomUUID()}`;
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .expect(201);
    expect(
      await prisma.client.outboxEvent.count({
        where: { tenantId: salon.tenantId, eventType: 'VipRequestSubmitted' },
      }),
    ).toBe(1);

    const second = await awaitingWithSample('vip-ttl-race', '0937');
    const raced = await Promise.all([
      request(app.getHttpServer())
        .post(`/vip/requests/${second.requestId}/submit`)
        .set('Authorization', `Bearer ${second.salon.token}`)
        .set('Idempotency-Key', `race-a-${randomUUID()}`),
      request(app.getHttpServer())
        .post(`/vip/requests/${second.requestId}/submit`)
        .set('Authorization', `Bearer ${second.salon.token}`)
        .set('Idempotency-Key', `race-b-${randomUUID()}`),
    ]);
    const codes = raced.map((res) => res.status).sort();
    expect(codes).toEqual([201, 409]);
    expect(raced.every((res) => res.status === 201 || res.status === 409)).toBe(true);
    expect(
      await prisma.client.outboxEvent.count({
        where: { tenantId: second.salon.tenantId, eventType: 'VipRequestSubmitted' },
      }),
    ).toBe(1);
    const submitted = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: second.requestId },
    });
    expect(submitted.status).toBe('SUBMITTED');
  });

  it('does not submit when expiry races the submit CAS', async () => {
    const { salon, requestId } = await awaitingWithSample('vip-ttl-vs', '0938');
    await prisma.client.vipRequest.update({
      where: { id: requestId },
      data: { reservedUntil: new Date(Date.now() - 1_000) },
    });
    const results = await Promise.all([
      request(app.getHttpServer())
        .get('/vip/capability')
        .set('Authorization', `Bearer ${salon.token}`),
      request(app.getHttpServer())
        .post(`/vip/requests/${requestId}/submit`)
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `vs-${randomUUID()}`),
    ]);
    expect(results[0].status).toBe(200);
    expect(results[1].status).toBe(409);
    const row = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.status).toBe('CANCELLED');
    expect(row.submittedAt).toBeNull();
  });

  it('rejects Admin Queue Bale for VIP MessageRequests and leaves MANUAL available', async () => {
    const { salon, requestId } = await awaitingWithSample('vip-queue-bale', '0939');
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `qb-sub-${randomUUID()}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `qb-man-${randomUUID()}`)
      .expect(201);
    const vipMessage = await prisma.client.messageRequest.findFirstOrThrow({
      where: { vipRequestId: requestId, status: 'QUEUED' },
    });
    const queueItem = await request(app.getHttpServer())
      .get(`/admin/message-queue/${vipMessage.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(queueItem.body.vipRequestId).toBe(requestId);

    const baleAttempts = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/message-queue/${vipMessage.id}/select-bale`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app.getHttpServer())
        .post(`/admin/message-queue/${vipMessage.id}/select-bale`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app.getHttpServer())
        .post(`/admin/message-queue/${vipMessage.id}/retry`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(baleAttempts.every((res) => res.status === 409)).toBe(true);
    expect(baleAttempts[0].body.message).toBe('Bale is not available for VIP outreach');
    expect(
      await prisma.client.messageDelivery.count({
        where: { messageRequestId: vipMessage.id },
      }),
    ).toBe(0);
    expect(
      await prisma.client.messageDelivery.count({
        where: { salonId: salon.tenantId, mode: 'BALE' },
      }),
    ).toBe(0);
    const stillQueued = await prisma.client.messageRequest.findUniqueOrThrow({
      where: { id: vipMessage.id },
    });
    expect(stillQueued.status).toBe('QUEUED');

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${vipMessage.id}/select-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.mode).toBe('MANUAL');
      });
  });

  it('returns 14 canonical regions and filters ACTIVE regional lists', async () => {
    const salon = await createOwner('vip-region-a');
    const other = await createOwner('vip-region-b');
    await grantVip(salon.tenantId);
    await grantVip(other.tenantId);

    const region01Active = await importList(65, '0940');
    const region01Other = await importList(30, '0941');
    const region02Active = await importList(74, '0942');
    const region11Pending = await importList(28, '0943');
    const region14Pending = await importList(27, '0944');
    const unnamedHistorical = await importList(30, '0945');
    const inUseRegional = await importList(30, '0946');
    const inactiveRegional = await importList(30, '0947');

    await prisma.client.vipTargetList.update({
      where: { id: region01Active },
      data: { name: 'e2e-region-01-a', regionCode: '01' },
    });
    await prisma.client.vipTargetList.update({
      where: { id: region01Other },
      data: { name: 'e2e-region-01-b', regionCode: '01' },
    });
    await prisma.client.vipTargetList.update({
      where: { id: region02Active },
      data: { name: 'e2e-region-02-a', regionCode: '02' },
    });
    await prisma.client.vipTargetList.update({
      where: { id: region11Pending },
      data: { name: 'e2e-region-11-pending', regionCode: '11' },
    });
    await prisma.client.vipTargetList.update({
      where: { id: region14Pending },
      data: { name: 'e2e-region-14-pending', regionCode: '14' },
    });
    await prisma.client.vipTargetList.update({
      where: { id: inUseRegional },
      data: { regionCode: '01' },
    });
    await prisma.client.vipTargetList.update({
      where: { id: inactiveRegional },
      data: { regionCode: '01' },
    });

    for (const listId of [region01Active, region01Other, region02Active, unnamedHistorical, inUseRegional]) {
      await request(app.getHttpServer())
        .patch(`/admin/vip/lists/${listId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ availability: 'ACTIVE' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${inactiveRegional}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${inactiveRegional}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'INACTIVE' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${other.token}`)
      .set('Idempotency-Key', `in-use-${randomUUID()}`)
      .send({ listId: inUseRegional, requestedCount: 30, geographicRange: 'ونک' })
      .expect(201);

    const beforeBrowse = {
      lists: await prisma.client.vipTargetList.count(),
      requests: await prisma.client.vipRequest.count({ where: { salonId: salon.tenantId } }),
    };

    const denied = await createOwner('vip-region-deny');
    await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${denied.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '01' })
      .set('Authorization', `Bearer ${denied.token}`)
      .expect(403);

    const regions = await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(regions.body.items).toHaveLength(14);
    expect(regions.body.items.map((row: { regionCode: string }) => row.regionCode)).toEqual([
      ...VIP_REGION_CODES,
    ]);
    for (const row of regions.body.items as Array<{
      regionCode: keyof typeof VIP_REGION_CATALOG;
      regionName: string;
      availableListCount: number;
      availableContactCount: number;
    }>) {
      expect(row.regionName).toBe(VIP_REGION_CATALOG[row.regionCode]);
      expect(row).not.toHaveProperty('phoneNumber');
      expect(row).not.toHaveProperty('contacts');
    }
    const region01 = regions.body.items.find((row: { regionCode: string }) => row.regionCode === '01');
    const region02 = regions.body.items.find((row: { regionCode: string }) => row.regionCode === '02');
    const region11 = regions.body.items.find((row: { regionCode: string }) => row.regionCode === '11');
    const region14 = regions.body.items.find((row: { regionCode: string }) => row.regionCode === '14');
    expect(region01.availableListCount).toBeGreaterThanOrEqual(2);
    expect(region01.availableContactCount).toBeGreaterThanOrEqual(95);
    expect(region02.availableListCount).toBeGreaterThanOrEqual(1);
    expect(region11.availableListCount).toBe(0);
    expect(region11.availableContactCount).toBe(0);
    expect(region14.availableListCount).toBe(0);
    expect(region14.availableContactCount).toBe(0);

    const listed01 = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '01' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const ids01 = listed01.body.items.map((row: { id: string }) => row.id);
    expect(ids01).toEqual(expect.arrayContaining([region01Active, region01Other]));
    expect(ids01).not.toContain(region02Active);
    expect(ids01).not.toContain(unnamedHistorical);
    expect(ids01).not.toContain(inUseRegional);
    expect(ids01).not.toContain(inactiveRegional);
    expect(ids01).not.toContain(region11Pending);
    expect(listed01.body.items.every((row: { regionCode: string }) => row.regionCode === '01')).toBe(
      true,
    );
    expect(listed01.body.items[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        regionCode: '01',
        regionName: VIP_REGION_CATALOG['01'],
        contactCount: expect.any(Number),
        status: 'ACTIVE',
        createdAt: expect.any(String),
      }),
    );
    expect(JSON.stringify(listed01.body)).not.toMatch(/09\d{9}/);

    const listed02 = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '02' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const ids02 = listed02.body.items.map((row: { id: string }) => row.id);
    expect(ids02).toContain(region02Active);
    expect(ids02).not.toContain(region01Active);

    await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '11' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toEqual([]);
      });
    await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '14' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toEqual([]);
      });

    await request(app.getHttpServer())
      .get('/vip/lists')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '99' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(400);

    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `pending-11-${randomUUID()}`)
      .send({ listId: region11Pending, requestedCount: 30, geographicRange: 'ونک' })
      .expect(409);

    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `too-big-${randomUUID()}`)
      .send({ listId: region01Active, requestedCount: 100, geographicRange: 'ونک' })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `ok-65-${randomUUID()}`)
      .send({ listId: region01Active, requestedCount: 50, geographicRange: VIP_REGION_CATALOG['01'] })
      .expect(201);
    expect(created.body.listId).toBe(region01Active);

    const stale = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${other.token}`)
      .set('Idempotency-Key', `stale-${randomUUID()}`)
      .send({ listId: region01Active, requestedCount: 50, geographicRange: 'ونک' })
      .expect(409);
    expect(stale.body.message).toBe('This VIP list is not available');

    const afterBrowse = {
      lists: await prisma.client.vipTargetList.count(),
      requests: await prisma.client.vipRequest.count({ where: { salonId: salon.tenantId } }),
    };
    expect(afterBrowse.lists).toBe(beforeBrowse.lists);
    expect(afterBrowse.requests).toBe(beforeBrowse.requests + 1);
  });

  async function activate(listId: string) {
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
  }

  async function submitVip(owner: { token: string }, listId: string, count: 30 | 50 | 100, geo: string) {
    const created = await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', `create-${randomUUID()}`)
      .send({ listId, requestedCount: count, geographicRange: geo })
      .expect(201);
    const requestId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/sample-works`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', `img-${randomUUID()}`)
      .attach('file', JPEG, 'work.jpg')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/vip/requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', `submit-${randomUUID()}`)
      .expect(201);
    return requestId;
  }

  it('groups admin VIP outreach by salon and keeps request identity', async () => {
    const stamp = `${Date.now()}`;
    const salonA = await createOwner(`folder-a-${stamp}`);
    const salonB = await createOwner(`folder-b-${stamp}`);
    await grantVip(salonA.tenantId);
    await grantVip(salonB.tenantId);
    await prisma.client.salon.update({
      where: { id: salonA.tenantId },
      data: { name: `FolderA ${stamp}` },
    });
    await prisma.client.salon.update({
      where: { id: salonB.tenantId },
      data: { name: `FolderB ${stamp}` },
    });

    const listA1 = await importList(30, '0950');
    const listA2 = await importList(30, '0951');
    const listA3 = await importList(30, '0952');
    const listB1 = await importList(30, '0953');
    await Promise.all([listA1, listA2, listA3, listB1].map((id) => activate(id)));
    await prisma.client.vipTargetList.update({
      where: { id: listA1 },
      data: { regionCode: '01' },
    });

    const r1 = await submitVip(salonA, listA1, 30, 'ونک');
    const r2 = await submitVip(salonA, listA2, 30, 'جردن');
    const r3 = await submitVip(salonA, listA3, 30, 'پاسداران');
    const b1 = await submitVip(salonB, listB1, 30, 'صادقیه');

    const denied = await createOwner(`folder-deny-${stamp}`);
    await request(app.getHttpServer())
      .get('/admin/vip/outreach/salons')
      .set('Authorization', `Bearer ${denied.token}`)
      .expect(403);

    const folders = await request(app.getHttpServer())
      .get('/admin/vip/outreach/salons')
      .query({ q: stamp })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(folders.body.items).toHaveLength(2);
    expect(folders.body.hasMore).toBe(false);
    const ids = folders.body.items.map((row: { salonId: string }) => row.salonId).sort();
    expect(ids).toEqual([salonA.tenantId, salonB.tenantId].sort());
    const folderA = folders.body.items.find((row: { salonId: string }) => row.salonId === salonA.tenantId);
    const folderB = folders.body.items.find((row: { salonId: string }) => row.salonId === salonB.tenantId);
    expect(folderA.salonName).toBe(`FolderA ${stamp}`);
    expect(folderA.requestCount).toBe(3);
    expect(folderA.recipientCount).toBe(90);
    expect(folderA.pendingMessageCount).toBe(90);
    expect(folderA.sentMessageCount).toBe(0);
    expect(folderA.failedMessageCount).toBe(0);
    expect(folderB.requestCount).toBe(1);
    expect(folderB.recipientCount).toBe(30);

    await prisma.client.salon.update({
      where: { id: salonA.tenantId },
      data: { name: `FolderA-renamed ${stamp}` },
    });
    const renamed = await request(app.getHttpServer())
      .get('/admin/vip/outreach/salons')
      .query({ q: `FolderA-renamed ${stamp}` })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(renamed.body.items).toHaveLength(1);
    expect(renamed.body.items[0].salonName).toBe(`FolderA-renamed ${stamp}`);

    const first = folders.body.items[0];
    const secondPage = await request(app.getHttpServer())
      .get('/admin/vip/outreach/salons')
      .query({ q: stamp, cursor: folders.body.nextCursor ?? undefined })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    if (folders.body.nextCursor) {
      expect(secondPage.body.items.some((row: { salonId: string }) => row.salonId === first.salonId)).toBe(
        false,
      );
    }

    const detailA = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/salons/${salonA.tenantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detailA.body.salonId).toBe(salonA.tenantId);
    expect(detailA.body.items).toHaveLength(3);
    const detailIds = detailA.body.items.map((row: { id: string }) => row.id).sort();
    expect(detailIds).toEqual([r1, r2, r3].sort());
    expect(detailA.body.items.every((row: { salonId: string }) => row.salonId === salonA.tenantId)).toBe(
      true,
    );
    expect(detailA.body.items.some((row: { id: string }) => row.id === b1)).toBe(false);
    const regional = detailA.body.items.find((row: { id: string }) => row.id === r1);
    expect(regional.regionCode).toBe('01');
    expect(regional.regionName).toBe(VIP_REGION_CATALOG['01']);
    expect(regional.displayTitle).toContain('منطقه 01');
    expect(regional.requestOrdinal).toBeGreaterThanOrEqual(1);
    expect(regional.requestedCount).toBe(30);
    expect(regional.recipientCount).toBe(30);
    expect(regional.notYetQueuedCount).toBe(30);
    expect(regional.canDispatchManual).toBe(true);
    expect(regional.listId).toBe(listA1);

    const detailB = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/salons/${salonB.tenantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detailB.body.items).toHaveLength(1);
    expect(detailB.body.items[0].id).toBe(b1);

    const salonView = await request(app.getHttpServer())
      .get(`/vip/requests/${r1}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(salonView.body.id).toBe(r1);
    expect(salonView.body.salonId).toBe(salonA.tenantId);
    expect(salonView.body.listId).toBe(listA1);
    expect(salonView.body.requestedCount).toBe(30);
    expect(salonView.body.status).toBe('SUBMITTED');

    const requestDetail = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/requests/${r1}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(requestDetail.body.request.id).toBe(r1);
    expect(requestDetail.body.items).toHaveLength(30);
    expect(requestDetail.body.items[0].phoneNumber).toMatch(/^0950/);
    expect(requestDetail.body.items[0].executionState).toBe('NOT_YET_QUEUED');
    expect(requestDetail.body.items[0].messageRequestId).toBeNull();
    expect(requestDetail.body.items[0]).not.toHaveProperty('messageText');

    await request(app.getHttpServer())
      .get(`/admin/vip/outreach/requests/${r1}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(403);
  });

  it('reuses dispatch and keeps admin, salon, and DB message state aligned', async () => {
    const stamp = `${Date.now()}`;
    const salon = await createOwner(`folder-exec-${stamp}`);
    await grantVip(salon.tenantId);
    await prisma.client.salon.update({
      where: { id: salon.tenantId },
      data: { name: `Exec ${stamp}` },
    });
    const listId = await importList(30, '0954');
    await activate(listId);
    const requestId = await submitVip(salon, listId, 30, 'ونک');

    const before = await prisma.client.messageRequest.count({
      where: { vipRequestId: requestId },
    });
    expect(before).toBe(0);
    const recipientBeforeDispatch = await prisma.client.vipRequestRecipient.findFirstOrThrow({
      where: { vipRequestId: requestId }, orderBy: { sortOrder: 'asc' },
    });
    await prisma.client.vipTargetContact.update({
      where: { id: recipientBeforeDispatch.sourceContactId },
      data: { phoneNumber: '09129990000' },
    });
    expect((await prisma.client.vipRequestRecipient.findUniqueOrThrow({
      where: { id: recipientBeforeDispatch.id },
    })).phoneNumber).toBe(recipientBeforeDispatch.phoneNumber);

    const key = `manual-${randomUUID()}`;
    const dispatched = await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .expect(201);
    expect(dispatched.body.status).toBe('MANUAL_QUEUED');
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .expect(201);
    const competing = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `other-${randomUUID()}`),
      request(app.getHttpServer())
        .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `other-${randomUUID()}`),
    ]);
    expect(competing.every((res) => res.status === 201 || res.status === 409)).toBe(true);

    const messages = await prisma.client.messageRequest.findMany({
      where: { vipRequestId: requestId },
      select: { id: true, salonId: true, vipRequestId: true, customerId: true, recipientPhoneNumber: true },
    });
    const recipients = await prisma.client.vipRequestRecipient.findMany({ where: { vipRequestId: requestId } });
    const byMessageId = new Map(messages.map((row) => [row.id, row]));
    expect(messages).toHaveLength(30);
    expect(new Set(messages.map((row) => row.recipientPhoneNumber)).size).toBe(30);
    expect(recipients).toHaveLength(30);
    for (const recipient of recipients) {
      const message = byMessageId.get(recipient.messageRequestId ?? '');
      expect(message).toMatchObject({
        salonId: salon.tenantId,
        vipRequestId: requestId,
        customerId: null,
        recipientPhoneNumber: recipient.phoneNumber,
      });
    }
    expect(byMessageId.get(recipients.find((row) => row.id === recipientBeforeDispatch.id)?.messageRequestId ?? '')?.recipientPhoneNumber)
      .toBe(recipientBeforeDispatch.phoneNumber);

    const folder = await request(app.getHttpServer())
      .get('/admin/vip/outreach/salons')
      .query({ q: `Exec ${stamp}` })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(folder.body.items[0].pendingMessageCount).toBe(30);
    expect(folder.body.items[0].sentMessageCount).toBe(0);

    const firstMessage = messages[0];
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${firstMessage.id}/select-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${firstMessage.id}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const afterSent = await request(app.getHttpServer())
      .get('/admin/vip/outreach/salons')
      .query({ q: `Exec ${stamp}` })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(afterSent.body.items[0].sentMessageCount).toBe(1);
    expect(afterSent.body.items[0].pendingMessageCount).toBe(29);
    expect(afterSent.body.items[0].failedMessageCount).toBe(0);

    const requestDetail = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/requests/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const sentRow = requestDetail.body.items.find(
      (row: { messageRequestId: string | null }) => row.messageRequestId === firstMessage.id,
    );
    expect(sentRow.executionState).toBe('SENT');
    const queuedRow = requestDetail.body.items.find(
      (row: { executionState: string }) => row.executionState === 'QUEUED',
    );
    expect(queuedRow).toBeTruthy();

    const workspace = await request(app.getHttpServer())
      .get('/opportunities/workspace')
      .query({ filter: 'VIP' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const workspaceSent = workspace.body.items.find(
      (row: { messageRequestId?: string }) => row.messageRequestId === firstMessage.id,
    );
    expect(workspaceSent.messageState).toBe('SENT');
    const dbDelivery = await prisma.client.messageDelivery.findFirst({
      where: { messageRequestId: firstMessage.id },
    });
    expect(dbDelivery?.status).toBe('SENT');
    expect(dbDelivery?.submittedAt).not.toBeNull();
  });

  it('marks a queued VIP recipient sent without a second status and cancels without deleting provenance', async () => {
    const stamp = `${Date.now()}`;
    const salon = await createOwner(`folder-cancel-${stamp}`);
    await grantVip(salon.tenantId);
    const listId = await importList(30, '0955');
    await activate(listId);
    const requestId = await submitVip(salon, listId, 30, 'ونک');

    const beforeDispatch = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/requests/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(beforeDispatch.body.items[0].executionState).toBe('NOT_YET_QUEUED');
    expect(beforeDispatch.body.items[0].canMarkManualSent).toBe(false);
    expect(beforeDispatch.body.items[0].canCancel).toBe(false);

    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `disp-${randomUUID()}`)
      .expect(201);

    const queued = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/requests/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const first = queued.body.items[0];
    const second = queued.body.items[1];
    expect(first.executionState).toBe('QUEUED');
    expect(first.canMarkManualSent).toBe(true);
    expect(first.canCancel).toBe(true);
    expect(first.messageRequestId).toBeTruthy();

    const marked = await request(app.getHttpServer())
      .post(`/admin/message-queue/${first.messageRequestId}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(marked.body.status).toBe('SENT');
    expect(marked.body.canMarkManualSent).toBe(false);
    const replay = await request(app.getHttpServer())
      .post(`/admin/message-queue/${first.messageRequestId}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(replay.body.status).toBe('SENT');
    expect(replay.body.submittedAt).toBe(marked.body.submittedAt);
    expect(
      await prisma.client.messageDelivery.count({
        where: { messageRequestId: first.messageRequestId },
      }),
    ).toBe(1);

    const cancelled = await request(app.getHttpServer())
      .post(`/admin/message-queue/${second.messageRequestId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${second.messageRequestId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${second.messageRequestId}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const recipient = await prisma.client.vipRequestRecipient.findFirstOrThrow({
      where: { messageRequestId: second.messageRequestId },
    });
    expect(recipient.vipRequestId).toBe(requestId);
    const requestRow = await prisma.client.messageRequest.findFirstOrThrow({
      where: { id: second.messageRequestId },
    });
    expect(requestRow.vipRequestId).toBe(requestId);
    expect(requestRow.status).toBe('CANCELLED');

    const after = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/requests/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(after.body.request.sentCount).toBe(1);
    expect(after.body.request.cancelledCount).toBe(1);
    expect(after.body.request.recipientCount).toBe(30);
    const cancelledRow = after.body.items.find(
      (row: { messageRequestId: string }) => row.messageRequestId === second.messageRequestId,
    );
    expect(cancelledRow.executionState).toBe('CANCELLED');
    expect(cancelledRow.canCancel).toBe(false);
  });
});

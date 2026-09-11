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
    const snapshot = await prisma.client.vipRequestRecipient.findFirst({
      where: { vipRequestId: requestId },
    });
    expect(snapshot?.messageText).toContain('ونک');
    expect(snapshot?.messageText).toContain('عزیز');
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

  it('enforces sequential 14-day quota: 50+50 ok, then 30 rejected; 100 then 30 rejected', async () => {
    const salon = await createOwner('vip-quota-seq');
    await grantVip(salon.tenantId);
    const lists = await Promise.all([
      importList(50, '0922'),
      importList(50, '0923'),
      importList(30, '0924'),
    ]);
    for (const listId of lists) {
      await request(app.getHttpServer())
        .patch(`/admin/vip/lists/${listId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ availability: 'ACTIVE' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `qs1-${randomUUID()}`)
      .send({ listId: lists[0], requestedCount: 50, geographicRange: 'ونک' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `qs2-${randomUUID()}`)
      .send({ listId: lists[1], requestedCount: 50, geographicRange: 'ونک' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `qs3-${randomUUID()}`)
      .send({ listId: lists[2], requestedCount: 30, geographicRange: 'ونک' })
      .expect(409);

    const salonB = await createOwner('vip-quota-100');
    await grantVip(salonB.tenantId);
    const full = await importList(100, '0925');
    const extra = await importList(30, '0926');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${full}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${extra}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salonB.token}`)
      .set('Idempotency-Key', `q100-${randomUUID()}`)
      .send({ listId: full, requestedCount: 100, geographicRange: 'ونک' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salonB.token}`)
      .set('Idempotency-Key', `q30-${randomUUID()}`)
      .send({ listId: extra, requestedCount: 30, geographicRange: 'ونک' })
      .expect(409);

    const salonC = await createOwner('vip-quota-60');
    await grantVip(salonC.tenantId);
    const sixty = await Promise.all([
      importList(30, '0930'),
      importList(30, '0931'),
      importList(50, '0932'),
    ]);
    for (const listId of sixty) {
      await request(app.getHttpServer())
        .patch(`/admin/vip/lists/${listId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ availability: 'ACTIVE' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salonC.token}`)
      .set('Idempotency-Key', `q60a-${randomUUID()}`)
      .send({ listId: sixty[0], requestedCount: 30, geographicRange: 'ونک' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salonC.token}`)
      .set('Idempotency-Key', `q60b-${randomUUID()}`)
      .send({ listId: sixty[1], requestedCount: 30, geographicRange: 'ونک' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salonC.token}`)
      .set('Idempotency-Key', `q60c-${randomUUID()}`)
      .send({ listId: sixty[2], requestedCount: 50, geographicRange: 'ونک' })
      .expect(409);
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
});

import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  VIP_ONE_ACTIVE_DRAFT_MESSAGE,
  VIP_QUOTA_EXCEEDED_MESSAGE,
  VIP_QUOTA_MAX,
  VIP_QUOTA_WINDOW_DAYS,
} from '@salon/shared';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';

const databaseUrl = process.env.DATABASE_URL;
const disposableTarget = (() => {
  if (!databaseUrl) return null;
  try {
    const parsed = new URL(databaseUrl);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    const forbiddenPorts = new Set(['5432', '15442']);
    if (parsed.hostname !== '127.0.0.1' || parsed.port === '' || forbiddenPorts.has(parsed.port)) return null;
    if (name === 'salon' || name === 'salon_preview') return null;
    if (!/^salon_vip_multi_[a-z0-9]+$/.test(name)) return null;
    return { name, token: name.slice('salon_vip_multi_'.length) };
  } catch {
    return null;
  }
})();
const describeIfDb = disposableTarget ? describe : describe.skip;
const password = 'correct-horse-battery';
const adminPassword = 'platform-admin-pass';
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function vipXlsx(count: number, prefix: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('VIP');
  sheet.addRow(['نام', 'شماره تلفن']);
  for (let i = 0; i < count; i += 1) {
    sheet.addRow([`مشتری ${i + 1}`, `${prefix}${String(i).padStart(7, '0')}`]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describeIfDb('VIP multiple requests and rolling quota (e2e)', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let jwt: JwtService;
  let phoneSerial = 20;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
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
    const identity = await prisma.client.$queryRaw<Array<{ name: string; comment: string | null }>>`
      SELECT current_database() AS name,
             shobj_description(oid, 'pg_database') AS comment
      FROM pg_database
      WHERE datname = current_database()
    `;
    const row = identity[0];
    if (
      !disposableTarget ||
      row?.name !== disposableTarget.name ||
      row.comment !== `vip-multi-disposable:${disposableTarget.token}`
    ) {
      throw new Error('Refusing VIP multiple-request tests without this run’s disposable database');
    }
    jwt = app.get(JwtService);
    const adminEmail = `vip-multi-${Date.now()}@example.test`;
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
    await app?.close();
  });

  function nextPrefix() {
    phoneSerial += 1;
    return `09${String(phoneSerial).padStart(2, '0')}`;
  }

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
    const token = await jwt.signAsync({ sub: userId, tid: salonId, role: 'OWNER' });
    return { token, userId, tenantId: salonId };
  }

  async function grantVip(salonId: string) {
    await request(app.getHttpServer())
      .post('/admin/vip/entitlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `grant-${randomUUID()}`)
      .send({ salonId })
      .expect(201);
  }

  async function readyList(count: number) {
    const file = await vipXlsx(count, nextPrefix());
    const response = await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `import-${randomUUID()}`)
      .attach('file', file, 'vip.xlsx')
      .expect(201);
    const listId = response.body.id as string;
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    await prisma.client.vipTargetList.update({
      where: { id: listId },
      data: { catalogMembership: 'ORIGINAL_TEHRAN', regionCode: '03' },
    });
    return listId;
  }

  async function createRequest(
    owner: { token: string },
    listId: string,
    count: number,
    key = randomUUID(),
  ) {
    return request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', key)
      .send({ listId, requestedCount: count, geographicRange: 'سعادت‌آباد' });
  }

  async function submitRequest(owner: { token: string }, requestId: string) {
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
  }

  async function acceptSubmitted(owner: { token: string; tenantId: string }, count: number) {
    const listId = await readyList(count);
    const created = await createRequest(owner, listId, count);
    expect(created.status).toBe(201);
    const requestId = created.body.id as string;
    await submitRequest(owner, requestId);
    expect(
      await prisma.client.vipRequest.count({
        where: { salonId: owner.tenantId, status: 'AWAITING_SAMPLE_WORK' },
      }),
    ).toBe(0);
    return { requestId, listId };
  }

  async function dispatchManual(requestId: string) {
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `manual-${randomUUID()}`)
      .expect(201);
  }

  async function dispatchBale(requestId: string) {
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-bale`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `bale-${randomUUID()}`)
      .expect(201);
  }

  async function expectRejectedCreateLeavesNoResidue(
    owner: { tenantId: string },
    listId: string,
    key: string,
    committed: { requests: number; audits: number; outbox: number },
  ) {
    const list = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(list.status).toBe('ACTIVE');
    expect(list.reservedBySalonId).toBeNull();
    expect(list.reservedAt).toBeNull();
    expect(await prisma.client.vipRequest.count({ where: { salonId: owner.tenantId } })).toBe(committed.requests);
    expect(await prisma.client.vipRequest.count({ where: { listId } })).toBe(0);
    expect(
      await prisma.client.vipRequestRecipient.count({ where: { vipRequest: { listId } } }),
    ).toBe(0);
    expect(
      await prisma.client.idempotencyRecord.count({ where: { tenantId: owner.tenantId, key } }),
    ).toBe(0);
    expect(
      await prisma.client.auditLog.count({
        where: { tenantId: owner.tenantId, action: 'VIP_REQUEST_CREATED' },
      }),
    ).toBe(committed.audits);
    expect(
      await prisma.client.outboxEvent.count({
        where: { tenantId: owner.tenantId, eventType: 'VipRequestCreated' },
      }),
    ).toBe(committed.outbox);
    expect(
      await prisma.client.vipRequest.count({
        where: { salonId: owner.tenantId, status: 'AWAITING_SAMPLE_WORK' },
      }),
    ).toBe(0);
  }

  async function used(salonId: string) {
    const rows = await prisma.client.$queryRaw<Array<{ total: number }>>`
      SELECT COALESCE(SUM(requested_count), 0)::int AS total
      FROM vip_requests
      WHERE salon_id = ${salonId}::uuid
        AND status <> 'CANCELLED'
        AND created_at >= NOW() - (${VIP_QUOTA_WINDOW_DAYS} * INTERVAL '1 day')
    `;
    return rows[0]?.total ?? 0;
  }

  it('accepts 30, 50, and 100 and rejects other sizes', async () => {
    const owner = await createOwner('sizes');
    await grantVip(owner.tenantId);
    for (const count of [30, 50, 100] as const) {
      const accepted = await acceptSubmitted(owner, count);
      const stored = await prisma.client.vipRequest.findUniqueOrThrow({
        where: { id: accepted.requestId },
      });
      expect(stored.status).toBe('SUBMITTED');
      expect(stored.requestedCount).toBe(count);
    }
    const rejected = await createRequest(owner, await readyList(30), 20);
    expect(rejected.status).toBe(400);
  });

  it('keeps a submitted request in history and allows another request with remaining quota', async () => {
    const owner = await createOwner('history');
    await grantVip(owner.tenantId);
    const firstList = await readyList(100);
    const created = await createRequest(owner, firstList, 100);
    expect(created.status).toBe(201);
    await submitRequest(owner, created.body.id as string);
    const capability = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(capability.body.currentRequest).toBeNull();
    expect(capability.body.activeDraft).toBeNull();
    expect(capability.body.usedQuota).toBe(100);
    expect(capability.body.remainingQuota).toBe(400);
    expect(capability.body.allowedRequestCounts).toEqual([30, 50, 100]);
    expect(capability.body.inProgressRequestsHasMore).toBe(false);
    expect(capability.body.inProgressRequests).toEqual([
      expect.objectContaining({
        id: created.body.id,
        status: 'SUBMITTED',
        requestedCount: 100,
        sampleWorks: [],
      }),
    ]);
    expect(JSON.stringify(capability.body.inProgressRequests)).not.toContain('phoneNumber');
    const secondList = await readyList(100);
    const second = await createRequest(owner, secondList, 100);
    expect(second.status).toBe(201);
    const firstStored = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: firstList } });
    const secondStored = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: secondList } });
    expect(firstStored.status).toBe('IN_USE');
    expect(secondStored.status).toBe('IN_USE');
    expect(firstStored.reservedBySalonId).toBe(owner.tenantId);
    expect(secondStored.reservedBySalonId).toBe(owner.tenantId);
    for (const requestId of [created.body.id as string, second.body.id as string]) {
      expect(await prisma.client.vipRequestRecipient.count({ where: { vipRequestId: requestId } })).toBe(100);
    }
  });

  it('rejects a second draft and a concurrent second draft', async () => {
    const owner = await createOwner('one-draft');
    await grantVip(owner.tenantId);
    const first = await createRequest(owner, await readyList(30), 30);
    expect(first.status).toBe(201);
    const second = await createRequest(owner, await readyList(30), 30);
    expect(second.status).toBe(409);
    expect(second.body.message).toBe(VIP_ONE_ACTIVE_DRAFT_MESSAGE);
    const racing = await createOwner('draft-race');
    await grantVip(racing.tenantId);
    const left = await readyList(30);
    const right = await readyList(30);
    const [a, b] = await Promise.all([
      createRequest(racing, left, 30),
      createRequest(racing, right, 30),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect([a, b].find((row) => row.status === 409)?.body.message).toBe(VIP_ONE_ACTIVE_DRAFT_MESSAGE);
    expect(
      await prisma.client.vipRequest.count({
        where: { salonId: racing.tenantId, status: 'AWAITING_SAMPLE_WORK' },
      }),
    ).toBe(1);
  });

  it('lets two salons each hold one active draft', async () => {
    const left = await createOwner('draft-left');
    const right = await createOwner('draft-right');
    await grantVip(left.tenantId);
    await grantVip(right.tenantId);
    const first = await createRequest(left, await readyList(30), 30);
    const second = await createRequest(right, await readyList(30), 30);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(
      await prisma.client.vipRequest.count({
        where: {
          salonId: { in: [left.tenantId, right.tenantId] },
          status: 'AWAITING_SAMPLE_WORK',
        },
      }),
    ).toBe(2);
  });

  it('lets an expired draft be replaced and releases only that list', async () => {
    const owner = await createOwner('expiry');
    await grantVip(owner.tenantId);
    const staleList = await readyList(30);
    const created = await createRequest(owner, staleList, 30);
    expect(created.status).toBe(201);
    // Timestamp only. The next create runs reservation expiry and cancels this draft.
    await prisma.client.vipRequest.update({
      where: { id: created.body.id as string },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    const replacementList = await readyList(30);
    const next = await createRequest(owner, replacementList, 30);
    expect(next.status).toBe(201);
    const stale = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: created.body.id as string },
    });
    expect(stale.status).toBe('CANCELLED');
    const released = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: staleList } });
    expect(released.status).toBe('ACTIVE');
    expect(released.reservedBySalonId).toBeNull();
    const held = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: replacementList } });
    expect(held.status).toBe('IN_USE');
  });

  it('counts submitted and processing requests and ignores cancelled and expired-window rows', async () => {
    const owner = await createOwner('statuses');
    await grantVip(owner.tenantId);
    const cancelledDraft = await createRequest(owner, await readyList(100), 100);
    expect(cancelledDraft.status).toBe(201);
    // Timestamp only. Capability then runs reservation expiry, which cancels the draft.
    await prisma.client.vipRequest.update({
      where: { id: cancelledDraft.body.id as string },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const cancelled = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: cancelledDraft.body.id as string },
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).not.toBeNull();
    const released = await prisma.client.vipTargetList.findUniqueOrThrow({
      where: { id: cancelledDraft.body.listId as string },
    });
    expect(released.status).toBe('ACTIVE');
    expect(released.reservedBySalonId).toBeNull();
    expect(await used(owner.tenantId)).toBe(0);
    const queued = await acceptSubmitted(owner, 30);
    await dispatchManual(queued.requestId);
    expect(
      (await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: queued.requestId } })).status,
    ).toBe('MANUAL_QUEUED');
    const blocked = await acceptSubmitted(owner, 30);
    await dispatchBale(blocked.requestId);
    expect(
      (await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: blocked.requestId } })).status,
    ).toBe('BALE_NOT_IMPLEMENTED');
    expect(await used(owner.tenantId)).toBe(60);
    const old = await acceptSubmitted(owner, 100);
    expect(
      (await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: old.requestId } })).status,
    ).toBe('SUBMITTED');
    // Window placement only. Submit already produced the SUBMITTED aggregate.
    await prisma.client.vipRequest.update({
      where: { id: old.requestId },
      data: { createdAt: new Date(Date.now() - (VIP_QUOTA_WINDOW_DAYS * DAY_MS + 60_000)) },
    });
    expect(await used(owner.tenantId)).toBe(60);
    const capability = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const evaluated = new Date(capability.body.quotaEvaluatedAt as string).getTime();
    const starts = new Date(capability.body.quotaWindowStartsAt as string).getTime();
    expect(evaluated - starts).toBe(VIP_QUOTA_WINDOW_DAYS * DAY_MS);
    const boundary = await acceptSubmitted(owner, 30);
    const since = new Date(capability.body.quotaWindowStartsAt as string);
    // Window placement only. Submit already produced the SUBMITTED aggregate.
    await prisma.client.vipRequest.update({
      where: { id: boundary.requestId },
      data: { createdAt: since },
    });
    const included = await prisma.client.$queryRaw<Array<{ total: number }>>`
      SELECT COALESCE(SUM(requested_count), 0)::int AS total
      FROM vip_requests
      WHERE salon_id = ${owner.tenantId}::uuid
        AND status <> 'CANCELLED'
        AND created_at >= ${since}
    `;
    expect(included[0]?.total).toBe(90);
    await prisma.client.vipRequest.update({
      where: { id: boundary.requestId },
      data: { createdAt: new Date(since.getTime() - 1) },
    });
    const excluded = await prisma.client.$queryRaw<Array<{ total: number }>>`
      SELECT COALESCE(SUM(requested_count), 0)::int AS total
      FROM vip_requests
      WHERE salon_id = ${owner.tenantId}::uuid
        AND status <> 'CANCELLED'
        AND created_at >= ${since}
    `;
    expect(excluded[0]?.total).toBe(60);
  });

  it('accepts a valid combination that reaches 500 and rejects the next request', async () => {
    const owner = await createOwner('full');
    await grantVip(owner.tenantId);
    for (let i = 0; i < 5; i += 1) {
      await acceptSubmitted(owner, 100);
    }
    expect(await used(owner.tenantId)).toBe(VIP_QUOTA_MAX);
    const overList = await readyList(30);
    const overKey = `over-500-${randomUUID()}`;
    const committed = {
      requests: await prisma.client.vipRequest.count({ where: { salonId: owner.tenantId } }),
      audits: await prisma.client.auditLog.count({
        where: { tenantId: owner.tenantId, action: 'VIP_REQUEST_CREATED' },
      }),
      outbox: await prisma.client.outboxEvent.count({
        where: { tenantId: owner.tenantId, eventType: 'VipRequestCreated' },
      }),
    };
    const over = await createRequest(owner, overList, 30, overKey);
    expect(over.status).toBe(409);
    expect(over.body.message).toBe(VIP_QUOTA_EXCEEDED_MESSAGE);
    expect(await used(owner.tenantId)).toBe(VIP_QUOTA_MAX);
    await expectRejectedCreateLeavesNoResidue(owner, overList, overKey, committed);
  });

  it('rejects 30 when 480 recipients are already consumed', async () => {
    const owner = await createOwner('near');
    await grantVip(owner.tenantId);
    for (const count of [100, 100, 100, 100, 50, 30] as const) {
      await acceptSubmitted(owner, count);
    }
    expect(await used(owner.tenantId)).toBe(480);
    const rejectedList = await readyList(30);
    const rejectedKey = `over-480-${randomUUID()}`;
    const committed = {
      requests: await prisma.client.vipRequest.count({ where: { salonId: owner.tenantId } }),
      audits: await prisma.client.auditLog.count({
        where: { tenantId: owner.tenantId, action: 'VIP_REQUEST_CREATED' },
      }),
      outbox: await prisma.client.outboxEvent.count({
        where: { tenantId: owner.tenantId, eventType: 'VipRequestCreated' },
      }),
    };
    const rejected = await createRequest(owner, rejectedList, 30, rejectedKey);
    expect(rejected.status).toBe(409);
    expect(rejected.body.message).toBe(VIP_QUOTA_EXCEEDED_MESSAGE);
    expect(await used(owner.tenantId)).toBe(480);
    await expectRejectedCreateLeavesNoResidue(owner, rejectedList, rejectedKey, committed);
  });

  it('does not double-count an idempotent replay', async () => {
    const owner = await createOwner('replay');
    await grantVip(owner.tenantId);
    const listId = await readyList(30);
    const key = `replay-${randomUUID()}`;
    const first = await createRequest(owner, listId, 30, key);
    const second = await createRequest(owner, listId, 30, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(
      await prisma.client.vipRequest.count({ where: { salonId: owner.tenantId } }),
    ).toBe(1);
    expect(await used(owner.tenantId)).toBe(30);
  });

  it('keeps one draft and the quota ceiling when two creates race, then rejects at the full quota', async () => {
    const owner = await createOwner('quota-race');
    await grantVip(owner.tenantId);
    for (let i = 0; i < 4; i += 1) {
      const held = await createRequest(owner, await readyList(100), 100);
      expect(held.status).toBe(201);
      await submitRequest(owner, held.body.id as string);
    }
    const left = await readyList(100);
    const right = await readyList(100);
    const leftKey = `race-left-${randomUUID()}`;
    const rightKey = `race-right-${randomUUID()}`;
    const [a, b] = await Promise.all([
      createRequest(owner, left, 100, leftKey),
      createRequest(owner, right, 100, rightKey),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const winner = a.status === 201 ? a : b;
    const loser = a.status === 409 ? a : b;
    const loserList = winner.body.listId === left ? right : left;
    const loserKey = winner.body.listId === left ? rightKey : leftKey;
    expect(loser.body.message).toBe(VIP_ONE_ACTIVE_DRAFT_MESSAGE);
    expect(await used(owner.tenantId)).toBe(500);
    expect(await prisma.client.vipRequest.count({ where: { salonId: owner.tenantId } })).toBe(5);
    const released = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: loserList } });
    expect(released.status).toBe('ACTIVE');
    expect(released.reservedBySalonId).toBeNull();
    expect(await prisma.client.vipRequest.count({ where: { listId: loserList } })).toBe(0);
    expect(await prisma.client.vipRequestRecipient.count({ where: { vipRequest: { listId: loserList } } })).toBe(0);
    expect(await prisma.client.idempotencyRecord.count({ where: { tenantId: owner.tenantId, key: loserKey } })).toBe(0);
    expect(
      await prisma.client.auditLog.count({
        where: { tenantId: owner.tenantId, action: 'VIP_REQUEST_CREATED' },
      }),
    ).toBe(5);
    expect(
      await prisma.client.outboxEvent.count({
        where: { tenantId: owner.tenantId, eventType: 'VipRequestCreated' },
      }),
    ).toBe(5);
    await submitRequest(owner, winner.body.id as string);
    const sequential = await createRequest(owner, await readyList(30), 30);
    expect(sequential.status).toBe(409);
    expect(sequential.body.message).toBe(VIP_QUOTA_EXCEEDED_MESSAGE);
    expect(await used(owner.tenantId)).toBe(500);
  });

  it('rolls back reservation, request, recipients, audit, outbox, and idempotency on failure', async () => {
    const owner = await createOwner('rollback');
    await grantVip(owner.tenantId);
    const listId = await readyList(30);
    const key = `rollback-${randomUUID()}`;
    const failed = await createRequest(owner, listId, 50, key);
    expect(failed.status).toBe(400);
    const list = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(list.status).toBe('ACTIVE');
    expect(list.reservedBySalonId).toBeNull();
    expect(await prisma.client.vipRequest.count({ where: { salonId: owner.tenantId } })).toBe(0);
    expect(await prisma.client.vipRequestRecipient.count({ where: { salonId: owner.tenantId } })).toBe(0);
    expect(
      await prisma.client.auditLog.count({
        where: { tenantId: owner.tenantId, action: 'VIP_REQUEST_CREATED' },
      }),
    ).toBe(0);
    expect(
      await prisma.client.outboxEvent.count({
        where: { tenantId: owner.tenantId, eventType: 'VipRequestCreated' },
      }),
    ).toBe(0);
    expect(
      await prisma.client.idempotencyRecord.count({
        where: { tenantId: owner.tenantId, key },
      }),
    ).toBe(0);
  });

  it('rejects a direct list that is not an active original unreserved list with capacity', async () => {
    const owner = await createOwner('bypass');
    await grantVip(owner.tenantId);
    const file = await vipXlsx(100, nextPrefix());
    const imported = await request(app.getHttpServer())
      .post('/admin/vip/lists/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `import-${randomUUID()}`)
      .attach('file', file, 'vip.xlsx')
      .expect(201);
    const listId = imported.body.id as string;
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE' })
      .expect(200);
    const unclassified = await createRequest(owner, listId, 30);
    expect(unclassified.status).toBe(409);
    expect(await prisma.client.vipRequest.count({ where: { listId } })).toBe(0);
    const winner = await createOwner('list-race-a');
    const loser = await createOwner('list-race-b');
    await grantVip(winner.tenantId);
    await grantVip(loser.tenantId);
    const shared = await readyList(30);
    const [a, b] = await Promise.all([
      createRequest(winner, shared, 30),
      createRequest(loser, shared, 30),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma.client.vipRequest.count({ where: { listId: shared } })).toBe(1);
  });

  it('keeps entitlement revocation, tenant isolation, and historical non-original reads', async () => {
    const owner = await createOwner('isolation');
    const other = await createOwner('other');
    await grantVip(owner.tenantId);
    await grantVip(other.tenantId);
    const listId = await readyList(30);
    const created = await createRequest(owner, listId, 30);
    expect(created.status).toBe(201);
    await prisma.client.vipTargetList.update({
      where: { id: listId },
      data: { catalogMembership: null },
    });
    await request(app.getHttpServer())
      .get(`/vip/requests/${created.body.id as string}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/vip/requests/${created.body.id as string}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/admin/vip/entitlements/${owner.tenantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `revoke-${randomUUID()}`)
      .expect(204);
    const blocked = await createRequest(owner, await readyList(30), 30);
    expect(blocked.status).toBe(403);
  });

  it('does not grant VIP entitlement during public registration', async () => {
    const email = `register-${Date.now()}@example.test`;
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: 'Registered Salon',
        ownerName: 'Registered Owner',
        email,
        password,
      })
      .expect(201);
    const tenantId = registered.body.user.tenantId as string;
    expect(
      await prisma.client.vipSalonEntitlement.count({ where: { salonId: tenantId } }),
    ).toBe(0);
    const capability = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${registered.body.accessToken as string}`)
      .expect(200);
    expect(capability.body.entitled).toBe(false);
    expect(capability.body.activeDraft).toBeNull();
    expect(capability.body.inProgressRequests).toEqual([]);
    expect(capability.body.inProgressRequestsHasMore).toBe(false);
  });

  it('returns a bounded in-progress summary without another salon’s requests', async () => {
    const owner = await createOwner('summary');
    const other = await createOwner('summary-other');
    await grantVip(owner.tenantId);
    await grantVip(other.tenantId);
    const ids: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      const accepted = await acceptSubmitted(owner, 30);
      ids.push(accepted.requestId);
    }
    const fewer = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(fewer.body.inProgressRequests).toHaveLength(9);
    expect(fewer.body.inProgressRequestsHasMore).toBe(false);
    const tenth = await acceptSubmitted(owner, 30);
    ids.push(tenth.requestId);
    const exact = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(exact.body.inProgressRequests).toHaveLength(10);
    expect(exact.body.inProgressRequestsHasMore).toBe(false);
    const eleventh = await acceptSubmitted(owner, 30);
    ids.push(eleventh.requestId);
    const otherRequest = await acceptSubmitted(other, 30);
    // Ordering only. Each aggregate was already submitted. No injected VIP clock exists.
    const sameInstant = new Date('2026-10-07T12:00:00.000Z');
    for (const id of ids) {
      await prisma.client.vipRequest.update({ where: { id }, data: { createdAt: sameInstant } });
    }
    const ordered = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(ordered.body.inProgressRequests).toHaveLength(10);
    expect(ordered.body.inProgressRequestsHasMore).toBe(true);
    const newest = [...ids].sort().reverse().slice(0, 10);
    expect(ordered.body.inProgressRequests.map((row: { id: string }) => row.id)).toEqual(newest);
    expect(newest).not.toContain(otherRequest.requestId);
    expect(ordered.body.inProgressRequests[0].sampleWorks).toEqual([]);
    const hidden = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(hidden.body.inProgressRequests.map((row: { id: string }) => row.id)).toEqual([
      otherRequest.requestId,
    ]);
    expect(hidden.body.inProgressRequestsHasMore).toBe(false);
    expect(hidden.body.inProgressRequests.every((row: { id: string }) => !ids.includes(row.id))).toBe(true);
  });
});

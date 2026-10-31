import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

const originalThrottleCanActivate = ThrottlerGuard.prototype.canActivate;
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  VIP_ONE_ACTIVE_DRAFT_MESSAGE,
  VIP_QUOTA_EXCEEDED_MESSAGE,
  VIP_QUOTA_MAX,
  VIP_QUOTA_WINDOW_DAYS,
} from '@salon/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';
import {
  createPlatformAdminSession,
  createProductOwnerSession,
  hashTestPassword,
  syntheticMobile,
} from './support/phone-account';

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
    ThrottlerGuard.prototype.canActivate = () => true;
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
    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), {
      name: 'Ops',
      password: adminPassword,
    });
    expect(admin.body.accountKind).toBe('PLATFORM_ADMIN');
    expect(admin.body.admin.id).toBe(admin.adminId);
    adminToken = admin.accessToken;
    await prisma.client.platformMessageStop.updateMany({
      where: { active: true },
      data: {
        active: false,
        liftedAt: new Date(),
        liftedByAdminId: admin.adminId,
      },
    });
  });

  afterAll(async () => {
    ThrottlerGuard.prototype.canActivate = originalThrottleCanActivate;
    await app?.close();
  });

  function nextPrefix() {
    phoneSerial += 1;
    const two = ((phoneSerial - 1) % 90) + 10;
    return `09${String(two).padStart(2, '0')}`;
  }

  async function createOwner(label: string) {
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
        phone: syntheticMobile(),
        passwordHash: await hashTestPassword(password),
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
      .send({ availability: 'ACTIVE', regionCode: '03' })
      .expect(200);
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
    const mismatched = await createRequest(owner, await readyList(30), 20);
    expect(mismatched.status).toBe(409);
    expect(mismatched.body.details).toMatchObject({
      usableContactCount: 30,
      effectiveRequestedCount: 30,
      packageGroup: 30,
    });
  });

  it('keeps a submitted request in history and allows another request with remaining quota', async () => {
    const owner = await createOwner('history');
    await grantVip(owner.tenantId);
    const firstList = await readyList(100);
    const created = await createRequest(owner, firstList, 100);
    expect(created.status).toBe(201);
    await submitRequest(owner, created.body.id as string);
    const sameList = await createRequest(owner, firstList, 100);
    expect(sameList.status).toBe(409);
    expect(sameList.body.message).toBe('This salon already has an active request for this VIP list');
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
    // Timestamp only. Capability is a read and must not cancel the draft.
    await prisma.client.vipRequest.update({
      where: { id: cancelledDraft.body.id as string },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    const capabilityBefore = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(capabilityBefore.body.usedQuota).toBe(0);
    const stillDraft = await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: cancelledDraft.body.id as string },
    });
    expect(stillDraft.status).toBe('AWAITING_SAMPLE_WORK');
    expect(stillDraft.cancelledAt).toBeNull();
    const { expireStaleVipReservations } = await import('@salon/database');
    await prisma.client.$transaction((tx) =>
      expireStaleVipReservations(tx, new Date(), { mode: 'salon', salonId: owner.tenantId }),
    );
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
    expect(rejected.body.message).toBe('Confirm the refreshed VIP recipient quantity.');
    expect(rejected.body.details).toMatchObject({
      usableContactCount: 30,
      remainingQuota: 20,
      effectiveRequestedCount: 20,
      packageGroup: 30,
    });
    expect(await used(owner.tenantId)).toBe(480);
    await expectRejectedCreateLeavesNoResidue(owner, rejectedList, rejectedKey, committed);
    const capped = await createRequest(owner, rejectedList, 20);
    expect(capped.status).toBe(201);
    expect(capped.body.requestedCount).toBe(20);
    expect(await prisma.client.vipRequestRecipient.count({ where: { vipRequestId: capped.body.id as string } })).toBe(20);
    expect(await used(owner.tenantId)).toBe(500);
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
    expect(failed.status).toBe(409);
    expect(failed.body.details).toMatchObject({
      usableContactCount: 30,
      effectiveRequestedCount: 30,
      packageGroup: 30,
    });
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
      .expect(400);
    await prisma.client.vipTargetList.update({
      where: { id: listId },
      data: { status: 'ACTIVE' },
    });
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
    const registered = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: 'Registered Salon',
      ownerName: 'Registered Owner',
      password,
    });
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

  it('uses the usable contact count for the request and one admin opening at a time', async () => {
    const owner = await createOwner('group-qty');
    await grantVip(owner.tenantId);
    const groups: Array<[number, number]> = [[28, 30], [40, 50], [52, 50], [75, 100], [92, 100]];
    for (const [contacts, group] of groups) {
      const listId = await readyList(contacts);
      const visible = await request(app.getHttpServer())
        .get('/vip/lists')
        .query({ regionCode: '03', packageGroup: group })
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(visible.body.items.map((row: { id: string }) => row.id)).toContain(listId);
      const otherGroup = group === 50 ? 30 : 50;
      const hidden = await request(app.getHttpServer())
        .get('/vip/lists')
        .query({ regionCode: '03', packageGroup: otherGroup })
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(hidden.body.items.map((row: { id: string }) => row.id)).not.toContain(listId);
    }

    const fullList = await readyList(52);
    await prisma.client.vipTargetList.update({
      where: { id: fullList },
      data: { contactCount: 30 },
    });
    const grouped = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03', packageGroup: 50 })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const row = grouped.body.items.find((item: { id: string }) => item.id === fullList);
    expect(row).toMatchObject({ sendableContactCount: 52, packageGroup: 50, contactCount: 30 });
    const fullKey = `fifty-two-${randomUUID()}`;
    const created = await createRequest(owner, fullList, 52, fullKey);
    expect(created.status).toBe(201);
    expect(created.body.requestedCount).toBe(52);
    const replay = await createRequest(owner, fullList, 52, fullKey);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(created.body.id);
    const changed = await createRequest(owner, fullList, 51, fullKey);
    expect(changed.status).toBe(409);
    expect(changed.body.message).toBe('Idempotency-Key was already used with a different request');
    expect(await prisma.client.vipRequestRecipient.count({
      where: { vipRequestId: created.body.id as string },
    })).toBe(52);
    await submitRequest(owner, created.body.id as string);
    await dispatchManual(created.body.id as string);
    const fullReport = await request(app.getHttpServer())
      .get('/salon/overall-performance')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(fullReport.body.vipMessageRequestCount).toBe(52);

    const capped = await createOwner('cap-20');
    await grantVip(capped.tenantId);
    const prior = await acceptSubmitted(capped, 100);
    await prisma.client.vipRequest.update({
      where: { id: prior.requestId },
      data: { requestedCount: 480 },
    });
    const capList = await readyList(52);
    const preview = await createRequest(capped, capList, 52);
    expect(preview.status).toBe(409);
    expect(preview.body.details).toMatchObject({
      usableContactCount: 52,
      remainingQuota: 20,
      effectiveRequestedCount: 20,
      packageGroup: 50,
    });
    const partial = await createRequest(capped, capList, 20);
    expect(partial.status).toBe(201);
    expect(partial.body.requestedCount).toBe(20);
    const partialPhones = await prisma.client.vipRequestRecipient.findMany({
      where: { vipRequestId: partial.body.id as string },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { phoneNumber: true },
    });
    expect(partialPhones).toHaveLength(20);
    const sourcePhones = await prisma.client.vipTargetContact.findMany({
      where: { listId: capList },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { phoneNumber: true },
    });
    expect(partialPhones.map((item) => item.phoneNumber)).toEqual(
      sourcePhones.slice(0, 20).map((item) => item.phoneNumber),
    );
    await submitRequest(capped, partial.body.id as string);
    await dispatchManual(partial.body.id as string);
    const capReport = await request(app.getHttpServer())
      .get('/salon/overall-performance')
      .set('Authorization', `Bearer ${capped.token}`)
      .expect(200);
    expect(capReport.body.vipMessageRequestCount).toBe(500);
    const none = await createRequest(capped, await readyList(30), 30);
    expect(none.status).toBe(409);
    expect(none.body.message).toBe(VIP_QUOTA_EXCEEDED_MESSAGE);

    const stoppedOwner = await createOwner('stopped');
    await grantVip(stoppedOwner.tenantId);
    const stoppedList = await readyList(30);
    const stoppedContact = await prisma.client.vipTargetContact.findFirstOrThrow({
      where: { listId: stoppedList },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const admin = await prisma.client.platformAdmin.findFirstOrThrow();
    await prisma.client.platformMessageStop.upsert({
      where: { phoneNumber: stoppedContact.phoneNumber },
      update: {
        active: true,
        reasonCode: 'RECIPIENT_REQUEST',
        liftedAt: null,
        liftedByAdminId: null,
        updatedAt: new Date(),
      },
      create: {
        id: randomUUID(),
        phoneNumber: stoppedContact.phoneNumber,
        active: true,
        reasonCode: 'RECIPIENT_REQUEST',
        registeredByAdminId: admin.id,
        registeredAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const reduced = await createRequest(stoppedOwner, stoppedList, 29);
    expect(reduced.status).toBe(201);
    expect(reduced.body.requestedCount).toBe(29);
    const reducedPhones = await prisma.client.vipRequestRecipient.findMany({
      where: { vipRequestId: reduced.body.id as string },
      select: { phoneNumber: true },
    });
    expect(reducedPhones.map((item) => item.phoneNumber)).not.toContain(stoppedContact.phoneNumber);

    const first = await createOwner('reopen-a');
    const second = await createOwner('reopen-b');
    const third = await createOwner('reopen-c');
    await grantVip(first.tenantId);
    await grantVip(second.tenantId);
    await grantVip(third.tenantId);
    const shared = await readyList(30);
    const held = await createRequest(first, shared, 30);
    expect(held.status).toBe(201);
    const before = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03', packageGroup: 30 })
      .set('Authorization', `Bearer ${second.token}`)
      .expect(200);
    expect(before.body.items.map((item: { id: string }) => item.id)).not.toContain(shared);
    const reopenKey = `reopen-${randomUUID()}`;
    const opened = await request(app.getHttpServer())
      .post(`/admin/vip/lists/${shared}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', reopenKey)
      .expect(200);
    expect(opened.body.nextReservationOpen).toBe(true);
    expect(opened.body.liveRequestCount).toBe(1);
    const replayedOpen = await request(app.getHttpServer())
      .post(`/admin/vip/lists/${shared}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', reopenKey)
      .expect(200);
    expect(replayedOpen.body.nextReservationOpen).toBe(true);
    expect(await prisma.client.auditLog.count({
      where: { resourceId: shared, action: 'VIP_LIST_REOPENED', result: 'SUCCESS' },
    })).toBe(1);
    const ownView = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03', packageGroup: 30 })
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200);
    expect(ownView.body.items.map((item: { id: string }) => item.id)).not.toContain(shared);
    const [left, right] = await Promise.all([
      createRequest(second, shared, 30),
      createRequest(third, shared, 30),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    const winner = [left, right].find((item) => item.status === 201)!;
    const loser = [left, right].find((item) => item.status === 409)!;
    expect(await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: held.body.id as string },
    })).toMatchObject({ status: 'AWAITING_SAMPLE_WORK', requestedCount: 30 });
    expect(await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: shared } })).toMatchObject({
      nextReservationOpen: false,
      status: 'IN_USE',
    });
    const openedAgain = await request(app.getHttpServer())
      .post(`/admin/vip/lists/${shared}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `reopen-again-${randomUUID()}`)
      .expect(200);
    expect(openedAgain.body.nextReservationOpen).toBe(true);
    const thirdTry = await createRequest(
      loser === left ? second : third,
      shared,
      30,
    );
    expect(thirdTry.status).toBe(201);
    expect(await prisma.client.vipRequest.count({
      where: { listId: shared, status: 'AWAITING_SAMPLE_WORK' },
    })).toBe(3);
    await prisma.client.vipRequest.update({
      where: { id: held.body.id as string },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    const { expireStaleVipReservations } = await import('@salon/database');
    await prisma.client.$transaction((tx) =>
      expireStaleVipReservations(tx, new Date(), { mode: 'salon', salonId: first.tenantId }),
    );
    expect((await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: held.body.id as string },
    })).status).toBe('CANCELLED');
    expect(await prisma.client.vipRequest.count({
      where: { listId: shared, status: 'AWAITING_SAMPLE_WORK' },
    })).toBe(2);
    expect((await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: shared } })).status).toBe('IN_USE');
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${shared}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'INACTIVE' })
      .expect(200);
    expect(await prisma.client.vipRequest.count({
      where: { listId: shared, status: 'AWAITING_SAMPLE_WORK' },
    })).toBe(2);
    await request(app.getHttpServer())
      .post(`/admin/vip/lists/${shared}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `reopen-inactive-${randomUUID()}`)
      .expect(409);
    expect(winner.body.requestedCount).toBe(30);
  });

  it('deactivates an occupied list, restores it, and reopens one reservation', async () => {
    const first = await createOwner('round-a');
    const second = await createOwner('round-b');
    const third = await createOwner('round-c');
    await grantVip(first.tenantId);
    await grantVip(second.tenantId);
    await grantVip(third.tenantId);
    const listId = await readyList(30);
    const held = await createRequest(first, listId, 30);
    expect(held.status).toBe(201);
    await submitRequest(first, held.body.id as string);
    const opened = await request(app.getHttpServer())
      .post(`/admin/vip/lists/${listId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `round-open-${randomUUID()}`)
      .expect(200);
    expect(opened.body.nextReservationOpen).toBe(true);
    const secondHeld = await createRequest(second, listId, 30);
    expect(secondHeld.status).toBe(201);
    const before = {
      firstCount: (await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: held.body.id as string } })).requestedCount,
      secondCount: (await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: secondHeld.body.id as string } })).requestedCount,
      snapshots: await prisma.client.vipRequestRecipient.count({ where: { vipRequest: { listId } } }),
      quota: await used(first.tenantId) + await used(second.tenantId),
    };
    expect(before).toEqual({ firstCount: 30, secondCount: 30, snapshots: 60, quota: 60 });

    const [deactivated, racedOpen] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/admin/vip/lists/${listId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ availability: 'INACTIVE' }),
      request(app.getHttpServer())
        .post(`/admin/vip/lists/${listId}/reopen`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `round-race-open-${randomUUID()}`),
    ]);
    expect(deactivated.status).toBeLessThan(500);
    expect(racedOpen.status).toBeLessThan(500);
    const inactive = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(inactive.status).toBe('INACTIVE');
    expect(inactive.nextReservationOpen).toBe(false);
    expect(inactive.reservedBySalonId).toBeNull();
    expect(await prisma.client.vipRequest.count({
      where: { listId, status: { in: ['SUBMITTED', 'AWAITING_SAMPLE_WORK'] } },
    })).toBe(2);

    const hidden = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03', packageGroup: 30 })
      .set('Authorization', `Bearer ${third.token}`)
      .expect(200);
    expect(hidden.body.items.map((row: { id: string }) => row.id)).not.toContain(listId);
    const blockedReserve = await createRequest(third, listId, 30);
    expect(blockedReserve.status).toBe(409);
    await request(app.getHttpServer())
      .post(`/admin/vip/lists/${listId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `round-inactive-${randomUUID()}`)
      .expect(409);

    await dispatchManual(held.body.id as string);
    expect((await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: held.body.id as string },
    })).status).toBe('MANUAL_QUEUED');
    expect((await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: secondHeld.body.id as string },
    })).status).toBe('AWAITING_SAMPLE_WORK');
    const history = await request(app.getHttpServer())
      .get('/vip/requests')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200);
    expect(history.body.items.map((row: { id: string }) => row.id)).toContain(held.body.id);

    const activated = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '03' })
      .expect(200);
    expect(activated.body).toMatchObject({
      status: 'ACTIVE',
      nextReservationOpen: false,
      requestableBySalons: false,
      liveRequestCount: 2,
    });
    const stillBlocked = await createRequest(third, listId, 30);
    expect(stillBlocked.status).toBe(409);
    expect(await prisma.client.vipRequest.count({ where: { listId } })).toBe(2);

    const reopened = await request(app.getHttpServer())
      .post(`/admin/vip/lists/${listId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `round-reopen-${randomUUID()}`)
      .expect(200);
    expect(reopened.body.nextReservationOpen).toBe(true);
    const admitted = await createRequest(third, listId, 30);
    expect(admitted.status).toBe(201);
    expect(admitted.body.requestedCount).toBe(30);
    const firstAgain = await createRequest(first, listId, 30);
    const secondAgain = await createRequest(second, listId, 30);
    expect(firstAgain.status).toBe(409);
    expect(secondAgain.status).toBe(409);
    expect(await prisma.client.vipRequestRecipient.count({
      where: { vipRequestId: held.body.id as string },
    })).toBe(30);
    expect((await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } })).nextReservationOpen).toBe(false);
  });

  it('recalculates a changed quantity and keeps one quota winner', async () => {
    const owner = await createOwner('preview');
    await grantVip(owner.tenantId);
    const listId = await readyList(52);
    const preview = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03', packageGroup: 50 })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(preview.body.items.find((row: { id: string }) => row.id === listId)).toMatchObject({
      sendableContactCount: 52,
      packageGroup: 50,
    });
    const prior = await acceptSubmitted(owner, 100);
    await prisma.client.vipRequest.update({
      where: { id: prior.requestId },
      data: { requestedCount: 480 },
    });
    const stale = await createRequest(owner, listId, 52);
    expect(stale.status).toBe(409);
    expect(stale.body.details).toMatchObject({
      usableContactCount: 52,
      remainingQuota: 20,
      effectiveRequestedCount: 20,
      packageGroup: 50,
    });
    expect(await prisma.client.vipRequest.count({ where: { listId } })).toBe(0);
    expect(await used(owner.tenantId)).toBe(480);

    const contact = await prisma.client.vipTargetContact.findFirstOrThrow({
      where: { listId },
      orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
    });
    const admin = await prisma.client.platformAdmin.findFirstOrThrow();
    await prisma.client.platformMessageStop.upsert({
      where: { phoneNumber: contact.phoneNumber },
      update: { active: true, liftedAt: null, liftedByAdminId: null, updatedAt: new Date() },
      create: {
        id: randomUUID(),
        phoneNumber: contact.phoneNumber,
        active: true,
        reasonCode: 'RECIPIENT_REQUEST',
        registeredByAdminId: admin.id,
        registeredAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const keptKey = `preview-kept-${randomUUID()}`;
    const sameQuantity = await createRequest(owner, listId, 20, keptKey);
    expect(sameQuantity.status).toBe(201);
    expect(sameQuantity.body.requestedCount).toBe(20);
    const lost = await createRequest(owner, listId, 20, keptKey);
    expect(lost.status).toBe(201);
    expect(lost.body.id).toBe(sameQuantity.body.id);
    expect(await prisma.client.vipRequestRecipient.count({
      where: { vipRequestId: sameQuantity.body.id as string },
    })).toBe(20);
    expect(await used(owner.tenantId)).toBe(500);

    const fresh = await createOwner('preview-fresh');
    await grantVip(fresh.tenantId);
    const seededFresh = await acceptSubmitted(fresh, 100);
    await prisma.client.vipRequest.update({
      where: { id: seededFresh.requestId },
      data: { requestedCount: 480 },
    });
    const movable = await readyList(52);
    const groupPreview = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03', packageGroup: 50 })
      .set('Authorization', `Bearer ${fresh.token}`)
      .expect(200);
    expect(groupPreview.body.items.map((row: { id: string }) => row.id)).toContain(movable);
    const movableContacts = await prisma.client.vipTargetContact.findMany({
      where: { listId: movable },
      orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
      take: 24,
    });
    for (const row of movableContacts) {
      await prisma.client.platformMessageStop.upsert({
        where: { phoneNumber: row.phoneNumber },
        update: { active: true, liftedAt: null, liftedByAdminId: null, updatedAt: new Date() },
        create: {
          id: randomUUID(),
          phoneNumber: row.phoneNumber,
          active: true,
          reasonCode: 'RECIPIENT_REQUEST',
          registeredByAdminId: admin.id,
          registeredAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const moved = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03', packageGroup: 30 })
      .set('Authorization', `Bearer ${fresh.token}`)
      .expect(200);
    const movedRow = moved.body.items.find((row: { id: string }) => row.id === movable);
    expect(movedRow).toMatchObject({ sendableContactCount: 28, packageGroup: 30 });
    const confirmed = await createRequest(fresh, movable, 20);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.requestedCount).toBe(20);
    const shiftedOwner = await createOwner('preview-shift');
    await grantVip(shiftedOwner.tenantId);
    const shifted = await readyList(52);
    const shiftedContacts = await prisma.client.vipTargetContact.findMany({
      where: { listId: shifted },
      orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
      take: 12,
    });
    for (const row of shiftedContacts) {
      await prisma.client.platformMessageStop.upsert({
        where: { phoneNumber: row.phoneNumber },
        update: { active: true, liftedAt: null, liftedByAdminId: null, updatedAt: new Date() },
        create: {
          id: randomUUID(),
          phoneNumber: row.phoneNumber,
          active: true,
          reasonCode: 'RECIPIENT_REQUEST',
          registeredByAdminId: admin.id,
          registeredAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const shiftedRequest = await createRequest(shiftedOwner, shifted, 52);
    expect(shiftedRequest.status).toBe(409);
    expect(shiftedRequest.body.details).toMatchObject({
      usableContactCount: 40,
      effectiveRequestedCount: 40,
      packageGroup: 50,
    });
    expect(await prisma.client.vipRequest.count({ where: { listId: shifted } })).toBe(0);
    expect((await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: shifted } })).status).toBe('ACTIVE');

    const quotaOwner = await createOwner('quota-pair');
    await grantVip(quotaOwner.tenantId);
    const seeded = await acceptSubmitted(quotaOwner, 100);
    await prisma.client.vipRequest.update({
      where: { id: seeded.requestId },
      data: { requestedCount: 470 },
    });
    const left = await readyList(30);
    const right = await readyList(30);
    const [a, b] = await Promise.all([
      createRequest(quotaOwner, left, 30),
      createRequest(quotaOwner, right, 30),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await used(quotaOwner.tenantId)).toBe(500);
    expect(await prisma.client.vipRequest.count({
      where: { salonId: quotaOwner.tenantId, status: 'AWAITING_SAMPLE_WORK' },
    })).toBe(1);

    const overlapA = await createOwner('overlap-a');
    const overlapB = await createOwner('overlap-b');
    await grantVip(overlapA.tenantId);
    await grantVip(overlapB.tenantId);
    const sharedPhone = `0912${String(phoneSerial).padStart(7, '0')}`;
    const firstList = await readyList(30);
    const secondList = await readyList(30);
    await prisma.client.vipTargetContact.updateMany({
      where: { listId: firstList, sortOrder: 1 },
      data: { phoneNumber: sharedPhone },
    });
    await prisma.client.vipTargetContact.updateMany({
      where: { listId: secondList, sortOrder: 1 },
      data: { phoneNumber: sharedPhone },
    });
    const raced = await Promise.all([
      createRequest(overlapA, firstList, 30),
      createRequest(overlapB, secondList, 30),
    ]);
    expect(raced.map((row) => row.status).sort()).toEqual([201, 201]);
    expect(raced.every((row) => row.status < 500)).toBe(true);
  });

  it('replaces an expired draft without touching another salon or replaying a second request', async () => {
    const owner = await createOwner('expire-same');
    const other = await createOwner('expire-other');
    await grantVip(owner.tenantId);
    await grantVip(other.tenantId);
    const listId = await readyList(30);
    const firstKey = `expire-first-${randomUUID()}`;
    const created = await createRequest(owner, listId, 30, firstKey);
    expect(created.status).toBe(201);
    await request(app.getHttpServer())
      .post(`/admin/vip/lists/${listId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `expire-open-${randomUUID()}`)
      .expect(200);
    const otherHeld = await createRequest(other, listId, 30);
    expect(otherHeld.status).toBe(201);
    const boundary = new Date();
    await prisma.client.vipRequest.update({
      where: { id: created.body.id as string },
      data: { reservedUntil: boundary },
    });
    const { expireStaleVipReservations } = await import('@salon/database');
    const equal = await prisma.client.$transaction((tx) =>
      expireStaleVipReservations(tx, boundary, { mode: 'salon', salonId: owner.tenantId }),
    );
    expect(equal.cancelledRequests).toBe(0);
    expect((await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: created.body.id as string },
    })).status).toBe('AWAITING_SAMPLE_WORK');
    const read = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(read.body.activeDraft.id).toBe(created.body.id);
    expect((await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: created.body.id as string },
    })).status).toBe('AWAITING_SAMPLE_WORK');

    await prisma.client.vipRequest.update({
      where: { id: created.body.id as string },
      data: { reservedUntil: new Date(boundary.getTime() - 1) },
    });
    const replacementList = await readyList(30);
    const [left, right] = await Promise.all([
      createRequest(owner, replacementList, 30),
      createRequest(owner, await readyList(30), 30),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    expect((await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: created.body.id as string },
    })).status).toBe('CANCELLED');
    expect((await prisma.client.vipRequest.findUniqueOrThrow({
      where: { id: otherHeld.body.id as string },
    })).status).toBe('AWAITING_SAMPLE_WORK');
    expect((await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } })).status).toBe('IN_USE');
    const replay = await createRequest(owner, listId, 30, firstKey);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(created.body.id);
    expect(await prisma.client.vipRequest.count({
      where: { salonId: owner.tenantId, listId, status: 'AWAITING_SAMPLE_WORK' },
    })).toBe(0);

    const live = await createOwner('expire-live');
    await grantVip(live.tenantId);
    const liveList = await readyList(30);
    const liveDraft = await createRequest(live, liveList, 30);
    expect(liveDraft.status).toBe(201);
    const duplicates = await Promise.all([
      createRequest(live, await readyList(30), 30),
      createRequest(live, await readyList(30), 30),
    ]);
    expect(duplicates.map((row) => row.status)).toEqual([409, 409]);
    expect(await prisma.client.vipRequest.count({
      where: { salonId: live.tenantId, status: 'AWAITING_SAMPLE_WORK' },
    })).toBe(1);
  });
});

import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { MemoryObjectStorage } from '../src/infrastructure/storage/memory.object-storage';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage';
import { createPlatformAdminSession, hashTestPassword, syntheticMobile } from './support/phone-account';

const databaseUrl = process.env.DATABASE_URL;
const dedicatedUrl = process.env.VIP_ROUND_DISPOSABLE_DATABASE_URL;
const REFUSED_SYSIDS = new Set(['7700113693112733735', '7683163620851879970']);
const FORBIDDEN_PORTS = new Set(['5432', '15442', '15490']);
const FORBIDDEN_NAMES = new Set(['salon', 'salon_preview', 'salon-db', 'phone_first_product', 'postgres']);

const disposableTarget = (() => {
  if (!databaseUrl || !dedicatedUrl || databaseUrl !== dedicatedUrl) return null;
  if (process.env.OTPY_API_KEY || process.env.BALE_SAFIR_API_ACCESS_KEY) return null;
  try {
    const parsed = new URL(databaseUrl);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (parsed.hostname !== '127.0.0.1' || !parsed.port || FORBIDDEN_PORTS.has(parsed.port)) return null;
    if (FORBIDDEN_NAMES.has(name) || !/^salon_vip_round_[a-z0-9]+$/.test(name)) return null;
    return { name, token: name.slice('salon_vip_round_'.length), port: parsed.port };
  } catch {
    return null;
  }
})();

const describeIfDisposable = disposableTarget ? describe : describe.skip;
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
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x14,
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

describeIfDisposable('VIP list reservation rounds (e2e)', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let adminToken: string;
  let phoneSerial = 20;
  const originalThrottleCanActivate = ThrottlerGuard.prototype.canActivate;

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
    const identity = await prisma.client.$queryRaw<
      Array<{ name: string; comment: string | null; sysid: string }>
    >`
      SELECT current_database() AS name,
             shobj_description(oid, 'pg_database') AS comment,
             (SELECT system_identifier::text FROM pg_control_system()) AS sysid
      FROM pg_database
      WHERE datname = current_database()
    `;
    const row = identity[0];
    if (
      !disposableTarget ||
      row?.name !== disposableTarget.name ||
      row.comment !== `vip-round-disposable:${disposableTarget.token}` ||
      REFUSED_SYSIDS.has(row.sysid ?? '')
    ) {
      throw new Error('Refusing VIP round tests without this run’s disposable database');
    }
    jwt = app.get(JwtService);
    const admin = await createPlatformAdminSession(prisma.client, app.getHttpServer(), {
      name: 'Ops',
      password: adminPassword,
    });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    ThrottlerGuard.prototype.canActivate = originalThrottleCanActivate;
    await app?.close();
  });

  function nextPrefix() {
    phoneSerial += 1;
    return `09${String(((phoneSerial - 1) % 90) + 10).padStart(2, '0')}`;
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

  async function readyList(count = 30) {
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

  async function createRequest(owner: { token: string }, listId: string, count = 30) {
    return request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', randomUUID())
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

  async function visible(token: string, listId: string) {
    const page = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '03', packageGroup: 30 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (page.body.items as Array<{ id: string }>).some((item) => item.id === listId);
  }

  it('admits five distinct salons, refuses a sixth, and races the last slot', async () => {
    const owners = [];
    for (let i = 0; i < 7; i += 1) {
      const owner = await createOwner(`slot-${i}`);
      await grantVip(owner.tenantId);
      owners.push(owner);
    }
    const listId = await readyList();
    for (let i = 0; i < 4; i += 1) {
      expect(await visible(owners[i]!.token, listId)).toBe(true);
      expect((await createRequest(owners[i]!, listId)).status).toBe(201);
      expect(await visible(owners[i]!.token, listId)).toBe(false);
      expect(await visible(owners[4]!.token, listId)).toBe(true);
    }
    const [fifth, sixth] = await Promise.all([
      createRequest(owners[4]!, listId),
      createRequest(owners[5]!, listId),
    ]);
    expect([fifth.status, sixth.status].sort()).toEqual([201, 409]);
    const loser = fifth.status === 409 ? fifth : sixth;
    expect(loser.body.error).toBe('VIP_LIST_CAPACITY_EXHAUSTED');
    expect(await visible(owners[6]!.token, listId)).toBe(false);
    const detail = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.status).toBe('IN_USE');
    expect(detail.body.roundOccupiedCount).toBe(5);
    expect(detail.body.roundRemainingSlots).toBe(0);
    expect(detail.body.requestableBySalons).toBe(false);
    expect(await prisma.client.vipRequest.count({ where: { listId, status: 'AWAITING_SAMPLE_WORK' } })).toBe(5);
  });

  it('releases an expired draft slot on mutating expiry, not on GET', async () => {
    const first = await createOwner('expire-a');
    const second = await createOwner('expire-b');
    await grantVip(first.tenantId);
    await grantVip(second.tenantId);
    const listId = await readyList();
    const created = await createRequest(first, listId);
    expect(created.status).toBe(201);
    await prisma.client.vipRequest.update({
      where: { id: created.body.id as string },
      data: { reservedUntil: new Date(Date.now() - 60_000) },
    });
    expect(await visible(second.token, listId)).toBe(true);
    const capability = await request(app.getHttpServer())
      .get('/vip/capability')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200);
    expect(capability.body.activeDraft.id).toBe(created.body.id);
    expect(
      (await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: created.body.id as string } })).status,
    ).toBe('AWAITING_SAMPLE_WORK');
    const replacement = await createRequest(second, listId);
    expect(replacement.status).toBe(201);
    expect(
      (await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: created.body.id as string } })).status,
    ).toBe('CANCELLED');
    expect(await prisma.client.vipListRoundSlot.count({
      where: { vipRequestId: created.body.id as string },
    })).toBe(0);
  });

  it('blocks same-salon unresolved reuse and admits the same round after terminal outcomes', async () => {
    const owner = await createOwner('reuse');
    const other = await createOwner('other-round');
    await grantVip(owner.tenantId);
    await grantVip(other.tenantId);
    const listId = await readyList();
    const created = await createRequest(owner, listId);
    expect(created.status).toBe(201);
    const duplicate = await createRequest(owner, listId);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('VIP_LIST_OWN_UNRESOLVED');
    await submitRequest(owner, created.body.id as string);
    const beforeSettlement = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(beforeSettlement.body.unresolvedRequestCount).toBe(1);
    const stillOpen = await createRequest(owner, listId);
    expect(stillOpen.status).toBe(409);
    expect(stillOpen.body.error).toBe('VIP_LIST_OWN_UNRESOLVED');

    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${created.body.id}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `manual-${randomUUID()}`)
      .expect(201);
    const partial = await createRequest(owner, listId);
    expect(partial.status).toBe(409);

    await prisma.client.$executeRaw`
      INSERT INTO message_deliveries (
        id, salon_id, message_request_id, mode, channel, status,
        provider_request_id, created_by, submitted_at, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        mr.salon_id,
        mr.id,
        'MANUAL'::"MessageDeliveryMode",
        'TEXT'::"MessageChannel",
        'SENT'::"MessageDeliveryStatus",
        gen_random_uuid()::text,
        ${owner.userId}::uuid,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM message_requests mr
      WHERE mr.vip_request_id = ${created.body.id as string}::uuid
        AND mr.salon_id = ${owner.tenantId}::uuid
    `;
    await prisma.client.$executeRaw`
      UPDATE message_requests
      SET status = 'SENT'::"MessageRequestStatus",
          updated_at = CURRENT_TIMESTAMP
      WHERE vip_request_id = ${created.body.id as string}::uuid
        AND salon_id = ${owner.tenantId}::uuid
    `;
    const settledList = await request(app.getHttpServer())
      .get(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(settledList.body.openRequestCount).toBe(1);
    expect(settledList.body.unresolvedRequestCount).toBe(0);
    const settledProfile = await request(app.getHttpServer())
      .get(`/admin/vip/salons/${owner.tenantId}/profile`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(settledProfile.body.counts.vipOpenRequestCount).toBe(1);
    expect(settledProfile.body.counts.vipUnresolvedRequestCount).toBe(0);
    const rejoin = await createRequest(owner, listId);
    expect(rejoin.status).toBe(201);
    const otherJoin = await createRequest(other, listId);
    expect(otherJoin.status).toBe(201);
    const stored = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(stored.reservationRound).toBe(1);
  });

  it('blocks unresolved older-round work after a new round, including concurrent POSTs', async () => {
    const owner = await createOwner('cross-a');
    const other = await createOwner('cross-b');
    await grantVip(owner.tenantId);
    await grantVip(other.tenantId);
    const listId = await readyList();
    const created = await createRequest(owner, listId);
    expect(created.status).toBe(201);
    await submitRequest(owner, created.body.id as string);
    const opened = await request(app.getHttpServer())
      .post(`/admin/vip/lists/${listId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `cross-${randomUUID()}`)
      .expect(200);
    expect(opened.body.reservationRound).toBe(2);
    expect(opened.body.roundRemainingSlots).toBe(5);
    const [first, second] = await Promise.all([
      createRequest(owner, listId),
      createRequest(owner, listId),
    ]);
    expect([first.status, second.status]).toEqual([409, 409]);
    expect([first.body.error, second.body.error]).toEqual([
      'VIP_LIST_OWN_UNRESOLVED',
      'VIP_LIST_OWN_UNRESOLVED',
    ]);
    expect((await createRequest(other, listId)).status).toBe(201);
    await request(app.getHttpServer())
      .post(`/admin/vip/requests/${created.body.id}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `cross-manual-${randomUUID()}`)
      .expect(201);
    const partial = await createRequest(owner, listId);
    expect(partial.status).toBe(409);
    expect(partial.body.error).toBe('VIP_LIST_OWN_UNRESOLVED');
    await prisma.client.$executeRaw`
      INSERT INTO message_deliveries (
        id, salon_id, message_request_id, mode, channel, status,
        provider_request_id, created_by, submitted_at, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        mr.salon_id,
        mr.id,
        'MANUAL'::"MessageDeliveryMode",
        'TEXT'::"MessageChannel",
        'SENT'::"MessageDeliveryStatus",
        gen_random_uuid()::text,
        ${owner.userId}::uuid,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM message_requests mr
      WHERE mr.vip_request_id = ${created.body.id as string}::uuid
        AND mr.salon_id = ${owner.tenantId}::uuid
    `;
    await prisma.client.$executeRaw`
      UPDATE message_requests
      SET status = 'SENT'::"MessageRequestStatus",
          updated_at = CURRENT_TIMESTAMP
      WHERE vip_request_id = ${created.body.id as string}::uuid
        AND salon_id = ${owner.tenantId}::uuid
    `;
    const later = await createRequest(owner, listId);
    expect(later.status).toBe(201);
    expect(
      (await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: later.body.id as string } }))
        .reservationRound,
    ).toBe(2);
  });

  it('opens a new round only while five unresolved occupants still hold the list', async () => {
    const holders = [];
    for (let i = 0; i < 5; i += 1) {
      const owner = await createOwner(`hold-${i}`);
      await grantVip(owner.tenantId);
      holders.push(owner);
    }
    const listId = await readyList();
    for (const holder of holders) {
      expect((await createRequest(holder, listId)).status).toBe(201);
    }
    const enableOccupied = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '03' })
      .expect(200);
    expect(enableOccupied.body.status).toBe('IN_USE');
    expect(enableOccupied.body.roundRemainingSlots).toBe(0);
    expect(enableOccupied.body.requestableBySalons).toBe(false);
    const reopenKey = `round-${randomUUID()}`;
    const opened = await request(app.getHttpServer())
      .post(`/admin/vip/lists/${listId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', reopenKey)
      .expect(200);
    expect(opened.body.reservationRound).toBe(2);
    expect(opened.body.roundRemainingSlots).toBe(5);
    expect(opened.body.requestableBySalons).toBe(true);
    const replay = await request(app.getHttpServer())
      .post(`/admin/vip/lists/${listId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', reopenKey)
      .expect(200);
    expect(replay.body.reservationRound).toBe(2);
    const extra = await createOwner('round-2');
    await grantVip(extra.tenantId);
    expect((await createRequest(extra, listId)).status).toBe(201);
  });

  it('admin disable blocks new requests without cancelling, then restore uses remaining slots', async () => {
    const first = await createOwner('dis-a');
    const second = await createOwner('dis-b');
    await grantVip(first.tenantId);
    await grantVip(second.tenantId);
    const listId = await readyList();
    expect((await createRequest(first, listId)).status).toBe(201);
    const occupiedEnable = await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '03' })
      .expect(200);
    expect(occupiedEnable.body.status).toBe('IN_USE');
    expect(occupiedEnable.body.roundRemainingSlots).toBe(4);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'INACTIVE' })
      .expect(200);
    const blocked = await createRequest(second, listId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('VIP_LIST_ADMIN_DISABLED');
    expect(await prisma.client.vipRequest.count({ where: { listId, status: 'AWAITING_SAMPLE_WORK' } })).toBe(1);
    await request(app.getHttpServer())
      .patch(`/admin/vip/lists/${listId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availability: 'ACTIVE', regionCode: '03' })
      .expect(200);
    expect((await createRequest(second, listId)).status).toBe(201);
  });

  it('rejects a slot that points to a different list or reservation round', async () => {
    const owner = await createOwner('slot-identity');
    await grantVip(owner.tenantId);
    const listId = await readyList();
    const otherListId = await readyList();
    const created = await createRequest(owner, listId);
    expect(created.status).toBe(201);
    const requestId = created.body.id as string;

    await expect(prisma.client.$executeRaw`
      UPDATE vip_list_round_slots
      SET list_id = ${otherListId}::uuid
      WHERE vip_request_id = ${requestId}::uuid
    `).rejects.toThrow();
    await expect(prisma.client.$executeRaw`
      UPDATE vip_list_round_slots
      SET reservation_round = reservation_round + 1
      WHERE vip_request_id = ${requestId}::uuid
    `).rejects.toThrow();

    const slot = await prisma.client.vipListRoundSlot.findUniqueOrThrow({
      where: { vipRequestId: requestId },
    });
    expect(slot.listId).toBe(listId);
    expect(slot.reservationRound).toBe(1);
  });

  it('uses indexes for requestability and unresolved recipient predicates', async () => {
    const owner = await createOwner('plan');
    await grantVip(owner.tenantId);
    const listId = await readyList();
    await createRequest(owner, listId);
    const now = new Date();
    const requestability = await prisma.client.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>`
      EXPLAIN (FORMAT JSON)
      SELECT l.id
      FROM vip_target_lists l
      WHERE l.region_code = '03'
        AND l.catalog_membership = 'ORIGINAL_TEHRAN'
        AND l.status IN ('ACTIVE', 'IN_USE')
        AND (
          SELECT COUNT(*)::int
          FROM vip_list_round_slots slot
          INNER JOIN vip_requests r
            ON r.id = slot.vip_request_id
           AND r.salon_id = slot.salon_id
           AND r.list_id = slot.list_id
          WHERE slot.list_id = l.id
            AND slot.reservation_round = l.reservation_round
            AND (
              r.submitted_at IS NOT NULL
              OR (
                r.status = 'AWAITING_SAMPLE_WORK'
                AND r.reserved_until >= ${now}
              )
            )
        ) < 5
    `;
    expect(JSON.stringify(requestability)).toMatch(/Index|Scan/i);
    const unresolved = await prisma.client.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>`
      EXPLAIN (FORMAT JSON)
      SELECT 1
      FROM vip_requests own
      WHERE own.list_id = ${listId}::uuid
        AND own.salon_id = ${owner.tenantId}::uuid
        AND (
          (
            own.status = 'AWAITING_SAMPLE_WORK'
            AND own.reserved_until >= ${now}
          )
          OR (
            own.status IN ('SUBMITTED', 'MANUAL_QUEUED', 'BALE_NOT_IMPLEMENTED')
            AND EXISTS (
              SELECT 1
              FROM vip_request_recipients rec
              WHERE rec.vip_request_id = own.id
                AND rec.salon_id = own.salon_id
            )
          )
        )
    `;
    expect(JSON.stringify(unresolved)).toMatch(/Index|Scan/i);
    const slotPlan = await prisma.client.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>`
      EXPLAIN (FORMAT JSON)
      SELECT slot.salon_id
      FROM vip_list_round_slots slot
      WHERE slot.list_id = ${listId}::uuid
        AND slot.reservation_round = 1
    `;
    expect(JSON.stringify(slotPlan)).toMatch(/Index|Scan/i);
  });
});

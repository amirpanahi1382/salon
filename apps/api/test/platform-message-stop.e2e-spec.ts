import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createPrismaClient, lockPlatformMessagePhone, PLATFORM_MESSAGE_STOP_REASON } from '@salon/database';
import * as argon2 from 'argon2';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const expectedName = process.env.MESSAGE_STOP_E2E_DATABASE_NAME ?? '';
const expectedPort = process.env.MESSAGE_STOP_E2E_HOST_PORT ?? '';
const expectedSystemIdentifier = process.env.MESSAGE_STOP_E2E_SYSTEM_IDENTIFIER ?? '';
const expectedComment = process.env.MESSAGE_STOP_E2E_DATABASE_COMMENT ?? '';
const proofRequested = Boolean(expectedName && expectedPort && expectedSystemIdentifier && expectedComment);
const FORBIDDEN_PORTS = new Set(['5432', '15442']);

function databaseTarget(): { name: string; port: string } {
  const raw = process.env.DATABASE_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('message-stop e2e refused an unreadable database target');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, '').split('?')[0] ?? '');
  const port = url.port;
  const host = url.hostname;
  if (name === 'salon' || name === 'salon_preview') {
    throw new Error('message-stop e2e refused a persistent database name');
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('message-stop e2e refused a non-loopback database host');
  }
  if (!port || FORBIDDEN_PORTS.has(port)) {
    throw new Error('message-stop e2e refused a persistent or preview database port');
  }
  if (!name.startsWith('salon_message_stop_') || name !== expectedName || port !== expectedPort) {
    throw new Error('message-stop e2e database target does not match the explicit disposable proof');
  }
  return { name, port };
}

if (proofRequested) {
  databaseTarget();
}

async function proveDisposableIdentity(): Promise<void> {
  databaseTarget();
  const db = createPrismaClient(process.env.DATABASE_URL ?? '');
  try {
    const rows = await db.$queryRaw<Array<{ current: string; sid: bigint; comment: string | null }>>`
      SELECT current_database() AS current,
             (SELECT system_identifier FROM pg_control_system()) AS sid,
             (
               SELECT shobj_description(d.oid, 'pg_database')
               FROM pg_database d
               WHERE d.datname = current_database()
             ) AS comment
    `;
    const row = rows[0];
    if (!row || row.current !== expectedName) {
      throw new Error('message-stop e2e connected database does not match the explicit name');
    }
    if (String(row.sid) !== expectedSystemIdentifier || row.comment !== expectedComment) {
      throw new Error('message-stop e2e database identity proof did not match');
    }
  } finally {
    await db.$disconnect();
  }
}

const describeStop = proofRequested ? describe : describe.skip;
const password = 'correct-horse-battery';
const adminPassword = 'platform-admin-pass';
const text = 'سلام، وقت شما برای مراجعه بعدی هماهنگ است.';

describeStop('platform message stop (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    await proveDisposableIdentity();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const adminEmail = `stop-admin-${Date.now()}@example.test`;
    adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email: adminEmail,
        name: 'Stop Ops',
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

  async function owner(label: string) {
    const email = `${label}-${randomUUID()}@example.test`;
    const salonId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    await prisma.client.salon.create({ data: { id: salonId, name: `${label} salon`, updatedAt: now } });
    await prisma.client.user.create({
      data: {
        id: userId,
        salonId,
        name: label,
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'OWNER',
        updatedAt: now,
      },
    });
    const token = await app.get(JwtService).signAsync({ sub: userId, tid: salonId, role: 'OWNER' });
    return { token, userId, salonId };
  }

  async function customer(token: string, phone: string) {
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Sara', lastName: 'Stop', phoneNumber: phone })
      .expect(201);
    return response.body.id as string;
  }

  function send(token: string, customerId: string, key: string) {
    return request(app.getHttpServer())
      .post(`/customers/${customerId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ text });
  }

  it('rejects salon management and invalid phones', async () => {
    const salon = await owner('deny');
    await request(app.getHttpServer())
      .get('/admin/message-stops')
      .query({ phone: '09120000001' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/admin/message-stops')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: '9120000001', confirmed: true })
      .expect(400);
    await request(app.getHttpServer())
      .post('/admin/message-stops')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: '09120000001', confirmed: false })
      .expect(400);
  });

  it('stops one canonical phone across salons without leaving a request', async () => {
    const phone = `0912${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const first = await owner('cross-a');
    const second = await owner('cross-b');
    const customerA = await customer(first.token, phone);
    const customerB = await customer(second.token, phone);
    const registered = await request(app.getHttpServer())
      .post('/admin/message-stops')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: phone, confirmed: true })
      .expect(201);
    expect(registered.body.active).toBe(true);
    expect(registered.body.reasonCode).toBe('RECIPIENT_REQUEST');
    expect(JSON.stringify(registered.body)).not.toMatch(/messageText|body/);

    const again = await request(app.getHttpServer())
      .post('/admin/message-stops')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: phone, confirmed: true })
      .expect(201);
    expect(again.body.blockedRequestCount).toBe(0);
    expect(await prisma.client.platformMessageStopEvent.count({
      where: { phoneNumber: phone, action: 'REGISTERED' },
    })).toBe(1);

    for (const [token, customerId, key] of [
      [first.token, customerA, 'stop-cross-a'],
      [second.token, customerB, 'stop-cross-b'],
    ] as const) {
      const refused = await send(token, customerId, key).expect(409);
      expect(refused.body.error).toBe('GLOBAL_MESSAGE_STOP');
      expect(refused.body.message).toBe('ارسال پیام به این شماره مجاز نیست');
      expect(JSON.stringify(refused.body)).not.toContain(phone);
    }
    expect(await prisma.client.messageRequest.count({ where: { recipientPhoneNumber: phone } })).toBe(0);
    expect(await prisma.client.messageDelivery.count({ where: { customer: { phoneNumber: phone } } })).toBe(0);
    expect(await prisma.client.idempotencyRecord.count({ where: { key: { in: ['stop-cross-a', 'stop-cross-b'] } } })).toBe(0);
    const audits = await prisma.client.auditLog.findMany({
      where: { action: 'PLATFORM_MESSAGE_STOP_REGISTERED' },
    });
    expect(audits.some((row) => JSON.stringify(row.metadata).includes(phone))).toBe(false);
  });

  it('cancels queued work, blocks manual send, and does not resend after lift', async () => {
    const phone = `0913${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const salon = await owner('queued');
    const customerId = await customer(salon.token, phone);
    const created = await send(salon.token, customerId, 'before-stop').expect(201);
    const requestId = created.body.id as string;
    await request(app.getHttpServer())
      .post('/admin/message-stops')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: phone, confirmed: true })
      .expect(201);
    const stopped = await prisma.client.messageRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(stopped.status).toBe('CANCELLED');
    expect(await prisma.client.messageGlobalStopOutcome.count({ where: { messageRequestId: requestId } })).toBe(1);
    expect(await prisma.client.messageDelivery.count({ where: { messageRequestId: requestId, status: 'SENT' } })).toBe(0);

    const manual = await request(app.getHttpServer())
      .post(`/admin/message-queue/${requestId}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(manual.body.error).toBe('GLOBAL_MESSAGE_STOP');

    await request(app.getHttpServer())
      .post('/admin/message-stops/lift')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: phone, confirmed: true })
      .expect(201);
    const afterLift = await prisma.client.messageRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(afterLift.status).toBe('CANCELLED');
    const fresh = await send(salon.token, customerId, 'after-lift-1').expect(409);
    expect(fresh.body.error).toBe('MESSAGE_DAILY_LIMIT_REACHED');
    expect(await prisma.client.messageRequest.count({ where: { recipientPhoneNumber: phone } })).toBe(1);
    expect((await prisma.client.messageRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('CANCELLED');
  });

  it('skips a stopped VIP recipient on dispatch and export without relabeling the snapshot', async () => {
    const stoppedPhone = `0914${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const openPhone = `0915${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const salon = await owner('vip-stop');
    const now = new Date();
    const listId = randomUUID();
    const requestId = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: 'stop-list',
        status: 'ACTIVE',
        contactCount: 30,
        regionCode: '01',
        createdByAdminId: adminId,
        updatedAt: now,
      },
    });
    const contacts = Array.from({ length: 30 }, (_, index) => ({
      id: randomUUID(),
      listId,
      sortOrder: index + 1,
      displayName: `n${index}`,
      phoneNumber: index === 0 ? stoppedPhone : `0912001${String(index).padStart(4, '0')}`,
    }));
    contacts[1]!.phoneNumber = openPhone;
    await prisma.client.vipTargetContact.createMany({ data: contacts });
    await prisma.client.vipRequest.create({
      data: {
        id: requestId,
        salonId: salon.salonId,
        listId,
        createdByUserId: salon.userId,
        requestedCount: 30,
        geographicRange: 'تهران',
        status: 'SUBMITTED',
        reservedUntil: new Date(now.getTime() + 60_000),
        submittedAt: now,
        updatedAt: now,
        recipients: {
          create: contacts.map((contact, index) => ({
            id: randomUUID(),
            sortOrder: index + 1,
            sourceContactId: contact.id,
            displayName: contact.displayName,
            phoneNumber: contact.phoneNumber,
            messageText: 'vip text',
          })),
        },
      },
    });
    await request(app.getHttpServer())
      .post('/admin/message-stops')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: stoppedPhone, confirmed: true })
      .expect(201);
    const dispatch = await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vip-stop-${requestId}`)
      .expect(201);
    expect(dispatch.body).toBeDefined();
    const messages = await prisma.client.messageRequest.findMany({ where: { vipRequestId: requestId } });
    expect(messages).toHaveLength(29);
    expect(messages.some((row) => row.recipientPhoneNumber === stoppedPhone)).toBe(false);
    const skipped = await prisma.client.vipRequestRecipient.findFirstOrThrow({
      where: { vipRequestId: requestId, phoneNumber: stoppedPhone },
      include: { globalStopOutcome: true },
    });
    expect(skipped.messageRequestId).toBeNull();
    expect(skipped.phoneNumber).toBe(stoppedPhone);
    expect(skipped.globalStopOutcome?.reasonCode).toBe('RECIPIENT_REQUEST');

    const exported = await request(app.getHttpServer())
      .get(`/admin/vip/requests/${requestId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body);
    const sheet = workbook.getWorksheet('VIP');
    const phones: string[] = [];
    sheet?.eachRow((row, index) => {
      if (index === 1) return;
      const value = row.getCell(2).value;
      if (typeof value === 'string') phones.push(value);
    });
    expect(phones).not.toContain(stoppedPhone);
    expect(phones).toContain(openPhone);
    const summary = workbook.getWorksheet('خلاصه');
    expect(summary?.getCell('B1').value).toBe(1);
  });

  it('keeps a VIP skip after lift for dispatch, counters, and a new export', async () => {
    const stoppedPhone = `0916${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const openPhone = `0917${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const salon = await owner('vip-lift');
    const now = new Date();
    const listId = randomUUID();
    const requestId = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: 'lift-list',
        status: 'ACTIVE',
        contactCount: 30,
        regionCode: '02',
        createdByAdminId: adminId,
        updatedAt: now,
      },
    });
    const contacts = Array.from({ length: 30 }, (_, index) => ({
      id: randomUUID(),
      listId,
      sortOrder: index + 1,
      displayName: `n${index}`,
      phoneNumber: index === 0 ? stoppedPhone : `0917000${String(index).padStart(4, '0')}`,
    }));
    contacts[1]!.phoneNumber = openPhone;
    await prisma.client.vipTargetContact.createMany({ data: contacts });
    await prisma.client.vipRequest.create({
      data: {
        id: requestId,
        salonId: salon.salonId,
        listId,
        createdByUserId: salon.userId,
        requestedCount: 30,
        geographicRange: 'تهران',
        status: 'SUBMITTED',
        reservedUntil: new Date(now.getTime() + 60_000),
        submittedAt: now,
        updatedAt: now,
        recipients: {
          create: contacts.map((contact, index) => ({
            id: randomUUID(),
            sortOrder: index + 1,
            sourceContactId: contact.id,
            displayName: contact.displayName,
            phoneNumber: contact.phoneNumber,
            messageText: 'vip text',
          })),
        },
      },
    });
    await request(app.getHttpServer())
      .post('/admin/message-stops')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: stoppedPhone, confirmed: true })
      .expect(201);
    await request(app.getHttpServer())
      .post('/admin/message-stops/lift')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: stoppedPhone, confirmed: true })
      .expect(201);
    expect(await prisma.client.platformMessageStop.findUnique({ where: { phoneNumber: stoppedPhone } })).toMatchObject({
      active: false,
    });

    const dispatch = await request(app.getHttpServer())
      .post(`/admin/vip/requests/${requestId}/dispatch-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vip-lift-${requestId.slice(0, 8)}`)
      .expect(201);
    expect(JSON.stringify(dispatch.body)).not.toContain(stoppedPhone);
    const messages = await prisma.client.messageRequest.findMany({ where: { vipRequestId: requestId } });
    expect(messages).toHaveLength(29);
    expect(messages.some((row) => row.recipientPhoneNumber === stoppedPhone)).toBe(false);
    expect(messages.some((row) => row.recipientPhoneNumber === openPhone)).toBe(true);
    const skipped = await prisma.client.vipRequestRecipient.findFirstOrThrow({
      where: { vipRequestId: requestId, phoneNumber: stoppedPhone },
      include: { globalStopOutcome: true },
    });
    expect(skipped.messageRequestId).toBeNull();
    expect(skipped.globalStopOutcome).not.toBeNull();

    const detail = await request(app.getHttpServer())
      .get(`/admin/vip/outreach/requests/${requestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.request.globallyStoppedCount).toBe(1);
    expect(detail.body.request.queuedCount).toBe(29);
    expect(detail.body.request.notYetQueuedCount).toBe(0);
    const stoppedRow = (detail.body.items as Array<{ phoneNumber: string; executionState: string }>)
      .find((row) => row.phoneNumber === stoppedPhone);
    expect(stoppedRow?.executionState).toBe('GLOBALLY_STOPPED');

    const exported = await request(app.getHttpServer())
      .get(`/admin/vip/requests/${requestId}/export`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body);
    const phones: string[] = [];
    workbook.getWorksheet('VIP')?.eachRow((row, index) => {
      if (index === 1) return;
      const value = row.getCell(2).value;
      if (typeof value === 'string') phones.push(value);
    });
    expect(phones).not.toContain(stoppedPhone);
    expect(phones).toContain(openPhone);
    expect(phones).toHaveLength(29);
    const summary = workbook.getWorksheet('خلاصه');
    expect(summary?.getCell('A1').value).toBe('تعداد ردیف‌های حذف‌شده');
    expect(summary?.getCell('B1').value).toBe(1);
    expect(JSON.stringify(summary?.getSheetValues() ?? [])).not.toContain(stoppedPhone);
    expect(workbook.worksheets).toHaveLength(2);
  });

  it('excludes an active stop from the region aggregate and the list sendable count', async () => {
    const stoppedPhone = `0918${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const openPhone = `0919${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const salon = await owner('region-stop');
    const now = new Date();
    await prisma.client.vipSalonEntitlement.create({
      data: {
        id: randomUUID(),
        salonId: salon.salonId,
        grantedByAdminId: adminId,
        grantedAt: now,
        updatedAt: now,
      },
    });
    const before = await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const prior = (before.body.items as Array<{ regionCode: string; availableContactCount: number }>)
      .find((row) => row.regionCode === '14')?.availableContactCount ?? 0;
    const listId = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: 'region-list',
        status: 'ACTIVE',
        catalogMembership: 'ORIGINAL_TEHRAN',
        contactCount: 2,
        regionCode: '14',
        createdByAdminId: adminId,
        updatedAt: now,
        contacts: {
          create: [
            { id: randomUUID(), sortOrder: 1, displayName: 'a', phoneNumber: stoppedPhone },
            { id: randomUUID(), sortOrder: 2, displayName: 'b', phoneNumber: openPhone },
          ],
        },
      },
    });
    await request(app.getHttpServer())
      .post('/admin/message-stops')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phoneNumber: stoppedPhone, confirmed: true })
      .expect(201);
    const after = await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const region = (after.body.items as Array<{ regionCode: string; availableContactCount: number }>)
      .find((row) => row.regionCode === '14');
    expect(region?.availableContactCount).toBe(prior + 1);
    expect(JSON.stringify(after.body)).not.toContain(stoppedPhone);
    expect(JSON.stringify(after.body)).not.toContain(openPhone);
    const lists = await request(app.getHttpServer())
      .get('/vip/lists')
      .query({ regionCode: '14' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const list = (lists.body.items as Array<{ id: string; sendableContactCount: number; contactCount: number }>)
      .find((row) => row.id === listId);
    expect(list?.contactCount).toBe(2);
    expect(list?.sendableContactCount).toBe(1);
    expect(JSON.stringify(lists.body)).not.toContain(stoppedPhone);
  });

  it('excludes a phone whose stop commits before the VIP recipient snapshot', async () => {
    const phones = Array.from({ length: 30 }, () =>
      `0913${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`,
    ).sort();
    const stopped = phones[0]!;
    const salon = await owner('race-create');
    const now = new Date();
    const listId = randomUUID();
    await prisma.client.vipSalonEntitlement.create({
      data: {
        id: randomUUID(),
        salonId: salon.salonId,
        grantedByAdminId: adminId,
        grantedAt: now,
        updatedAt: now,
      },
    });
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: 'race-list',
        status: 'ACTIVE',
        catalogMembership: 'ORIGINAL_TEHRAN',
        contactCount: 30,
        regionCode: '05',
        createdByAdminId: adminId,
        updatedAt: now,
        contacts: {
          create: phones.map((phoneNumber, index) => ({
            id: randomUUID(),
            sortOrder: index + 1,
            displayName: `n${index}`,
            phoneNumber,
          })),
        },
      },
    });
    let holding!: () => void;
    const held = new Promise<void>((resolve) => { holding = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const stopper = prisma.client.$transaction(async (tx) => {
      await lockPlatformMessagePhone(tx, stopped);
      holding();
      await gate;
      await tx.platformMessageStop.create({
        data: {
          id: randomUUID(),
          phoneNumber: stopped,
          active: true,
          reasonCode: PLATFORM_MESSAGE_STOP_REASON,
          registeredByAdminId: adminId,
          registeredAt: now,
          updatedAt: now,
        },
      });
    }, { timeout: 20_000 });
    await held;
    const idempotencyKey = `race-create-${listId.slice(0, 8)}`;
    const creating = request(app.getHttpServer())
      .post('/vip/requests')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ listId, requestedCount: 30, geographicRange: 'تهران' });
    let waiting = 0;
    let earlyStatus = 0;
    const settled = creating.then((response) => {
      earlyStatus = response.status;
      return response;
    });
    for (let attempt = 0; attempt < 40 && waiting === 0 && earlyStatus === 0; attempt += 1) {
      const rows = await prisma.client.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND state = 'active'
          AND query ILIKE '%pg_advisory_xact_lock%'
      `;
      waiting = rows[0]?.n ?? 0;
      if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (waiting === 0) {
      throw new Error(`create did not wait for the phone lock; earlyStatus=${earlyStatus}`);
    }
    release();
    await stopper;
    const response = await creating.expect(400);
    expect(JSON.stringify(response.body)).not.toContain(stopped);
    expect(await prisma.client.vipRequest.count({ where: { listId } })).toBe(0);
    expect(await prisma.client.vipRequestRecipient.count({ where: { phoneNumber: { in: phones } } })).toBe(0);
    const list = await prisma.client.vipTargetList.findUniqueOrThrow({ where: { id: listId } });
    expect(list.status).toBe('ACTIVE');
    expect(list.reservedBySalonId).toBeNull();
    expect(await prisma.client.auditLog.count({
      where: { tenantId: salon.salonId, action: 'VIP_REQUEST_CREATED' },
    })).toBe(0);
    expect(await prisma.client.outboxEvent.count({
      where: { tenantId: salon.salonId, eventType: 'VipRequestCreated' },
    })).toBe(0);
    expect(await prisma.client.idempotencyRecord.count({ where: { key: idempotencyKey } })).toBe(0);
  }, 30_000);
});

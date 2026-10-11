import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const databaseUrl = process.env.VISIT_INTENTION_DISPOSABLE_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.replace(/^\//, '') : '';
const disposable =
  Boolean(databaseUrl) &&
  databaseUrl === process.env.DATABASE_URL &&
  databaseName.startsWith('salon_visit_intention_') &&
  databaseName !== 'salon' &&
  databaseName !== 'salon_preview';

const describeIfDisposable = disposable ? describe : describe.skip;
const password = randomBytes(18).toString('hex');
const targetPhone = '09129998877';
const messageMarker = 'VIP_SECRET_BODY_MARKER';

describeIfDisposable('visit intentions on a disposable database', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    if (!disposable) return;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const rows = await prisma.client.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    if (rows[0]?.current_database !== databaseName) {
      throw new Error('Visit intention tests refused a database other than the disposable target');
    }
    const adminEmail = `visit-intention-admin-${randomUUID()}@example.test`;
    const adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email: adminEmail,
        name: 'اپراتور',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        updatedAt: new Date(),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: adminEmail, password })
      .expect(201);
    adminToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function registerOwner(label: string) {
    const email = `${label}-${randomUUID()}@example.test`;
    const salonId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    await prisma.client.salon.create({
      data: { id: salonId, name: `${label} salon`, updatedAt: now },
    });
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
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return {
      token: login.body.accessToken as string,
      userId: login.body.user.id as string,
      tenantId: login.body.user.tenantId as string,
      salonId,
    };
  }

  async function addStaff(salonId: string) {
    const email = `staff-${randomUUID()}@example.test`;
    await prisma.client.user.create({
      data: {
        id: randomUUID(),
        salonId,
        name: 'staff',
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'STAFF',
        updatedAt: new Date(),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return login.body.accessToken as string;
  }

  function phone() {
    return `0912${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
  }

  async function createCustomer(token: string, lastName = 'تست') {
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'سارا', lastName, phoneNumber: phone() })
      .expect(201);
    return response.body.id as string;
  }

  async function insertVip(salon: { tenantId: string; userId: string }) {
    const admin = await prisma.client.platformAdmin.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!admin) throw new Error('admin missing');
    const listId = randomUUID();
    const contactId = randomUUID();
    const requestId = randomUUID();
    const recipientId = randomUUID();
    const now = new Date();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: 'synthetic-list',
        status: 'IN_USE',
        contactCount: 1,
        createdByAdminId: admin.id,
        reservedBySalonId: salon.tenantId,
        reservedAt: now,
        updatedAt: now,
      },
    });
    await prisma.client.vipTargetContact.create({
      data: {
        id: contactId,
        listId,
        sortOrder: 1,
        displayName: 'هدف فهرست',
        phoneNumber: targetPhone,
      },
    });
    await prisma.client.vipRequest.create({
      data: {
        id: requestId,
        salonId: salon.tenantId,
        listId,
        createdByUserId: salon.userId,
        requestedCount: 30,
        geographicRange: 'تهران',
        status: 'SUBMITTED',
        reservedUntil: now,
        submittedAt: now,
        updatedAt: now,
      },
    });
    await prisma.client.vipRequestRecipient.create({
      data: {
        id: recipientId,
        vipRequestId: requestId,
        salonId: salon.tenantId,
        sortOrder: 1,
        sourceContactId: contactId,
        displayName: 'هدف فهرست',
        phoneNumber: targetPhone,
        messageText: messageMarker,
      },
    });
    return { requestId, recipientId };
  }

  it('records customer intention without a message, keeps date precision, and does not invent a return commitment', async () => {
    const salon = await registerOwner('owner');
    const other = await registerOwner('other');
    const customerId = await createCustomer(salon.token);
    const before = await prisma.client.returnCommitment.count({ where: { salonId: salon.tenantId } });
    const key = `vi-${randomUUID()}`;
    const created = await request(app.getHttpServer())
      .post(`/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(201);
    expect(created.body.reportChannel).toBe('SALON_STAFF');
    expect(created.body.timeKnown).toBe(false);
    expect(created.body.agreedTimePassed).toBe(false);
    expect(created.body.agreedInstant).toBeNull();
    expect(created.body.operationallyOpen).toBe(true);
    const replay = await request(app.getHttpServer())
      .post(`/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);
    await request(app.getHttpServer())
      .post(`/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send({ time: { precision: 'DATE', agreedDate: '2026-10-12' } })
      .expect(409);
    const duplicateOpen = await request(app.getHttpServer())
      .post(`/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(409);
    expect(duplicateOpen.body.error).toBe('CONFLICT');
    expect(duplicateOpen.body.message).toBe(
      'An open visit intention already exists for this customer',
    );
    await request(app.getHttpServer())
      .post(`/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN', agreedDate: '2026-10-12' } })
      .expect(400);
    const after = await prisma.client.returnCommitment.count({ where: { salonId: salon.tenantId } });
    expect(after).toBe(before);

    const corrected = await request(app.getHttpServer())
      .patch(`/visit-intentions/${created.body.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-patch-${randomUUID()}`)
      .send({ time: { precision: 'DATE', agreedDate: '2026-10-20' }, updatedAt: created.body.updatedAt })
      .expect(200);
    expect(corrected.body.agreedDate).toBe('2026-10-20');
    expect(corrected.body.agreedInstant).toBeNull();
    expect(corrected.body.reportedAt).toBe(created.body.reportedAt);
    expect(corrected.body.reportedBy).toBe('SALON_USER');
    const stored = await prisma.client.$queryRaw<Array<{ agreed_date: string | null; agreed_instant: Date | null; data_type: string }>>`
      SELECT vi.agreed_date::text AS agreed_date, vi.agreed_instant, c.data_type
      FROM visit_intentions vi
      JOIN information_schema.columns c
        ON c.table_name = 'visit_intentions' AND c.column_name = 'agreed_date'
      WHERE vi.id = ${created.body.id}::uuid
    `;
    expect(stored[0]?.agreed_date).toBe('2026-10-20');
    expect(stored[0]?.agreed_instant).toBeNull();
    expect(stored[0]?.data_type).toBe('date');

    await request(app.getHttpServer())
      .get('/follow-ups/customers')
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200)
      .expect((response) => {
        expect(JSON.stringify(response.body)).not.toContain(created.body.id);
      });
    await request(app.getHttpServer())
      .post(`/visit-intentions/${created.body.id}/link-visit`)
      .set('Authorization', `Bearer ${other.token}`)
      .set('Idempotency-Key', `vi-link-${randomUUID()}`)
      .send({ visitId: randomUUID() })
      .expect(404);

    const visitedAt = new Date(Date.now() - 60_000).toISOString();
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `visit-${randomUUID()}`)
      .send({ customerId, visitedAt })
      .expect(201);
    const stillOpen = await request(app.getHttpServer())
      .get('/follow-ups/customers?limit=20')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(stillOpen.body.items.map((item: { id: string }) => item.id)).toContain(created.body.id);
    expect(stillOpen.body.items.find((item: { id: string }) => item.id === created.body.id).agreedTimePassed).toBe(false);

    await request(app.getHttpServer())
      .post(`/visit-intentions/${created.body.id}/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-link-${randomUUID()}`)
      .send({ visitId: visit.body.id })
      .expect(201);
    const settled = await request(app.getHttpServer())
      .get('/follow-ups/customers')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(settled.body.items.map((item: { id: string }) => item.id)).not.toContain(created.body.id);
    const audits = await prisma.client.auditLog.findMany({
      where: { resourceId: created.body.id },
    });
    expect(JSON.stringify(audits)).not.toContain(messageMarker);
    await request(app.getHttpServer())
      .delete(`/customers/${customerId}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(409);
  });

  it('keeps an eligible return commitment on the customer follow-up and out of VIP', async () => {
    const salon = await registerOwner('commitment');
    const customerId = await createCustomer(salon.token);
    const requestId = randomUUID();
    const deliveryId = randomUUID();
    const submittedAt = new Date(Date.now() - 60 * 60 * 1000);
    const customer = await prisma.client.customer.findUniqueOrThrow({ where: { id: customerId } });
    await prisma.client.messageRequest.create({
      data: {
        id: requestId,
        salonId: salon.tenantId,
        customerId,
        createdByUserId: salon.userId,
        messageText: 'سلام',
        recipientPhoneNumber: customer.phoneNumber,
        requestedAt: submittedAt,
        messageBusinessDate: new Date('2026-10-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'SENT',
        updatedAt: submittedAt,
      },
    });
    await prisma.client.messageDelivery.create({
      data: {
        id: deliveryId,
        salonId: salon.tenantId,
        messageRequestId: requestId,
        customerId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: 'SENT',
        providerRequestId: randomUUID(),
        createdBy: salon.userId,
        submittedAt,
        updatedAt: submittedAt,
      },
    });
    const expectedAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const commitment = await request(app.getHttpServer())
      .post(`/messages/${requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-${randomUUID()}`)
      .send({ expectedAt })
      .expect(201);
    const page = await request(app.getHttpServer())
      .get('/follow-ups/customers?limit=1')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(page.body.openCount).toBeGreaterThanOrEqual(1);
    expect(page.body.hasMore).toBe(false);
    expect(page.body.items[0].kind).toBe('RETURN_COMMITMENT');
    expect(page.body.items[0].id).toBe(commitment.body.id);
    expect(page.body.items[0].timeKnown).toBe(true);
    const vip = await request(app.getHttpServer())
      .get('/follow-ups/vip')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(vip.body.openCount).toBe(0);
    expect(JSON.stringify(page.body)).not.toContain('COMMITMENT_BACKED');
    expect(JSON.stringify(page.body)).not.toContain('درآمد');
  });

  it('paginates customer follow-ups without mixing VIP rows', async () => {
    const salon = await registerOwner('page');
    const ids: string[] = [];
    for (const name of ['یک', 'دو', 'سه']) {
      const customerId = await createCustomer(salon.token, name);
      const created = await request(app.getHttpServer())
        .post(`/customers/${customerId}/visit-intentions`)
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `vi-${randomUUID()}`)
        .send({ time: { precision: 'UNKNOWN' } })
        .expect(201);
      ids.push(created.body.id as string);
    }
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
      const page = await request(app.getHttpServer())
        .get('/follow-ups/customers')
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${salon.token}`)
        .expect(200);
      expect(page.body.items).toHaveLength(1);
      expect(page.body.items[0].kind).toBe('VISIT_INTENTION');
      expect(seen.has(page.body.items[0].id)).toBe(false);
      seen.add(page.body.items[0].id);
      if (!page.body.hasMore) break;
      cursor = page.body.nextCursor as string;
    }
    expect(seen).toEqual(new Set(ids));
  });

  it('keeps VIP identity privacy-safe and requires an explicit customer at arrival', async () => {
    const salon = await registerOwner('vip');
    const staff = await addStaff(salon.tenantId);
    const matching = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ firstName: 'نسترن', lastName: 'قبلی', phoneNumber: targetPhone })
      .expect(201);
    const chosen = await createCustomer(salon.token, 'انتخابی');
    const vip = await insertVip(salon);
    const adminCreated = await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${vip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-admin-${randomUUID()}`)
      .send({ time: { precision: 'INSTANT', agreedInstant: '2026-10-11T15:30:00.000+03:30' } })
      .expect(201);
    expect(adminCreated.body.reportChannel).toBe('REPORTED_DURING_MANUAL_HANDLING');
    expect(adminCreated.body.vipRequestRecipientId).toBe(vip.recipientId);
    expect(JSON.stringify(adminCreated.body)).not.toContain(targetPhone);
    expect(JSON.stringify(adminCreated.body)).not.toContain(messageMarker);
    await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${vip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-admin-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(409);

    const inbound = await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-in-${randomUUID()}`)
      .send({
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'مریم',
        disclosedPhone: '09121110000',
        vipRequestRecipientId: vip.recipientId,
      })
      .expect(400);
    expect(inbound.body).toBeDefined();
    const inboundOk = await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-in-${randomUUID()}`)
      .send({
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'مریم',
        disclosedPhone: '09121110000',
      })
      .expect(201);
    expect(inboundOk.body.customerId).toBeNull();
    expect(inboundOk.body.identityDisclosure).toBe('SALON_SUPPLIED');
    expect(inboundOk.body.vipRequestRecipientId).toBeUndefined();

    const salonList = await request(app.getHttpServer())
      .get('/follow-ups/vip')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const serialized = JSON.stringify(salonList.body);
    expect(serialized).not.toContain(targetPhone);
    expect(serialized).not.toContain(messageMarker);
    expect(serialized).not.toContain(vip.recipientId);
    expect(serialized).toContain('09121110000');
    expect(salonList.body.openCount).toBe(2);
    const withheld = salonList.body.items.find((item: { id: string }) => item.id === adminCreated.body.id);
    expect(withheld.identityDisclosure).toBe('WITHHELD');
    expect(withheld.customerId).toBeNull();
    expect(withheld.agreedInstant).toBe('2026-10-11T12:00:00.000Z');
    expect(withheld.nextAction).toBe('SELECT_CUSTOMER_THEN_RECORD_VISIT');

    const visitedAt = new Date(Date.now() - 30_000).toISOString();
    await request(app.getHttpServer())
      .post(`/visit-intentions/${adminCreated.body.id}/arrive`)
      .set('Authorization', `Bearer ${staff}`)
      .set('Idempotency-Key', `vi-arrive-${randomUUID()}`)
      .send({ visitedAt, customerId: matching.body.id, sale: { serviceId: randomUUID(), amount: '10.00', currency: 'IRR' } })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/visit-intentions/${adminCreated.body.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-arrive-${randomUUID()}`)
      .send({ visitedAt })
      .expect(400);
    const visitsBefore = await prisma.client.visit.count({ where: { salonId: salon.tenantId } });
    const firstKey = `vi-arrive-${randomUUID()}`;
    const secondKey = `vi-arrive-${randomUUID()}`;
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/visit-intentions/${adminCreated.body.id}/arrive`)
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', firstKey)
        .send({ visitedAt, customerId: chosen }),
      request(app.getHttpServer())
        .post(`/visit-intentions/${adminCreated.body.id}/arrive`)
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', secondKey)
        .send({ visitedAt, customerId: matching.body.id }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const visitsAfter = await prisma.client.visit.count({ where: { salonId: salon.tenantId } });
    expect(visitsAfter).toBe(visitsBefore + 1);
    const linked = await prisma.client.visitIntention.findUniqueOrThrow({ where: { id: adminCreated.body.id } });
    expect(linked.linkedCustomerId).toBe(chosen);
    expect(linked.linkedCustomerId).not.toBe(matching.body.id);
    const customers = await prisma.client.customer.count({ where: { salonId: salon.tenantId } });
    expect(customers).toBe(2);
  });

  it('lets platform admin record a customer intention told to support', async () => {
    const salon = await registerOwner('told');
    const customerId = await createCustomer(salon.token);
    const created = await request(app.getHttpServer())
      .post(`/admin/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-told-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(201);
    expect(created.body.reportChannel).toBe('TOLD_PLATFORM_ADMIN');
    expect(created.body.reportedBy).toBe('PLATFORM_ADMIN');
    const listed = await request(app.getHttpServer())
      .get('/follow-ups/customers')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(listed.body.items[0].reportChannel).toBe('TOLD_PLATFORM_ADMIN');
    expect(listed.body.items[0].agreedTimePassed).toBe(false);
  });

  it('links exactly one visit to the chosen open intention and replays an ambiguous arrival', async () => {
    const salon = await registerOwner('arrive-row');
    const other = await registerOwner('arrive-other');
    const customerId = await createCustomer(salon.token);
    const siblingId = await createCustomer(salon.token);
    const otherCustomerId = await createCustomer(other.token);
    const visitedAt = new Date(Date.now() - 60_000).toISOString();

    const closed = await request(app.getHttpServer())
      .post(`/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-closed-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(201);
    const independent = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `visit-${randomUUID()}`)
      .send({ customerId, visitedAt })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/visit-intentions/${closed.body.id}/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-link-${randomUUID()}`)
      .send({ visitId: independent.body.id })
      .expect(201);
    const open = await request(app.getHttpServer())
      .post(`/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-open-${randomUUID()}`)
      .send({ time: { precision: 'DATE', agreedDate: '2026-10-20' } })
      .expect(201);
    const sibling = await request(app.getHttpServer())
      .post(`/customers/${siblingId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-sib-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(201);
    const foreign = await request(app.getHttpServer())
      .post(`/customers/${otherCustomerId}/visit-intentions`)
      .set('Authorization', `Bearer ${other.token}`)
      .set('Idempotency-Key', `vi-foreign-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(201);

    const commitmentsBefore = await prisma.client.returnCommitment.count({ where: { salonId: salon.tenantId } });
    const transactionsBefore = await prisma.client.ledgerTransaction.count({ where: { salonId: salon.tenantId } });
    const visitsBefore = await prisma.client.visit.count({ where: { salonId: salon.tenantId } });
    const key = `vi-arrive-row-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post(`/visit-intentions/${open.body.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send({ visitedAt })
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post(`/visit-intentions/${open.body.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send({ visitedAt })
      .expect(201);
    expect(replay.body.id).toBe(open.body.id);
    expect(replay.body.linkedVisitId).toBe(first.body.linkedVisitId);
    expect(replay.body.operationallyOpen).toBe(false);
    expect(await prisma.client.visit.count({ where: { salonId: salon.tenantId } })).toBe(visitsBefore + 1);
    expect(await prisma.client.ledgerTransaction.count({ where: { salonId: salon.tenantId } })).toBe(transactionsBefore);
    expect(await prisma.client.returnCommitment.count({ where: { salonId: salon.tenantId } })).toBe(commitmentsBefore);
    const closedRow = await prisma.client.visitIntention.findUniqueOrThrow({ where: { id: closed.body.id } });
    expect(closedRow.linkedVisitId).toBe(independent.body.id);
    const siblingRow = await prisma.client.visitIntention.findUniqueOrThrow({ where: { id: sibling.body.id } });
    expect(siblingRow.linkedVisitId).toBeNull();
    const foreignRow = await prisma.client.visitIntention.findUniqueOrThrow({ where: { id: foreign.body.id } });
    expect(foreignRow.linkedVisitId).toBeNull();
    expect(await prisma.client.visit.count({ where: { salonId: other.tenantId } })).toBe(0);

    const again = await request(app.getHttpServer())
      .post(`/visit-intentions/${open.body.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-arrive-again-${randomUUID()}`)
      .send({ visitedAt })
      .expect(409);
    expect(again.status).toBe(409);
    expect(await prisma.client.visit.count({ where: { salonId: salon.tenantId } })).toBe(visitsBefore + 1);

    const concurrentCustomer = await createCustomer(salon.token);
    const concurrent = await request(app.getHttpServer())
      .post(`/customers/${concurrentCustomer}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-concurrent-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(201);
    const [left, right] = await Promise.all([
      request(app.getHttpServer())
        .post(`/visit-intentions/${concurrent.body.id}/arrive`)
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `vi-left-${randomUUID()}`)
        .send({ visitedAt }),
      request(app.getHttpServer())
        .post(`/visit-intentions/${concurrent.body.id}/arrive`)
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `vi-right-${randomUUID()}`)
        .send({ visitedAt }),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    expect(await prisma.client.visit.count({ where: { customerId: concurrentCustomer } })).toBe(1);
    expect(await prisma.client.ledgerTransaction.count({ where: { salonId: salon.tenantId } })).toBe(transactionsBefore);
  });

  it('records an admin customer intention with source provenance and without a delivery', async () => {
    const salon = await registerOwner('admin-src');
    const otherSalonId = randomUUID();
    const otherUserId = randomUUID();
    const otherNow = new Date();
    await prisma.client.salon.create({
      data: { id: otherSalonId, name: 'admin-other salon', updatedAt: otherNow },
    });
    await prisma.client.user.create({
      data: {
        id: otherUserId,
        salonId: otherSalonId,
        name: 'admin-other',
        email: `admin-other-${randomUUID()}@example.test`,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'OWNER',
        updatedAt: otherNow,
      },
    });
    const other = { tenantId: otherSalonId, userId: otherUserId, salonId: otherSalonId };
    const customerId = await createCustomer(salon.token);
    const mismatchCustomer = await createCustomer(salon.token);
    const datedCustomer = await createCustomer(salon.token);
    const instantCustomer = await createCustomer(salon.token);
    const otherCustomer = randomUUID();
    await prisma.client.customer.create({
      data: {
        id: otherCustomer,
        salonId: other.salonId,
        firstName: 'سارا',
        lastName: 'دیگر',
        phoneNumber: phone(),
        updatedAt: new Date(),
      },
    });
    const customer = await prisma.client.customer.findUniqueOrThrow({ where: { id: customerId } });
    const otherRow = await prisma.client.customer.findUniqueOrThrow({ where: { id: otherCustomer } });
    const requestedAt = new Date('2026-10-01T08:00:00.000Z');
    const sourceId = randomUUID();
    const foreignId = randomUUID();
    await prisma.client.messageRequest.create({
      data: {
        id: sourceId,
        salonId: salon.tenantId,
        customerId,
        createdByUserId: salon.userId,
        messageText: 'سلام',
        recipientPhoneNumber: customer.phoneNumber,
        requestedAt,
        messageBusinessDate: new Date('2026-10-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'QUEUED',
        updatedAt: requestedAt,
      },
    });
    await prisma.client.messageRequest.create({
      data: {
        id: foreignId,
        salonId: other.tenantId,
        customerId: otherCustomer,
        createdByUserId: other.userId,
        messageText: 'دیگر',
        recipientPhoneNumber: otherRow.phoneNumber,
        requestedAt,
        messageBusinessDate: new Date('2026-10-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'QUEUED',
        updatedAt: requestedAt,
      },
    });

    await request(app.getHttpServer())
      .post(`/admin/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-admin-auth-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' }, sourceMessageRequestId: sourceId })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/admin/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-admin-foreign-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' }, sourceMessageRequestId: foreignId })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/admin/customers/${mismatchCustomer}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-admin-mismatch-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' }, sourceMessageRequestId: sourceId })
      .expect(400);

    const key = `vi-admin-date-${randomUUID()}`;

    const created = await request(app.getHttpServer())
      .post(`/admin/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({
        time: { precision: 'DATE', agreedDate: '2026-10-21' },
        sourceMessageRequestId: sourceId,
      })
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post(`/admin/customers/${customerId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({
        time: { precision: 'DATE', agreedDate: '2026-10-21' },
        sourceMessageRequestId: sourceId,
      })
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);
    expect(created.body.reportChannel).toBe('TOLD_PLATFORM_ADMIN');
    expect(created.body.reportedBy).toBe('PLATFORM_ADMIN');
    expect(created.body.customerId).toBe(customerId);
    expect(created.body.sourceMessageRequestId).toBe(sourceId);
    expect(created.body.timePrecision).toBe('DATE');
    expect(created.body.agreedDate).toBe('2026-10-21');
    expect(created.body.agreedInstant).toBeNull();
    const stored = await prisma.client.visitIntention.findUniqueOrThrow({ where: { id: created.body.id } });
    const admin = await prisma.client.platformAdmin.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(stored.createdByPlatformAdminId).toBe(admin.id);
    expect(stored.salonId).toBe(salon.tenantId);
    expect(stored.agreedInstant).toBeNull();
    expect(await prisma.client.messageRequest.findUniqueOrThrow({ where: { id: sourceId } })).toMatchObject({
      status: 'QUEUED',
    });
    expect(await prisma.client.messageDelivery.count({ where: { messageRequestId: sourceId } })).toBe(0);
    expect(await prisma.client.returnCommitment.count({ where: { salonId: salon.tenantId } })).toBe(0);
    expect(await prisma.client.visitIntention.count({ where: { customerId } })).toBe(1);

    const instant = await request(app.getHttpServer())
      .post(`/admin/customers/${instantCustomer}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-admin-instant-${randomUUID()}`)
      .send({ time: { precision: 'INSTANT', agreedInstant: '2026-10-22T15:30:00.000+03:30' } })
      .expect(201);
    expect(instant.body.timePrecision).toBe('INSTANT');
    expect(instant.body.agreedDate).toBeNull();
    expect(instant.body.agreedInstant).toBe('2026-10-22T12:00:00.000Z');
    expect(instant.body.sourceMessageRequestId).toBeNull();

    const unknown = await request(app.getHttpServer())
      .post(`/admin/customers/${datedCustomer}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-admin-unknown-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(201);
    expect(unknown.body.timePrecision).toBe('UNKNOWN');
    expect(unknown.body.agreedDate).toBeNull();
    expect(unknown.body.agreedInstant).toBeNull();
  });
});

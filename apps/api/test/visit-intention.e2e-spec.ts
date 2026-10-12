import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
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
  let adminId: string;

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
    adminId = randomUUID();
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

  async function registerOwner(label: string, options?: { skipLogin?: boolean }) {
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
    if (options?.skipLogin) {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET is required for the disposable visit-intention tests');
      return {
        token: jwt.sign({ sub: userId, tid: salonId, role: 'OWNER' }, secret),
        userId,
        tenantId: salonId,
        salonId,
      };
    }
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
      .send({
        time: { precision: 'INSTANT', agreedInstant: '2026-10-11T15:30:00.000+03:30' },
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09120000000',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(201);
    expect(adminCreated.body.reportChannel).toBe('REPORTED_DURING_MANUAL_HANDLING');
    expect(adminCreated.body.identityDisclosure).toBe('ADMIN_AUTHORIZED');
    expect(adminCreated.body.disclosedDisplayName).toBe('نگار');
    expect(adminCreated.body.disclosedPhone).toBe('09120000000');
    expect(adminCreated.body.vipRequestRecipientId).toBe(vip.recipientId);
    expect(JSON.stringify(adminCreated.body)).not.toContain(targetPhone);
    expect(JSON.stringify(adminCreated.body)).not.toContain(messageMarker);
    await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${vip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-admin-${randomUUID()}`)
      .send({
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09120000000',
        prospectAuthorizedSharingWithSalon: true,
      })
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
    expect(serialized).toContain('09120000000');
    expect(serialized).toContain('نگار');
    expect(salonList.body.openCount).toBe(2);
    const disclosed = salonList.body.items.find((item: { id: string }) => item.id === adminCreated.body.id);
    expect(disclosed.identityDisclosure).toBe('ADMIN_AUTHORIZED');
    expect(disclosed.disclosedDisplayName).toBe('نگار');
    expect(disclosed.disclosedPhone).toBe('09120000000');
    expect(disclosed.customerId).toBeNull();
    expect(disclosed.vipRequestRecipientId).toBeUndefined();
    expect(disclosed.agreedInstant).toBe('2026-10-11T12:00:00.000Z');
    expect(disclosed.nextAction).toBe('SELECT_CUSTOMER_THEN_RECORD_VISIT');

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

  it('records salon and admin contact disclosure without copying the target list', async () => {
    const salon = await registerOwner('contact', { skipLogin: true });
    const other = await registerOwner('contact-other', { skipLogin: true });
    const vip = await insertVip(salon);
    const otherVip = await insertVip(other);
    const admin = await prisma.client.platformAdmin.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    const before = {
      customers: await prisma.client.customer.count({ where: { salonId: salon.tenantId } }),
      visits: await prisma.client.visit.count({ where: { salonId: salon.tenantId } }),
      transactions: await prisma.client.ledgerTransaction.count({ where: { salonId: salon.tenantId } }),
      deliveries: await prisma.client.messageDelivery.count({ where: { salonId: salon.tenantId } }),
    };

    const partial = await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${vip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-partial-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' }, disclosedDisplayName: 'نگار' })
      .expect(400);
    expect(JSON.stringify(partial.body)).not.toContain(targetPhone);
    expect(JSON.stringify(partial.body)).not.toContain('هدف فهرست');

    const unconfirmed = await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${vip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-unconfirmed-${randomUUID()}`)
      .send({
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09120000000',
        prospectAuthorizedSharingWithSalon: false,
      })
      .expect(400);
    expect(JSON.stringify(unconfirmed.body)).not.toContain(targetPhone);

    const legacyId = randomUUID();
    await prisma.client.visitIntention.create({
      data: {
        id: legacyId,
        salonId: salon.tenantId,
        subject: 'VIP_PROSPECT',
        vipRequestId: vip.requestId,
        vipRequestRecipientId: vip.recipientId,
        timePrecision: 'UNKNOWN',
        reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
        contactBasis: 'WITHHELD',
        createdByPlatformAdminId: admin.id,
        updatedByPlatformAdminId: admin.id,
        updatedAt: new Date(),
      },
    });

    const nameOnly = await request(app.getHttpServer())
      .post(`/vip/requests/${otherVip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${other.token}`)
      .set('Idempotency-Key', `vi-name-${randomUUID()}`)
      .send({ time: { precision: 'DATE', agreedDate: '2026-11-02' }, disclosedDisplayName: '  مریم  ' })
      .expect(201);
    expect(nameOnly.body.identityDisclosure).toBe('SALON_SUPPLIED');
    expect(nameOnly.body.disclosedDisplayName).toBe('مریم');
    expect(nameOnly.body.disclosedPhone).toBeNull();
    expect(nameOnly.body.vipRequestRecipientId).toBeUndefined();

    const phoneKey = `vi-phone-${randomUUID()}`;
    const phoneOnly = await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', phoneKey)
      .send({ time: { precision: 'UNKNOWN' }, disclosedPhone: '09124445566' })
      .expect(201);
    const phoneReplay = await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', phoneKey)
      .send({ time: { precision: 'UNKNOWN' }, disclosedPhone: '09124445566' })
      .expect(201);
    expect(phoneReplay.body.id).toBe(phoneOnly.body.id);
    const phoneConflict = await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', phoneKey)
      .send({ time: { precision: 'UNKNOWN' }, disclosedPhone: '09124445567' })
      .expect(409);
    expect(JSON.stringify(phoneConflict.body)).not.toContain('09124445567');

    await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-empty-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${otherVip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-cross-${randomUUID()}`)
      .send({
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09120000000',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(404);

    const detail = await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const detailText = JSON.stringify(detail.body);
    expect(detailText).toContain('09124445566');
    expect(detailText).not.toContain(targetPhone);
    expect(detailText).not.toContain(vip.recipientId);
    expect(detailText).not.toContain('هدف فهرست');
    const legacyRead = detail.body.items.find((item: { id: string }) => item.id === legacyId);
    expect(legacyRead.identityDisclosure).toBe('WITHHELD');
    expect(legacyRead.disclosedDisplayName).toBeNull();
    expect(legacyRead.disclosedPhone).toBeNull();
    expect(legacyRead.vipRequestRecipientId).toBeUndefined();

    const corrected = await request(app.getHttpServer())
      .patch(`/visit-intentions/${phoneOnly.body.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-correct-${randomUUID()}`)
      .send({
        time: { precision: 'UNKNOWN' },
        updatedAt: phoneOnly.body.updatedAt,
        correctDisclosedContact: true,
        disclosedPhone: '09125556677',
      })
      .expect(200);
    expect(corrected.body.disclosedPhone).toBe('09125556677');
    expect(corrected.body.reportChannel).toBe(phoneOnly.body.reportChannel);
    expect(corrected.body.reportedAt).toBe(phoneOnly.body.reportedAt);
    const revisions = await prisma.client.visitIntentionContactRevision.findMany({
      where: { visitIntentionId: phoneOnly.body.id },
      orderBy: { revision: 'asc' },
    });
    expect(revisions.map((row) => row.revision)).toEqual([1, 2]);
    expect(revisions[0]?.disclosedPhone).toBe('09124445566');
    expect(revisions[1]?.disclosedPhone).toBe('09125556677');
    const audits = await prisma.client.auditLog.findMany({
      where: { resourceId: phoneOnly.body.id, action: 'VISIT_INTENTION_CONTACT_CORRECTED' },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]?.metadata)).not.toContain('0912');
    expect(JSON.stringify(audits[0]?.metadata)).toContain('SALON_SUPPLIED');

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/vip-requests/${otherVip.requestId}/recipients/${otherVip.recipientId}/visit-intentions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `vi-race-a-${randomUUID()}`)
        .send({
          time: { precision: 'UNKNOWN' },
          disclosedDisplayName: 'همزمان',
          disclosedPhone: '09126667788',
          prospectAuthorizedSharingWithSalon: true,
        }),
      request(app.getHttpServer())
        .post(`/admin/vip-requests/${otherVip.requestId}/recipients/${otherVip.recipientId}/visit-intentions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `vi-race-b-${randomUUID()}`)
        .send({
          time: { precision: 'UNKNOWN' },
          disclosedDisplayName: 'همزمان',
          disclosedPhone: '09126667788',
          prospectAuthorizedSharingWithSalon: true,
        }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);

    expect(await prisma.client.customer.count({ where: { salonId: salon.tenantId } })).toBe(before.customers);
    expect(await prisma.client.visit.count({ where: { salonId: salon.tenantId } })).toBe(before.visits);
    expect(await prisma.client.ledgerTransaction.count({ where: { salonId: salon.tenantId } })).toBe(before.transactions);
    expect(await prisma.client.messageDelivery.count({ where: { salonId: salon.tenantId } })).toBe(before.deliveries);
    const vipStatus = await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: vip.requestId } });
    expect(vipStatus.status).toBe('SUBMITTED');
  });

  it('requires a fresh admin attestation to correct authorized contact', async () => {
    const salon = await registerOwner('attest', { skipLogin: true });
    const vip = await insertVip(salon);
    const created = await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${vip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-attest-${randomUUID()}`)
      .send({
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09127778899',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(201);
    const missing = await request(app.getHttpServer())
      .patch(`/admin/visit-intentions/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-attest-missing-${randomUUID()}`)
      .send({
        time: { precision: 'UNKNOWN' },
        updatedAt: created.body.updatedAt,
        correctDisclosedContact: true,
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09127770000',
      })
      .expect(400);
    expect(JSON.stringify(missing.body)).not.toContain('09127770000');
    const unchanged = await prisma.client.visitIntention.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(unchanged.disclosedPhone).toBe('09127778899');
    expect(await prisma.client.visitIntentionContactRevision.count({ where: { visitIntentionId: created.body.id } })).toBe(1);

    const timeOnly = await request(app.getHttpServer())
      .patch(`/admin/visit-intentions/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-attest-time-${randomUUID()}`)
      .send({
        time: { precision: 'DATE', agreedDate: '2026-11-03' },
        updatedAt: created.body.updatedAt,
      })
      .expect(200);
    expect(timeOnly.body.disclosedPhone).toBe('09127778899');
    expect(timeOnly.body.identityDisclosure).toBe('ADMIN_AUTHORIZED');

    await request(app.getHttpServer())
      .patch(`/visit-intentions/${created.body.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-attest-salon-${randomUUID()}`)
      .send({
        time: { precision: 'DATE', agreedDate: '2026-11-03' },
        updatedAt: timeOnly.body.updatedAt,
        correctDisclosedContact: true,
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09127770000',
      })
      .expect(400);

    const salonOwned = await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-attest-salon-own-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' }, disclosedDisplayName: 'سالن' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/admin/visit-intentions/${salonOwned.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-attest-admin-salon-${randomUUID()}`)
      .send({
        time: { precision: 'UNKNOWN' },
        updatedAt: salonOwned.body.updatedAt,
        correctDisclosedContact: true,
        disclosedDisplayName: 'تغییر',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(400);

    const key = `vi-attest-correct-${randomUUID()}`;
    const corrected = await request(app.getHttpServer())
      .patch(`/admin/visit-intentions/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({
        time: { precision: 'DATE', agreedDate: '2026-11-03' },
        updatedAt: timeOnly.body.updatedAt,
        correctDisclosedContact: true,
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09127770000',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(200);
    const replay = await request(app.getHttpServer())
      .patch(`/admin/visit-intentions/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({
        time: { precision: 'DATE', agreedDate: '2026-11-03' },
        updatedAt: timeOnly.body.updatedAt,
        correctDisclosedContact: true,
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09127770000',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(200);
    expect(replay.body.disclosedPhone).toBe(corrected.body.disclosedPhone);
    const conflict = await request(app.getHttpServer())
      .patch(`/admin/visit-intentions/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({
        time: { precision: 'DATE', agreedDate: '2026-11-03' },
        updatedAt: timeOnly.body.updatedAt,
        correctDisclosedContact: true,
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09127771111',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(409);
    expect(JSON.stringify(conflict.body)).not.toContain('09127771111');
    const revisions = await prisma.client.visitIntentionContactRevision.findMany({
      where: { visitIntentionId: created.body.id },
      orderBy: { revision: 'asc' },
    });
    expect(revisions.map((row) => row.disclosedPhone)).toEqual(['09127778899', '09127770000']);
    expect(revisions[1]?.recordedByPlatformAdminId).toBeTruthy();
    expect(revisions[1]?.createdAt.getTime()).toBeGreaterThan(revisions[0]!.createdAt.getTime());
    const audit = await prisma.client.auditLog.findFirstOrThrow({
      where: { resourceId: created.body.id, action: 'VISIT_INTENTION_CONTACT_CORRECTED' },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('0912');
    const before = {
      customers: await prisma.client.customer.count({ where: { salonId: salon.tenantId } }),
      visits: await prisma.client.visit.count({ where: { salonId: salon.tenantId } }),
      transactions: await prisma.client.ledgerTransaction.count({ where: { salonId: salon.tenantId } }),
      deliveries: await prisma.client.messageDelivery.count({ where: { salonId: salon.tenantId } }),
    };
    expect(before).toEqual({ customers: 0, visits: 0, transactions: 0, deliveries: 0 });
  });

  it('keeps a legacy admin time-only intention withheld and rejects partial contact', async () => {
    const salon = await registerOwner('legacy-admin', { skipLogin: true });
    const other = await registerOwner('legacy-other', { skipLogin: true });
    const vip = await insertVip(salon);
    const otherVip = await insertVip(other);
    const storedId = randomUUID();
    const legacyKey = 'vi-legacy-stored-key';
    const now = new Date('2026-10-01T08:00:00.000Z');
    await prisma.client.visitIntention.create({
      data: {
        id: storedId,
        salonId: salon.tenantId,
        subject: 'VIP_PROSPECT',
        vipRequestId: vip.requestId,
        vipRequestRecipientId: vip.recipientId,
        timePrecision: 'UNKNOWN',
        reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
        contactBasis: 'WITHHELD',
        createdByPlatformAdminId: adminId,
        updatedByPlatformAdminId: adminId,
        createdAt: now,
        updatedAt: now,
      },
    });
    const legacyHash = createHash('sha256')
      .update(`VISIT_INTENTION_CREATE_VIP_ADMIN:${vip.requestId}:${vip.recipientId}:UNKNOWN`)
      .digest('hex');
    await prisma.client.idempotencyRecord.create({
      data: {
        id: randomUUID(),
        tenantId: salon.tenantId,
        actorId: adminId,
        operation: 'VISIT_INTENTION_CREATE_VIP_ADMIN',
        key: legacyKey,
        requestHash: legacyHash,
        resourceType: 'visit_intention',
        resourceId: storedId,
      },
    });
    const before = {
      customers: await prisma.client.customer.count({ where: { salonId: salon.tenantId } }),
      visits: await prisma.client.visit.count({ where: { salonId: salon.tenantId } }),
      transactions: await prisma.client.ledgerTransaction.count({ where: { salonId: salon.tenantId } }),
      deliveries: await prisma.client.messageDelivery.count({ where: { salonId: salon.tenantId } }),
      intentions: await prisma.client.visitIntention.count({ where: { salonId: salon.tenantId } }),
    };
    const replay = await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${vip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', legacyKey)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(201);
    expect(replay.body.id).toBe(storedId);
    expect(replay.body.identityDisclosure).toBe('WITHHELD');
    expect(replay.body.disclosedDisplayName).toBeNull();
    expect(replay.body.disclosedPhone).toBeNull();
    expect(JSON.stringify(replay.body)).not.toContain(targetPhone);
    expect(JSON.stringify(replay.body)).not.toContain('هدف فهرست');
    const conflict = await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${vip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', legacyKey)
      .send({ time: { precision: 'DATE', agreedDate: '2026-11-04' } })
      .expect(409);
    expect(JSON.stringify(conflict.body)).not.toContain(targetPhone);
    const stored = await prisma.client.visitIntention.findUniqueOrThrow({ where: { id: storedId } });
    expect(stored.timePrecision).toBe('UNKNOWN');
    expect(stored.contactBasis).toBe('WITHHELD');
    expect(stored.disclosedPhone).toBeNull();

    const secondRecipient = randomUUID();
    await prisma.client.vipRequestRecipient.create({
      data: {
        id: secondRecipient,
        vipRequestId: vip.requestId,
        salonId: salon.tenantId,
        sortOrder: 2,
        sourceContactId: (
          await prisma.client.vipRequestRecipient.findUniqueOrThrow({ where: { id: vip.recipientId } })
        ).sourceContactId,
        displayName: 'هدف فهرست',
        phoneNumber: targetPhone,
        messageText: messageMarker,
      },
    });
    const authorizedKey = `vi-auth-${randomUUID()}`;
    const authorized = await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${secondRecipient}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', authorizedKey)
      .send({
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09127778899',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(201);
    expect(authorized.body.identityDisclosure).toBe('ADMIN_AUTHORIZED');
    const authorizedReplay = await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${secondRecipient}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', authorizedKey)
      .send({
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09127778899',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(201);
    expect(authorizedReplay.body.id).toBe(authorized.body.id);
    const authorizedConflict = await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${secondRecipient}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', authorizedKey)
      .send({
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09127770000',
        prospectAuthorizedSharingWithSalon: true,
      })
      .expect(409);
    expect(JSON.stringify(authorizedConflict.body)).not.toContain('09127770000');
    expect(JSON.stringify(authorizedConflict.body)).not.toContain(targetPhone);

    const partials = [
      { time: { precision: 'UNKNOWN' }, disclosedDisplayName: 'نگار' },
      { time: { precision: 'UNKNOWN' }, disclosedPhone: '09120000000' },
      { time: { precision: 'UNKNOWN' }, disclosedDisplayName: 'نگار', disclosedPhone: '09120000000' },
      { time: { precision: 'UNKNOWN' }, prospectAuthorizedSharingWithSalon: true },
      {
        time: { precision: 'UNKNOWN' },
        disclosedDisplayName: 'نگار',
        disclosedPhone: '09120000000',
        prospectAuthorizedSharingWithSalon: false,
      },
    ];
    for (const body of partials) {
      const rejected = await request(app.getHttpServer())
        .post(`/admin/vip-requests/${vip.requestId}/recipients/${secondRecipient}/visit-intentions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `vi-partial-${randomUUID()}`)
        .send(body)
        .expect(400);
      expect(JSON.stringify(rejected.body)).not.toContain(targetPhone);
      expect(JSON.stringify(rejected.body)).not.toContain('هدف فهرست');
    }
    await request(app.getHttpServer())
      .post(`/admin/vip-requests/${vip.requestId}/recipients/${otherVip.recipientId}/visit-intentions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `vi-cross-legacy-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' } })
      .expect(404);
    const salonRead = await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const salonText = JSON.stringify(salonRead.body);
    expect(salonText).not.toContain(targetPhone);
    expect(salonText).not.toContain(vip.recipientId);
    expect(salonText).not.toContain('هدف فهرست');
    const withheld = salonRead.body.items.find((item: { id: string }) => item.id === storedId);
    expect(withheld.identityDisclosure).toBe('WITHHELD');
    expect(withheld.disclosedDisplayName).toBeNull();
    expect(withheld.disclosedPhone).toBeNull();
    expect(withheld.vipRequestRecipientId).toBeUndefined();
    const audit = await prisma.client.auditLog.findFirst({
      where: { resourceId: authorized.body.id, action: 'VISIT_INTENTION_CREATED' },
    });
    expect(JSON.stringify(audit?.metadata ?? {})).not.toContain('0912');
    expect(await prisma.client.visitIntention.count({ where: { id: storedId } })).toBe(1);
    expect({
      customers: await prisma.client.customer.count({ where: { salonId: salon.tenantId } }),
      visits: await prisma.client.visit.count({ where: { salonId: salon.tenantId } }),
      transactions: await prisma.client.ledgerTransaction.count({ where: { salonId: salon.tenantId } }),
      deliveries: await prisma.client.messageDelivery.count({ where: { salonId: salon.tenantId } }),
    }).toEqual({
      customers: before.customers,
      visits: before.visits,
      transactions: before.transactions,
      deliveries: before.deliveries,
    });
    expect(await prisma.client.visitIntention.count({ where: { salonId: salon.tenantId } })).toBe(before.intentions + 1);
  });

  it('pages VIP request intentions past 20 rows without leaking withheld identity', async () => {
    const salon = await registerOwner('pages', { skipLogin: true });
    const other = await registerOwner('pages-other', { skipLogin: true });
    const vip = await insertVip(salon);
    const secondRequest = await insertVip(salon);
    const otherVip = await insertVip(other);
    const tie = new Date('2026-09-01T00:00:00.000Z');
    const highId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const lowId = '00000000-0000-4000-8000-0000000000aa';
    const withheldId = randomUUID();
    const rows = [
      {
        id: withheldId,
        createdAt: new Date('2026-10-11T12:00:00.000Z'),
        name: null as string | null,
        channel: 'REPORTED_DURING_MANUAL_HANDLING' as const,
        recipientId: vip.recipientId,
        basis: 'WITHHELD' as const,
        userId: null as string | null,
        admin: adminId,
      },
    ];
    for (let index = 0; index < 18; index += 1) {
      rows.push({
        id: randomUUID(),
        createdAt: new Date(Date.UTC(2026, 9, 10, 0, 0, 18 - index)),
        name: `ردیف ${index}`,
        channel: 'INBOUND_TO_SALON',
        recipientId: null,
        basis: 'SALON_SUPPLIED',
        userId: salon.userId,
        admin: null,
      });
    }
    rows.push(
      {
        id: highId,
        createdAt: tie,
        name: 'هم‌زمان بالا',
        channel: 'INBOUND_TO_SALON',
        recipientId: null,
        basis: 'SALON_SUPPLIED',
        userId: salon.userId,
        admin: null,
      },
      {
        id: lowId,
        createdAt: tie,
        name: 'هم‌زمان پایین',
        channel: 'INBOUND_TO_SALON',
        recipientId: null,
        basis: 'SALON_SUPPLIED',
        userId: salon.userId,
        admin: null,
      },
      {
        id: randomUUID(),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        name: 'قدیمی',
        channel: 'INBOUND_TO_SALON',
        recipientId: null,
        basis: 'SALON_SUPPLIED',
        userId: salon.userId,
        admin: null,
      },
    );
    expect(rows).toHaveLength(22);
    await prisma.client.visitIntention.createMany({
      data: rows.map((row) => ({
        id: row.id,
        salonId: salon.tenantId,
        subject: 'VIP_PROSPECT' as const,
        vipRequestId: vip.requestId,
        vipRequestRecipientId: row.recipientId,
        disclosedDisplayName: row.name,
        timePrecision: 'UNKNOWN' as const,
        reportChannel: row.channel,
        contactBasis: row.basis,
        createdByUserId: row.userId,
        createdByPlatformAdminId: row.admin,
        updatedByUserId: row.userId,
        updatedByPlatformAdminId: row.admin,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      })),
    });
    const first = await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .query({ limit: 20 })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.hasMore).toBe(true);
    expect(typeof first.body.nextCursor).toBe('string');
    const second = await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .query({ limit: 20, cursor: first.body.nextCursor })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(second.body.hasMore).toBe(false);
    expect(second.body.nextCursor).toBeNull();
    const seen = [...first.body.items, ...second.body.items].map((item: { id: string }) => item.id);
    expect(new Set(seen).size).toBe(22);
    expect(seen).toEqual(expect.arrayContaining(rows.map((row) => row.id)));
    const firstIds = first.body.items.map((item: { id: string }) => item.id);
    const secondIds = second.body.items.map((item: { id: string }) => item.id);
    expect(firstIds).toContain(highId);
    expect(secondIds).toContain(lowId);
    expect(firstIds.indexOf(highId)).toBeLessThan(20);
    expect(secondIds.indexOf(lowId)).toBe(0);
    for (const page of [first.body, second.body]) {
      const text = JSON.stringify(page);
      expect(text).not.toContain(targetPhone);
      expect(text).not.toContain(vip.recipientId);
      expect(text).not.toContain('هدف فهرست');
    }
    const hidden = [...first.body.items, ...second.body.items].find((item: { id: string }) => item.id === withheldId);
    expect(hidden.identityDisclosure).toBe('WITHHELD');
    expect(hidden.disclosedDisplayName).toBeNull();
    expect(hidden.disclosedPhone).toBeNull();
    expect(hidden.vipRequestRecipientId).toBeUndefined();
    await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .query({ cursor: 'not-a-cursor' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(400);
    const foreignCursor = Buffer.from(
      `${otherVip.requestId}\n2026-10-11T12:00:00.000Z\n${withheldId}`,
      'utf8',
    ).toString('base64url');
    await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .query({ cursor: foreignCursor })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/vip/requests/${secondRequest.requestId}/visit-intentions`)
      .query({ cursor: first.body.nextCursor })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .query({ cursor: first.body.nextCursor })
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });

  it('reads an upgraded predecessor fixture and appends revision 2 without rewriting revision 1', async () => {
    const noneId = '00000000-0000-4000-8000-000000000108';
    const nameId = '00000000-0000-4000-8000-000000000109';
    const phoneId = '00000000-0000-4000-8000-00000000010a';
    const adminId = '00000000-0000-4000-8000-00000000010b';
    const salonId = '00000000-0000-4000-8000-000000000101';
    const userId = '00000000-0000-4000-8000-000000000102';
    const rows = await prisma.client.visitIntention.findMany({
      where: { id: { in: [noneId, nameId, phoneId, adminId] } },
      orderBy: { id: 'asc' },
    });
    expect(rows).toHaveLength(4);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(noneId)?.contactBasis).toBe('WITHHELD');
    expect(byId.get(noneId)?.disclosedDisplayName).toBeNull();
    expect(byId.get(noneId)?.disclosedPhone).toBeNull();
    expect(byId.get(nameId)?.contactBasis).toBe('SALON_SUPPLIED');
    expect(byId.get(nameId)?.disclosedDisplayName).toBe('مریم تاریخی');
    expect(byId.get(nameId)?.disclosedPhone).toBeNull();
    expect(byId.get(phoneId)?.contactBasis).toBe('SALON_SUPPLIED');
    expect(byId.get(phoneId)?.disclosedPhone).toBe('09121112233');
    expect(byId.get(adminId)?.contactBasis).toBe('WITHHELD');
    expect(byId.get(adminId)?.disclosedPhone).toBeNull();
    const revisions = await prisma.client.visitIntentionContactRevision.findMany({
      where: { visitIntentionId: { in: [noneId, nameId, phoneId, adminId] } },
    });
    expect(revisions).toHaveLength(4);
    for (const revision of revisions) {
      const row = byId.get(revision.visitIntentionId);
      expect(revision.revision).toBe(1);
      expect(revision.salonId).toBe(salonId);
      expect(revision.contactBasis).toBe(row?.contactBasis);
      expect(revision.disclosedDisplayName).toBe(row?.disclosedDisplayName ?? null);
      expect(revision.disclosedPhone).toBe(row?.disclosedPhone ?? null);
      expect(revision.createdAt.toISOString()).toBe(row?.createdAt.toISOString());
      expect(revision.disclosedPhone).not.toBe('09129990000');
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required');
    const token = jwt.sign({ sub: userId, tid: salonId, role: 'OWNER' }, secret);
    const phone = byId.get(phoneId)!;
    const listed = await request(app.getHttpServer())
      .get(`/vip/requests/${phone.vipRequestId}/visit-intentions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const serialized = JSON.stringify(listed.body);
    expect(serialized).toContain('09121112233');
    expect(serialized).toContain('مریم تاریخی');
    expect(serialized).not.toContain('09129990000');
    expect(serialized).not.toContain('00000000-0000-4000-8000-000000000107');
    const withheld = listed.body.items.find((item: { id: string }) => item.id === noneId);
    const adminRow = listed.body.items.find((item: { id: string }) => item.id === adminId);
    expect(withheld.identityDisclosure).toBe('WITHHELD');
    expect(withheld.disclosedPhone).toBeNull();
    expect(adminRow.identityDisclosure).toBe('WITHHELD');
    expect(adminRow.disclosedPhone).toBeNull();
    expect(adminRow.vipRequestRecipientId).toBeUndefined();
    const corrected = await request(app.getHttpServer())
      .patch(`/visit-intentions/${phoneId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'vi-upgrade-phone-correction')
      .send({
        time: { precision: 'UNKNOWN' },
        updatedAt: phone.updatedAt.toISOString(),
        correctDisclosedContact: true,
        disclosedPhone: '09121112244',
      })
      .expect(200);
    expect(corrected.body.disclosedPhone).toBe('09121112244');
    expect(corrected.body.reportedAt).toBe(phone.createdAt.toISOString());
    const after = await prisma.client.visitIntentionContactRevision.findMany({
      where: { visitIntentionId: phoneId },
      orderBy: { revision: 'asc' },
    });
    expect(after.map((row) => [row.revision, row.disclosedPhone])).toEqual([
      [1, '09121112233'],
      [2, '09121112244'],
    ]);
    expect(after[0]?.createdAt.toISOString()).toBe(phone.createdAt.toISOString());
    expect(after[1]?.recordedByUserId).toBe(userId);
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

  it('shows a linked VIP visit in request history without treating it as acquisition or recovery', async () => {
    const salon = await registerOwner('vip-linked', { skipLogin: true });
    const other = await registerOwner('vip-linked-other', { skipLogin: true });
    const vip = await insertVip(salon);
    const chosen = await createCustomer(salon.token, 'انتخابی');
    const saleCustomer = await createCustomer(salon.token, 'فروش');
    const service = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: 'اصلاح' })
      .expect(201);
    const admin = await prisma.client.platformAdmin.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    const withheldId = randomUUID();
    await prisma.client.visitIntention.create({
      data: {
        id: withheldId,
        salonId: salon.tenantId,
        subject: 'VIP_PROSPECT',
        vipRequestId: vip.requestId,
        vipRequestRecipientId: vip.recipientId,
        timePrecision: 'UNKNOWN',
        reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
        contactBasis: 'WITHHELD',
        createdByPlatformAdminId: admin.id,
        updatedByPlatformAdminId: admin.id,
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    const open = await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-open-history-${randomUUID()}`)
      .send({ time: { precision: 'DATE', agreedDate: '2026-11-03' }, disclosedDisplayName: 'باز' })
      .expect(201);
    const noSale = await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-nosale-history-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' }, disclosedPhone: '09125556677' })
      .expect(201);
    const withSale = await request(app.getHttpServer())
      .post(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-sale-history-${randomUUID()}`)
      .send({ time: { precision: 'UNKNOWN' }, disclosedDisplayName: 'فروش' })
      .expect(201);
    const recoveryBefore = await request(app.getHttpServer())
      .get('/recovery/outcomes/summary')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const deliveriesBefore = await prisma.client.messageDelivery.count({ where: { salonId: salon.tenantId } });
    const visitedAt = new Date(Date.now() - 60_000).toISOString();
    const plain = await request(app.getHttpServer())
      .post(`/visit-intentions/${noSale.body.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-nosale-arrive-${randomUUID()}`)
      .send({ visitedAt, customerId: chosen })
      .expect(201);
    const sold = await request(app.getHttpServer())
      .post(`/visit-intentions/${withSale.body.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `vi-sale-arrive-${randomUUID()}`)
      .send({
        visitedAt,
        customerId: saleCustomer,
        sale: { serviceId: service.body.id, amount: '250000.00', currency: 'IRR' },
      })
      .expect(201);
    expect(plain.body.operationallyOpen).toBe(false);
    expect(sold.body.operationallyOpen).toBe(false);
    expect(plain.body.linkedVisitId).toBeTruthy();
    expect(sold.body.linkedVisitId).not.toBe(plain.body.linkedVisitId);

    const history = await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const byId = new Map(history.body.items.map((item: { id: string }) => [item.id, item]));
    expect(byId.get(open.body.id).operationallyOpen).toBe(true);
    expect(byId.get(open.body.id).linkedVisitId).toBeNull();
    expect(byId.get(noSale.body.id).operationallyOpen).toBe(false);
    expect(byId.get(withSale.body.id).operationallyOpen).toBe(false);
    const hidden = byId.get(withheldId);
    expect(hidden.identityDisclosure).toBe('WITHHELD');
    expect(hidden.operationallyOpen).toBe(true);
    expect(hidden.disclosedDisplayName).toBeNull();
    expect(hidden.disclosedPhone).toBeNull();
    expect(hidden.vipRequestRecipientId).toBeUndefined();
    const text = JSON.stringify(history.body);
    expect(text).not.toContain(targetPhone);
    expect(text).not.toContain(vip.recipientId);
    expect(text).not.toContain('هدف فهرست');
    expect(text).not.toContain('جذب شد');

    const followUps = await request(app.getHttpServer())
      .get('/follow-ups/vip')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const followIds = followUps.body.items.map((item: { id: string }) => item.id);
    expect(followIds).toContain(open.body.id);
    expect(followIds).toContain(withheldId);
    expect(followIds).not.toContain(noSale.body.id);
    expect(followIds).not.toContain(withSale.body.id);

    const recoveryAfter = await request(app.getHttpServer())
      .get('/recovery/outcomes/summary')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(recoveryAfter.body).toEqual(recoveryBefore.body);
    expect(await prisma.client.messageDelivery.count({ where: { salonId: salon.tenantId } })).toBe(deliveriesBefore);
    expect(await prisma.client.vipRequest.findUniqueOrThrow({ where: { id: vip.requestId } })).toMatchObject({
      status: 'SUBMITTED',
    });
    await request(app.getHttpServer())
      .get(`/vip/requests/${vip.requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });
});

import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { syntheticMobile } from './support/phone-account';

const expectedName = process.env.VISIT_EVIDENCE_E2E_DATABASE_NAME ?? '';
const expectedPort = process.env.VISIT_EVIDENCE_E2E_HOST_PORT ?? '';
const expectedSystemIdentifier = process.env.VISIT_EVIDENCE_E2E_SYSTEM_IDENTIFIER ?? '';
const expectedComment = process.env.VISIT_EVIDENCE_E2E_DATABASE_COMMENT ?? '';
const databaseUrl = process.env.VISIT_EVIDENCE_DISPOSABLE_DATABASE_URL ?? '';
const proofRequested = Boolean(expectedName && expectedPort && expectedSystemIdentifier && expectedComment && databaseUrl);
const describeEvidence = proofRequested ? describe : describe.skip;

describeEvidence('visit evidence on a named disposable database', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  const password = randomBytes(18).toString('hex');

  beforeAll(async () => {
    const target = new URL(databaseUrl);
    if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
      throw new Error('Visit evidence tests require a loopback database');
    }
    if (target.port !== expectedPort || expectedPort === '5432' || expectedPort === '15442') {
      throw new Error('Visit evidence tests refused the database port');
    }
    const name = target.pathname.replace(/^\//, '');
    if (name !== expectedName || name === 'salon' || name === 'salon_preview' || !name.startsWith('salon_visit_evidence_')) {
      throw new Error('Visit evidence tests refused the database name');
    }
    if (process.env.DATABASE_URL !== databaseUrl) {
      throw new Error('Visit evidence tests require DATABASE_URL to be the named disposable URL');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const names = await prisma.client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    const sids = await prisma.client.$queryRawUnsafe<Array<{ sid: string }>>(
      'SELECT system_identifier::text AS sid FROM pg_control_system()',
    );
    const comments = await prisma.client.$queryRaw<Array<{ comment: string | null }>>`
      SELECT shobj_description(oid, 'pg_database') AS comment
      FROM pg_database
      WHERE datname = current_database()
    `;
    const live = {
      name: names[0]?.name,
      sid: sids[0]?.sid,
      comment: comments[0]?.comment,
    };
    if (!live || live.name !== expectedName || live.sid !== expectedSystemIdentifier || live.comment !== expectedComment) {
      throw new Error('Visit evidence tests refused the live database identity');
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function register(role: 'OWNER' | 'STAFF' = 'OWNER', salonId?: string) {
    const email = `${role.toLowerCase()}-${randomUUID()}@example.test`;
    const phone = syntheticMobile();
    const userId = randomUUID();
    const tenantId = salonId ?? randomUUID();
    const now = new Date();
    if (!salonId) {
      await prisma.client.salon.create({ data: { id: tenantId, name: 'evidence salon', updatedAt: now } });
    }
    await prisma.client.user.create({
      data: {
        id: userId,
        salonId: tenantId,
        name: role,
        email,
        phone,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role,
        updatedAt: now,
      },
    });
    const login = await request(app.getHttpServer()).post('/auth/login/phone').send({ phone, password }).expect(201);
    return { token: login.body.accessToken as string, userId, salonId: tenantId };
  }

  function phone() {
    return `0912${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`;
  }

  async function createCustomer(token: string, phoneNumber = phone()) {
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'سارا', lastName: 'تست', phoneNumber })
      .expect(201);
    return response.body.id as string;
  }

  async function intention(input: {
    salonId: string;
    userId: string;
    subject: 'CUSTOMER' | 'VIP_PROSPECT';
    customerId?: string;
    vipRequestId?: string;
    contactBasis?: 'WITHHELD' | 'SALON_SUPPLIED';
    disclosedPhone?: string;
  }) {
    const id = randomUUID();
    await prisma.client.visitIntention.create({
      data: {
        id,
        salonId: input.salonId,
        subject: input.subject,
        customerId: input.customerId,
        vipRequestId: input.vipRequestId,
        contactBasis: input.contactBasis ?? 'WITHHELD',
        disclosedDisplayName: input.contactBasis === 'SALON_SUPPLIED' ? 'نگار' : null,
        disclosedPhone: input.disclosedPhone ?? null,
        timePrecision: 'UNKNOWN',
        reportChannel: input.subject === 'VIP_PROSPECT' ? 'INBOUND_TO_SALON' : 'SALON_STAFF',
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
      },
    });
    return id;
  }

  async function vipRequest(salonId: string, userId: string) {
    const adminId = randomUUID();
    const listId = randomUUID();
    const now = new Date();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email: `evidence-admin-${randomUUID()}@example.test`,
        phone: syntheticMobile(),
        name: 'اپراتور',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        updatedAt: now,
      },
    });
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: 'synthetic-list',
        status: 'IN_USE',
        contactCount: 1,
        createdByAdminId: adminId,
        reservedBySalonId: salonId,
        reservedAt: now,
        updatedAt: now,
      },
    });
    const requestId = randomUUID();
    await prisma.client.vipRequest.create({
      data: {
        id: requestId,
        salonId,
        listId,
        createdByUserId: userId,
        requestedCount: 30,
        geographicRange: 'تهران',
        status: 'SUBMITTED',
        reservedUntil: now,
        submittedAt: now,
        updatedAt: now,
      },
    });
    return requestId;
  }

  function arrive(token: string, id: string, body: Record<string, unknown>, key = `arrive-${randomUUID()}`) {
    return request(app.getHttpServer())
      .post(`/visit-intentions/${id}/arrive`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
  }

  async function counts(salonId: string) {
    const [customers, visits, transactions, intentions, commitments, messages, recipients] = await Promise.all([
      prisma.client.customer.count({ where: { salonId } }),
      prisma.client.visit.count({ where: { salonId } }),
      prisma.client.ledgerTransaction.count({ where: { salonId } }),
      prisma.client.visitIntention.count({ where: { salonId, linkedVisitId: { not: null } } }),
      prisma.client.returnCommitment.count({ where: { salonId } }),
      prisma.client.messageRequest.count({ where: { salonId } }),
      prisma.client.vipRequestRecipient.count({ where: { salonId, messageRequestId: { not: null } } }),
    ]);
    return { customers, visits, transactions, intentions, commitments, messages, recipients };
  }

  it('records a return only after a later visit, and a first visit is not a return', async () => {
    const salon = await register();
    const customerId = await createCustomer(salon.token);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `visit-${randomUUID()}`)
      .send({ customerId, visitedAt: '2026-09-01T10:00:00.000Z' })
      .expect(201);
    const returning = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'CUSTOMER',
      customerId,
    });
    const returned = await arrive(salon.token, returning, { visitedAt: '2026-10-02T10:00:00.000Z' });
    expect(returned.status).toBe(201);
    expect(returned.body.existingCustomerReturn).toBe(true);
    expect(returned.body.vipAcquisitionByVisit).toBe(false);
    expect(returned.body.saleRecorded).toBe(false);
    expect(returned.body.visitRecorded).toBe(true);

    const firstCustomer = await createCustomer(salon.token);
    const firstIntention = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'CUSTOMER',
      customerId: firstCustomer,
    });
    const first = await arrive(salon.token, firstIntention, { visitedAt: '2026-10-03T10:00:00.000Z' });
    expect(first.status).toBe(201);
    expect(first.body.existingCustomerReturn).toBe(false);
    expect(first.body.vipAcquisitionByVisit).toBe(false);
    expect(first.body.visitRecorded).toBe(true);
  });

  it('creates a VIP customer and visit atomically, with and without a sale', async () => {
    const salon = await register();
    const requestId = await vipRequest(salon.salonId, salon.userId);
    const service = await prisma.client.service.create({
      data: { id: randomUUID(), salonId: salon.salonId, name: 'کوتاهی', status: 'ACTIVE', updatedAt: new Date() },
    });
    const failedSaleId = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const failedSale = await arrive(salon.token, failedSaleId, {
      visitedAt: '2026-10-04T09:00:00.000Z',
      newCustomer: { firstName: 'نگار', lastName: 'نو', phoneNumber: phone() },
      sale: { serviceId: randomUUID(), amount: '1000.00', currency: 'IRR' },
    });
    expect(failedSale.status).toBe(404);
    expect(await counts(salon.salonId)).toMatchObject({ customers: 0, visits: 0, transactions: 0, intentions: 0 });
    const plainId = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
      contactBasis: 'WITHHELD',
    });
    const plainPhone = phone();
    const plain = await arrive(salon.token, plainId, {
      visitedAt: '2026-10-04T10:00:00.000Z',
      newCustomer: { firstName: 'نگار', lastName: 'نو', phoneNumber: plainPhone },
    });
    expect(plain.status).toBe(201);
    expect(plain.body.vipAcquisitionByVisit).toBe(true);
    expect(plain.body.existingCustomerReturn).toBe(false);
    expect(plain.body.saleRecorded).toBe(false);
    expect(plain.body.identityDisclosure).toBe('WITHHELD');
    expect(plain.body.disclosedPhone).toBeNull();
    expect(JSON.stringify(plain.body)).not.toContain(plainPhone);

    const saleId = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const sale = await arrive(salon.token, saleId, {
      visitedAt: '2026-10-05T10:00:00.000Z',
      newCustomer: { firstName: 'رها', lastName: 'نو', phoneNumber: phone() },
      sale: { serviceId: service.id, amount: '250000.00', currency: 'IRR' },
    });
    expect(sale.status).toBe(201);
    expect(sale.body.vipAcquisitionByVisit).toBe(true);
    expect(sale.body.saleRecorded).toBe(true);
    const after = await counts(salon.salonId);
    expect(after.customers).toBe(2);
    expect(after.visits).toBe(2);
    expect(after.transactions).toBe(1);
    expect(after.messages).toBe(0);
    expect(after.recipients).toBe(0);
    expect(after.commitments).toBe(0);
  });

  it('rolls back an invalid new customer and does not merge a duplicate phone', async () => {
    const salon = await register();
    const requestId = await vipRequest(salon.salonId, salon.userId);
    const existingPhone = phone();
    await createCustomer(salon.token, existingPhone);
    const invalidId = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const before = await counts(salon.salonId);
    const invalid = await arrive(salon.token, invalidId, {
      visitedAt: '2026-10-06T10:00:00.000Z',
      newCustomer: { firstName: '', lastName: 'نو', phoneNumber: phone() },
    });
    expect(invalid.status).toBe(400);
    const duplicateId = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const duplicate = await arrive(salon.token, duplicateId, {
      visitedAt: '2026-10-06T11:00:00.000Z',
      newCustomer: { firstName: 'نگار', lastName: 'نو', phoneNumber: existingPhone },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('CUSTOMER_PHONE_EXISTS');
    expect(await counts(salon.salonId)).toEqual(before);
    const audits = await prisma.client.auditLog.findMany({ where: { tenantId: salon.salonId } });
    expect(JSON.stringify(audits)).not.toContain(existingPhone);
  });

  it('replays the same arrival and rejects a different body, duplicate arrival, and another salon', async () => {
    const salon = await register();
    const other = await register();
    const requestId = await vipRequest(salon.salonId, salon.userId);
    const id = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const body = {
      visitedAt: '2026-10-07T10:00:00.000Z',
      newCustomer: { firstName: 'نگار', lastName: 'نو', phoneNumber: phone() },
    };
    const key = `arrive-${randomUUID()}`;
    const first = await arrive(salon.token, id, body, key);
    expect(first.status).toBe(201);
    const replay = await arrive(salon.token, id, body, key);
    expect(replay.status).toBe(201);
    expect(replay.body.linkedVisitId).toBe(first.body.linkedVisitId);
    const conflict = await arrive(salon.token, id, {
      ...body,
      newCustomer: { ...body.newCustomer, lastName: 'دیگر' },
    }, key);
    expect(conflict.status).toBe(409);
    const again = await arrive(salon.token, id, body);
    expect(again.status).toBe(409);
    const foreignCustomer = await createCustomer(other.token);
    const otherIntention = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const foreign = await arrive(salon.token, otherIntention, {
      visitedAt: '2026-10-07T12:00:00.000Z',
      customerId: foreignCustomer,
    });
    expect(foreign.status).toBe(404);
    expect(await prisma.client.customer.count({ where: { salonId: salon.salonId } })).toBe(1);
    expect(await prisma.client.visit.count({ where: { salonId: salon.salonId } })).toBe(1);
  });

  it('lets one concurrent create win and leaves the other with no customer', async () => {
    const salon = await register();
    const requestId = await vipRequest(salon.salonId, salon.userId);
    const shared = phone();
    const firstId = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const secondId = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const body = {
      visitedAt: '2026-10-08T10:00:00.000Z',
      newCustomer: { firstName: 'نگار', lastName: 'نو', phoneNumber: shared },
    };
    const [left, right] = await Promise.all([
      arrive(salon.token, firstId, body),
      arrive(salon.token, secondId, body),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect([left.body.error, right.body.error]).toContain('CUSTOMER_PHONE_EXISTS');
    expect(await prisma.client.customer.count({ where: { salonId: salon.salonId, phoneNumber: shared } })).toBe(1);
    expect(await prisma.client.visit.count({ where: { salonId: salon.salonId } })).toBe(1);
  });

  it('refuses a staff sale and does not treat an independent visit as VIP acquisition', async () => {
    const owner = await register();
    const staff = await register('STAFF', owner.salonId);
    const requestId = await vipRequest(owner.salonId, owner.userId);
    const service = await prisma.client.service.create({
      data: { id: randomUUID(), salonId: owner.salonId, name: 'رنگ', status: 'ACTIVE', updatedAt: new Date() },
    });
    const id = await intention({
      salonId: owner.salonId,
      userId: owner.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const denied = await arrive(staff.token, id, {
      visitedAt: '2026-10-09T10:00:00.000Z',
      newCustomer: { firstName: 'نگار', lastName: 'نو', phoneNumber: phone() },
      sale: { serviceId: service.id, amount: '1000.00', currency: 'IRR' },
    });
    expect(denied.status).toBe(403);
    expect(await counts(owner.salonId)).toMatchObject({ customers: 0, visits: 0, transactions: 0 });
    const customerId = await createCustomer(owner.token);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('Idempotency-Key', `visit-${randomUUID()}`)
      .send({ customerId, visitedAt: '2026-10-09T11:00:00.000Z' })
      .expect(201);
    const open = await request(app.getHttpServer())
      .get(`/vip/requests/${requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(open.body.items[0].operationallyOpen).toBe(true);
    expect(open.body.items[0].vipAcquisitionByVisit).toBe(false);
    const chosen = await arrive(owner.token, id, {
      visitedAt: '2026-10-09T12:00:00.000Z',
      customerId,
    });
    expect(chosen.status).toBe(201);
    expect(chosen.body.vipAcquisitionByVisit).toBe(false);
    expect(chosen.body.existingCustomerReturn).toBe(true);
  });

  it('creates an ordinary customer once and rejects a duplicate phone without the VIP error', async () => {
    const salon = await register();
    const shared = phone();
    const created = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ firstName: 'سارا', lastName: 'تست', phoneNumber: shared })
      .expect(201);
    expect(created.body.phoneNumber).toBe(shared);
    const duplicate = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ firstName: 'سارا', lastName: 'دیگر', phoneNumber: shared });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('CONFLICT');

    const raced = phone();
    const [winner, loser] = await Promise.all([
      request(app.getHttpServer())
        .post('/customers')
        .set('Authorization', `Bearer ${salon.token}`)
        .send({ firstName: 'نرگس', lastName: 'همزمان', phoneNumber: raced }),
      request(app.getHttpServer())
        .post('/customers')
        .set('Authorization', `Bearer ${salon.token}`)
        .send({ firstName: 'نرگس', lastName: 'دیگر', phoneNumber: raced }),
    ]);
    expect([winner.status, loser.status].sort()).toEqual([201, 409]);
    expect([winner.body.error, loser.body.error]).toContain('CONFLICT');
    expect(await prisma.client.customer.count({ where: { salonId: salon.salonId, phoneNumber: raced } })).toBe(1);
  });

  it('reclassifies VIP acquisition when an earlier visit is recorded later', async () => {
    const salon = await register();
    const requestId = await vipRequest(salon.salonId, salon.userId);
    const id = await intention({
      salonId: salon.salonId,
      userId: salon.userId,
      subject: 'VIP_PROSPECT',
      vipRequestId: requestId,
    });
    const arrived = await arrive(salon.token, id, {
      visitedAt: '2026-10-04T10:00:00.000Z',
      newCustomer: { firstName: 'نگار', lastName: 'نو', phoneNumber: phone() },
    });
    expect(arrived.status).toBe(201);
    expect(arrived.body.vipAcquisitionByVisit).toBe(true);
    expect(arrived.body.existingCustomerReturn).toBe(false);
    const linkedVisitId = arrived.body.linkedVisitId as string;
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `visit-${randomUUID()}`)
      .send({ customerId: arrived.body.linkedCustomerId, visitedAt: '2026-09-01T10:00:00.000Z' })
      .expect(201);
    const listed = await request(app.getHttpServer())
      .get(`/vip/requests/${requestId}/visit-intentions`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const row = listed.body.items.find((item: { id: string }) => item.id === id);
    expect(row.linkedVisitId).toBe(linkedVisitId);
    expect(row.visitRecorded).toBe(true);
    expect(row.saleRecorded).toBe(false);
    expect(row.vipAcquisitionByVisit).toBe(false);
    expect(row.existingCustomerReturn).toBe(true);
  });
});

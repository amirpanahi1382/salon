import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';
const adminPassword = 'platform-admin-pass';
const WEEK_START = '2026-09-11T20:30:00.000Z';

describeIfDb('Operational ReturnCommitment settlement without attribution (e2e)', () => {
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

    const adminEmail = `platform-admin-ops-${Date.now()}@example.test`;
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

  async function registerOwner(label: string) {
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

  async function createCustomer(token: string, lastName: string, phone?: string) {
    const phoneNumber =
      phone ?? `0912${Math.floor(1000000 + Math.random() * 9000000).toString()}`;
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Sara', lastName, phoneNumber })
      .expect(201);
    return { id: response.body.id as string, phone: response.body.phoneNumber as string };
  }

  async function insertSentMessage(input: {
    salonId: string;
    userId: string;
    customerId: string;
    submittedAt: Date;
  }) {
    const requestId = randomUUID();
    const requestedAt = new Date(input.submittedAt.getTime() - 60 * 60 * 1000);
    await prisma.client.messageRequest.create({
      data: {
        id: requestId,
        salonId: input.salonId,
        customerId: input.customerId,
        createdByUserId: input.userId,
        messageText: 'سلام',
        requestedAt,
        messageBusinessDate: new Date('2026-01-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'SENT',
        createdAt: requestedAt,
        updatedAt: requestedAt,
      },
    });
    const deliveryId = randomUUID();
    await prisma.client.messageDelivery.create({
      data: {
        id: deliveryId,
        salonId: input.salonId,
        messageRequestId: requestId,
        customerId: input.customerId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: 'SENT',
        providerRequestId: randomUUID(),
        createdBy: input.userId,
        createdAt: requestedAt,
        updatedAt: input.submittedAt,
        submittedAt: input.submittedAt,
      },
    });
    return { requestId, deliveryId };
  }

  async function createCommitment(token: string, requestId: string, expectedAt: string) {
    return request(app.getHttpServer())
      .post(`/messages/${requestId}/return-commitments`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `rc-${randomUUID()}`)
      .send({ expectedAt })
      .expect(201);
  }

  function futureIso(hours = 48) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  async function openCustomerIds(token: string): Promise<string[]> {
    const open = await request(app.getHttpServer())
      .get('/return-commitments/open')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (open.body.items as Array<{ customerId: string }>).map((row) => row.customerId);
  }

  it('TEST 1 explicit arrive sets actualVisitId, leaves the open list, and is COMMITMENT_BACKED', async () => {
    const salon = await registerOwner('ops-arrive');
    const customer = await createCustomer(salon.token, 'Arrive');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt,
    });
    const created = await createCommitment(salon.token, message.requestId, futureIso());
    const arrived = await request(app.getHttpServer())
      .post(`/return-commitments/${created.body.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arrive-${randomUUID()}`)
      .send({ visitedAt: new Date().toISOString() })
      .expect(201);
    expect(arrived.body.actualVisitId).toBeTruthy();
    expect(arrived.body.operationallyOpen).toBe(false);
    expect(arrived.body.commitmentBackedReturn.associationKind).toBe('COMMITMENT_BACKED');
    expect(await openCustomerIds(salon.token)).not.toContain(customer.id);
  });

  it('TEST 2 normal Visit settles operations without actualVisitId or COMMITMENT_BACKED and keeps OBSERVED', async () => {
    const salon = await registerOwner('ops-visit');
    const customer = await createCustomer(salon.token, 'Visit');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt,
    });
    const created = await createCommitment(salon.token, message.requestId, futureIso());
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `visit-${randomUUID()}`)
      .send({ customerId: customer.id, visitedAt: new Date().toISOString() })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(listed.body.items[0].id).toBe(created.body.id);
    expect(listed.body.items[0].actualVisitId).toBeNull();
    expect(listed.body.items[0].operationallyOpen).toBe(false);
    expect(listed.body.items[0].commitmentBackedReturn).toBeNull();
    expect(await openCustomerIds(salon.token)).not.toContain(customer.id);

    const observed = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/observed-returns`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(
      observed.body.items.some(
        (row: { observedReturn: { visitId: string } }) => row.observedReturn.visitId === visit.body.id,
      ),
    ).toBe(true);
  });

  it('TEST 3 complete-with-sale settles operations and does not enter CB headline revenue', async () => {
    const salon = await registerOwner('ops-sale');
    const customer = await createCustomer(salon.token, 'Sale');
    const submittedAt = new Date('2026-09-12T08:00:00.000Z');
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt,
    });
    await prisma.client.returnCommitment.create({
      data: {
        id: randomUUID(),
        salonId: salon.tenantId,
        customerId: customer.id,
        sourceMessageRequestId: message.requestId,
        sourceMessageDeliveryId: message.deliveryId,
        expectedAt: new Date('2026-09-20T10:00:00.000Z'),
        createdByUserId: salon.userId,
        updatedByUserId: salon.userId,
        updatedAt: new Date('2026-09-12T09:00:00.000Z'),
        createdAt: new Date('2026-09-12T09:00:00.000Z'),
      },
    });
    const service = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: `Cut ${randomUUID().slice(0, 8)}` })
      .expect(201);
    const sold = await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `sale-${randomUUID()}`)
      .send({
        customerId: customer.id,
        visitedAt: '2026-09-13T10:00:00.000Z',
        serviceId: service.body.id,
        amount: '150000.00',
        currency: 'IRR',
      })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(listed.body.items[0].actualVisitId).toBeNull();
    expect(listed.body.items[0].operationallyOpen).toBe(false);
    expect(await openCustomerIds(salon.token)).not.toContain(customer.id);

    const summary = await request(app.getHttpServer())
      .get('/recovery/outcomes/summary')
      .query({ weekStart: WEEK_START })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(summary.body.commitmentBackedReturns).toBe(0);
    expect(summary.body.commitmentBackedRecordedRevenue).toEqual({
      recorded: false,
      currency: 'IRR',
      amount: null,
    });
    expect(summary.body.observedReturns).toBeGreaterThanOrEqual(1);

    const intelligence = await request(app.getHttpServer())
      .get(`/intelligence/customers/${customer.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(intelligence.body.behavior.lastVisitAt).toBe(sold.body.visit.visitedAt);
  });

  it('TEST 4 a Visit before SENT does not settle the commitment', async () => {
    const salon = await registerOwner('ops-before');
    const customer = await createCustomer(salon.token, 'Before');
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `before-${randomUUID()}`)
      .send({ customerId: customer.id, visitedAt: '2026-09-01T10:00:00.000Z' })
      .expect(201);
    const submittedAt = new Date('2026-09-10T10:00:00.000Z');
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt,
    });
    const created = await createCommitment(salon.token, message.requestId, futureIso());
    expect(created.body.operationallyOpen).toBe(true);
    expect(await openCustomerIds(salon.token)).toContain(customer.id);
  });

  it('TEST 5 visitedAt equal to submittedAt does not settle', async () => {
    const salon = await registerOwner('ops-eq');
    const customer = await createCustomer(salon.token, 'Equal');
    const submittedAt = new Date('2026-09-10T10:00:00.000Z');
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt,
    });
    await createCommitment(salon.token, message.requestId, futureIso());
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `eq-${randomUUID()}`)
      .send({ customerId: customer.id, visitedAt: submittedAt.toISOString() })
      .expect(201);
    const listed = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(listed.body.items[0].operationallyOpen).toBe(true);
    expect(listed.body.items[0].actualVisitId).toBeNull();
    expect(await openCustomerIds(salon.token)).toContain(customer.id);
  });

  it('TEST 6 late-recorded commitment is operationally settled by an earlier later-than-SENT Visit', async () => {
    const salon = await registerOwner('ops-late');
    const customer = await createCustomer(salon.token, 'Late');
    const submittedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt,
    });
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `late-v-${randomUUID()}`)
      .send({ customerId: customer.id, visitedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .expect(201);
    const created = await createCommitment(salon.token, message.requestId, futureIso());
    expect(created.body.actualVisitId).toBeNull();
    expect(created.body.operationallyOpen).toBe(false);
    expect(created.body.commitmentBackedReturn).toBeNull();
    expect(await openCustomerIds(salon.token)).not.toContain(customer.id);
  });

  it('TEST 7 settles each unlinked commitment independently and displays only remaining open rows', async () => {
    const salon = await registerOwner('ops-multi');
    const customer = await createCustomer(salon.token, 'Multi');
    const first = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt: new Date('2026-09-10T08:00:00.000Z'),
    });
    const second = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt: new Date('2026-09-12T08:00:00.000Z'),
    });
    const laterExpected = futureIso(72);
    const earlierExpected = futureIso(24);
    const firstCommitment = await createCommitment(salon.token, first.requestId, laterExpected);
    const secondCommitment = await createCommitment(salon.token, second.requestId, earlierExpected);

    const before = await request(app.getHttpServer())
      .get('/return-commitments/open')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const beforeRows = before.body.items.filter((row: { customerId: string }) => row.customerId === customer.id);
    expect(beforeRows).toHaveLength(1);
    expect(beforeRows[0].expectedAt).toBe(earlierExpected);
    expect(beforeRows[0].id).toBe(secondCommitment.body.id);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `multi-${randomUUID()}`)
      .send({ customerId: customer.id, visitedAt: '2026-09-11T08:00:00.000Z' })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const byId = new Map(
      (listed.body.items as Array<{ id: string; operationallyOpen: boolean }>).map((row) => [
        row.id,
        row.operationallyOpen,
      ]),
    );
    expect(byId.get(firstCommitment.body.id)).toBe(false);
    expect(byId.get(secondCommitment.body.id)).toBe(true);

    const after = await request(app.getHttpServer())
      .get('/return-commitments/open')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const afterRows = after.body.items.filter((row: { customerId: string }) => row.customerId === customer.id);
    expect(afterRows).toHaveLength(1);
    expect(afterRows[0].id).toBe(secondCommitment.body.id);
    expect(afterRows[0].expectedAt).toBe(earlierExpected);
  });

  it('TEST 8 admin-created commitment disappears from the salon open list after a later Visit', async () => {
    const salon = await registerOwner('ops-adm');
    const customer = await createCustomer(salon.token, 'AdminOp');
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    const created = await request(app.getHttpServer())
      .post(`/admin/message-queue/${message.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `adm-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(201);
    expect(created.body.recordedBySupport).toBe(true);
    expect(await openCustomerIds(salon.token)).toContain(customer.id);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `adm-v-${randomUUID()}`)
      .send({ customerId: customer.id, visitedAt: new Date().toISOString() })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(listed.body.items[0].actualVisitId).toBeNull();
    expect(listed.body.items[0].operationallyOpen).toBe(false);
    expect(listed.body.items[0].recordedBySupport).toBe(true);
    expect(await openCustomerIds(salon.token)).not.toContain(customer.id);
  });

  it('TEST 9 a Visit in salon B never settles salon A', async () => {
    const salonA = await registerOwner('ops-iso-a');
    const salonB = await registerOwner('ops-iso-b');
    const phone = `0912${Math.floor(1000000 + Math.random() * 9000000).toString()}`;
    const customerA = await createCustomer(salonA.token, 'IsoA', phone);
    const customerB = await createCustomer(salonB.token, 'IsoB', phone);
    const message = await insertSentMessage({
      salonId: salonA.tenantId,
      userId: salonA.userId,
      customerId: customerA.id,
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    await createCommitment(salonA.token, message.requestId, futureIso());
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonB.token}`)
      .set('Idempotency-Key', `iso-b-${randomUUID()}`)
      .send({ customerId: customerB.id, visitedAt: new Date().toISOString() })
      .expect(201);
    expect(await openCustomerIds(salonA.token)).toContain(customerA.id);
    const listed = await request(app.getHttpServer())
      .get(`/customers/${customerA.id}/return-commitments`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listed.body.items[0].operationallyOpen).toBe(true);
  });

  it('TEST 10 SENT without a commitment still follows existing OBSERVED rules after a later Visit', async () => {
    const salon = await registerOwner('ops-obs');
    const customer = await createCustomer(salon.token, 'Obs');
    await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `obs-${randomUUID()}`)
      .send({ customerId: customer.id, visitedAt: new Date().toISOString() })
      .expect(201);
    const commitments = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(commitments.body.items).toHaveLength(0);
    const observed = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/observed-returns`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(
      observed.body.items.some(
        (row: { observedReturn: { visitId: string } }) => row.observedReturn.visitId === visit.body.id,
      ),
    ).toBe(true);
  });

  it('TEST 11 explicit link-visit still sets actualVisitId and COMMITMENT_BACKED', async () => {
    const salon = await registerOwner('ops-link');
    const customer = await createCustomer(salon.token, 'Link');
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    const created = await createCommitment(salon.token, message.requestId, futureIso());
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `link-v-${randomUUID()}`)
      .send({ customerId: customer.id, visitedAt: new Date().toISOString() })
      .expect(201);
    const linked = await request(app.getHttpServer())
      .post(`/return-commitments/${created.body.id}/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `link-${randomUUID()}`)
      .send({ visitId: visit.body.id })
      .expect(201);
    expect(linked.body.actualVisitId).toBe(visit.body.id);
    expect(linked.body.commitmentBackedReturn.associationKind).toBe('COMMITMENT_BACKED');
    expect(linked.body.operationallyOpen).toBe(false);
  });

  it('TEST 12 unlinked COMPLETED revenue stays out of CB headline; explicit CB revenue stays in', async () => {
    const salon = await registerOwner('ops-rev');
    const unlinkedCustomer = await createCustomer(salon.token, 'UnlinkedRev');
    const linkedCustomer = await createCustomer(salon.token, 'LinkedRev');
    const service = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: `Color ${randomUUID().slice(0, 8)}` })
      .expect(201);

    const unlinkedMessage = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: unlinkedCustomer.id,
      submittedAt: new Date('2026-09-12T08:00:00.000Z'),
    });
    await prisma.client.returnCommitment.create({
      data: {
        id: randomUUID(),
        salonId: salon.tenantId,
        customerId: unlinkedCustomer.id,
        sourceMessageRequestId: unlinkedMessage.requestId,
        sourceMessageDeliveryId: unlinkedMessage.deliveryId,
        expectedAt: new Date('2026-09-20T10:00:00.000Z'),
        createdByUserId: salon.userId,
        updatedByUserId: salon.userId,
        updatedAt: new Date(),
      },
    });
    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rev-u-${randomUUID()}`)
      .send({
        customerId: unlinkedCustomer.id,
        visitedAt: '2026-09-13T11:00:00.000Z',
        serviceId: service.body.id,
        amount: '200000.00',
        currency: 'IRR',
      })
      .expect(201);

    const linkedMessage = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: linkedCustomer.id,
      submittedAt: new Date('2026-09-12T09:00:00.000Z'),
    });
    const linkedCommitment = await prisma.client.returnCommitment.create({
      data: {
        id: randomUUID(),
        salonId: salon.tenantId,
        customerId: linkedCustomer.id,
        sourceMessageRequestId: linkedMessage.requestId,
        sourceMessageDeliveryId: linkedMessage.deliveryId,
        expectedAt: new Date('2026-09-20T10:00:00.000Z'),
        createdByUserId: salon.userId,
        updatedByUserId: salon.userId,
        updatedAt: new Date(),
      },
    });
    const arrived = await request(app.getHttpServer())
      .post(`/return-commitments/${linkedCommitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rev-a-${randomUUID()}`)
      .send({
        visitedAt: '2026-09-13T12:00:00.000Z',
        sale: { serviceId: service.body.id, amount: '300000.00', currency: 'IRR' },
      })
      .expect(201);

    const summary = await request(app.getHttpServer())
      .get('/recovery/outcomes/summary')
      .query({ weekStart: WEEK_START })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(summary.body.commitmentBackedReturns).toBe(1);
    expect(summary.body.commitmentBackedRecordedRevenue).toEqual({
      recorded: true,
      currency: 'IRR',
      amount: '300000.00',
    });

    const cb = await request(app.getHttpServer())
      .get('/recovery/outcomes/returns')
      .query({ kind: 'COMMITMENT_BACKED', weekStart: WEEK_START })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(cb.body.items).toHaveLength(1);
    expect(cb.body.items[0].visitId).toBe(arrived.body.actualVisitId);

    const observed = await request(app.getHttpServer())
      .get('/recovery/outcomes/returns')
      .query({ kind: 'OBSERVED', weekStart: WEEK_START })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(
      observed.body.items.some((row: { customer: { id: string } }) => row.customer.id === unlinkedCustomer.id),
    ).toBe(true);
    expect(
      observed.body.items.some((row: { visitId: string }) => row.visitId === arrived.body.actualVisitId),
    ).toBe(false);
  });
});

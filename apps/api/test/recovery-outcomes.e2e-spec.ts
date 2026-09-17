import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { listPage } from './list-page';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';
const WEEK_START = '2026-09-11T20:30:00.000Z';
const WEEK_END = '2026-09-18T20:30:00.000Z';

type Summary = {
  period: { timezone: string; start: string; end: string; current: boolean };
  sentFollowUps: number;
  returnCommitmentsRecorded: number;
  commitmentBackedReturns: number;
  commitmentBackedRecordedRevenue: { recorded: boolean; currency: string; amount: string | null };
  observedReturns: number;
  messagingExecution: { medianRequestToSentLatencyMs: number | null };
};

type ReturnItem = {
  associationKind: string;
  visitId: string;
  customer: { id: string };
  associatedRevenue: { recorded: boolean; amount: string | null };
};

describeIfDb('Owner recovery outcomes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return {
      email,
      token: login.body.accessToken as string,
      userId: login.body.user.id as string,
      tenantId: login.body.user.tenantId as string,
    };
  }

  async function createCustomer(token: string, lastName: string) {
    const phone = `0912${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 9)}`.slice(0, 11);
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Sara', lastName, phoneNumber: phone })
      .expect(201);
    return response.body.id as string;
  }

  async function insertCustomerMessage(input: {
    salonId: string;
    userId: string;
    customerId: string | null;
    requestedAt: Date;
    submittedAt: Date | null;
    status: 'QUEUED' | 'SENT' | 'FAILED' | 'PROCESSING';
    vipRequestId?: string | null;
    recipientPhoneNumber?: string | null;
  }) {
    const requestId = randomUUID();
    const now = input.submittedAt ?? input.requestedAt;
    await prisma.client.messageRequest.create({
      data: {
        id: requestId,
        salonId: input.salonId,
        customerId: input.customerId,
        createdByUserId: input.userId,
        messageText: 'سلام',
        requestedAt: input.requestedAt,
        messageBusinessDate: new Date('2026-01-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: input.status === 'PROCESSING' ? 'DISPATCHED' : input.status === 'QUEUED' ? 'QUEUED' : input.status,
        vipRequestId: input.vipRequestId ?? null,
        recipientDisplayName: input.vipRequestId ? 'VIP' : null,
        recipientPhoneNumber: input.recipientPhoneNumber ?? null,
        createdAt: input.requestedAt,
        updatedAt: now,
      },
    });
    if (input.status === 'QUEUED') {
      return { requestId, deliveryId: null as string | null };
    }
    const deliveryId = randomUUID();
    await prisma.client.messageDelivery.create({
      data: {
        id: deliveryId,
        salonId: input.salonId,
        messageRequestId: requestId,
        customerId: input.customerId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: input.status === 'PROCESSING' ? 'PROCESSING' : input.status,
        providerRequestId: randomUUID(),
        createdBy: input.userId,
        createdAt: input.requestedAt,
        updatedAt: now,
        submittedAt: input.status === 'SENT' ? input.submittedAt : null,
        failedAt: input.status === 'FAILED' ? now : null,
      },
    });
    return { requestId, deliveryId };
  }

  async function insertCommitment(input: {
    salonId: string;
    userId: string;
    customerId: string;
    requestId: string;
    deliveryId: string;
    createdAt: Date;
    expectedAt: Date;
    visitId?: string | null;
  }) {
    const id = randomUUID();
    await prisma.client.returnCommitment.create({
      data: {
        id,
        salonId: input.salonId,
        customerId: input.customerId,
        sourceMessageRequestId: input.requestId,
        sourceMessageDeliveryId: input.deliveryId,
        expectedAt: input.expectedAt,
        actualVisitId: input.visitId ?? null,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    });
    return id;
  }

  function summary(token: string, weekStart = WEEK_START) {
    return request(app.getHttpServer())
      .get('/recovery/outcomes/summary')
      .query({ weekStart })
      .set('Authorization', `Bearer ${token}`);
  }

  it('rejects unauthenticated and STAFF access; allows MANAGER', async () => {
    const salon = await registerOwner('ro-rbac');
    await request(app.getHttpServer()).get('/recovery/outcomes/summary').expect(401);

    const staffEmail = `ro-staff-${randomUUID()}@example.test`;
    const managerEmail = `ro-mgr-${randomUUID()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: 'Manager', email: managerEmail, password, role: 'MANAGER' })
      .expect(201);
    const staffToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: staffEmail, password })
    ).body.accessToken as string;
    const managerToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: managerEmail, password })
    ).body.accessToken as string;

    await request(app.getHttpServer())
      .get('/recovery/outcomes/summary')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/recovery/outcomes/summary')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
  });

  it('applies Tehran Saturday week bounds, SENT eligibility, commitments, chronology, revenue, OBSERVED, and isolation', async () => {
    const salon = await registerOwner('ro-week');
    const other = await registerOwner('ro-week-x');
    const customerId = await createCustomer(salon.token, 'Week');
    const secondCustomer = await createCustomer(salon.token, 'Two');
    const otherCustomer = await createCustomer(other.token, 'Other');
    const service = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: `Cut ${randomUUID().slice(0, 8)}` })
      .expect(201);
    const serviceId = service.body.id as string;

    const includedSent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-11T19:00:00.000Z'),
      submittedAt: new Date(WEEK_START),
      status: 'SENT',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-11T20:00:00.000Z'),
      submittedAt: new Date('2026-09-11T20:29:59.000Z'),
      status: 'SENT',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-18T19:00:00.000Z'),
      submittedAt: new Date(WEEK_END),
      status: 'SENT',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-12T10:00:00.000Z'),
      submittedAt: new Date('2026-09-12T11:00:00.000Z'),
      status: 'FAILED',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-12T12:00:00.000Z'),
      submittedAt: null,
      status: 'PROCESSING',
    });
    await insertCustomerMessage({
      salonId: other.tenantId,
      userId: other.userId,
      customerId: otherCustomer,
      requestedAt: new Date(WEEK_START),
      submittedAt: new Date('2026-09-12T08:00:00.000Z'),
      status: 'SENT',
    });

    await insertCommitment({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestId: includedSent.requestId,
      deliveryId: includedSent.deliveryId!,
      createdAt: new Date(WEEK_START),
      expectedAt: new Date('2026-09-20T10:00:00.000Z'),
    });
    const extraSent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: secondCustomer,
      requestedAt: new Date('2026-09-12T09:00:00.000Z'),
      submittedAt: new Date('2026-09-12T09:05:00.000Z'),
      status: 'SENT',
    });
    await insertCommitment({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: secondCustomer,
      requestId: extraSent.requestId,
      deliveryId: extraSent.deliveryId!,
      createdAt: new Date('2026-09-11T20:29:59.000Z'),
      expectedAt: new Date('2026-09-20T10:00:00.000Z'),
    });

    const firstVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId, visitedAt: '2026-09-13T10:00:00.000Z' })
      .expect(201);
    const firstVisitId = firstVisit.body.id as string;
    await request(app.getHttpServer())
      .post(`/return-commitments/${
        (
          await prisma.client.returnCommitment.findFirstOrThrow({
            where: { sourceMessageRequestId: includedSent.requestId },
          })
        ).id
      }/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `ro-link-${randomUUID()}`)
      .send({ visitId: firstVisitId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `ro-tx1-${randomUUID()}`)
      .send({
        customerId,
        visitId: firstVisitId,
        occurredAt: '2026-09-13T10:00:00.000Z',
        amount: '100.00',
        currency: 'IRR',
        items: [{ serviceId, quantity: 1, unitPrice: '100.00' }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `ro-tx2-${randomUUID()}`)
      .send({
        customerId,
        visitId: firstVisitId,
        occurredAt: '2026-09-13T11:00:00.000Z',
        amount: '50.50',
        currency: 'IRR',
        items: [{ serviceId, quantity: 1, unitPrice: '50.50' }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `ro-unlinked-${randomUUID()}`)
      .send({
        customerId,
        occurredAt: '2026-09-13T12:00:00.000Z',
        amount: '999.00',
        currency: 'IRR',
        items: [{ serviceId, quantity: 1, unitPrice: '999.00' }],
      })
      .expect(201);

    const secondSent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-12T14:00:00.000Z'),
      submittedAt: new Date('2026-09-12T14:00:00.000Z'),
      status: 'SENT',
    });
    const secondVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId, visitedAt: '2026-09-14T10:00:00.000Z' })
      .expect(201);
    const secondVisitId = secondVisit.body.id as string;
    await insertCommitment({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestId: secondSent.requestId,
      deliveryId: secondSent.deliveryId!,
      createdAt: new Date('2026-09-12T15:00:00.000Z'),
      expectedAt: new Date('2026-09-20T10:00:00.000Z'),
      visitId: secondVisitId,
    });

    const zeroSent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: secondCustomer,
      requestedAt: new Date('2026-09-13T08:00:00.000Z'),
      submittedAt: new Date('2026-09-13T08:00:00.000Z'),
      status: 'SENT',
    });
    const zeroVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: secondCustomer, visitedAt: '2026-09-15T10:00:00.000Z' })
      .expect(201);
    const zeroVisitId = zeroVisit.body.id as string;
    await insertCommitment({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: secondCustomer,
      requestId: zeroSent.requestId,
      deliveryId: zeroSent.deliveryId!,
      createdAt: new Date('2026-09-13T09:00:00.000Z'),
      expectedAt: new Date('2026-09-21T10:00:00.000Z'),
      visitId: zeroVisitId,
    });
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `ro-zero-${randomUUID()}`)
      .send({
        customerId: secondCustomer,
        visitId: zeroVisitId,
        occurredAt: '2026-09-15T10:00:00.000Z',
        amount: '0.00',
        currency: 'IRR',
        items: [{ serviceId, quantity: 1, unitPrice: '0.00' }],
      })
      .expect(201);

    const preSent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-16T10:00:00.000Z'),
      submittedAt: new Date('2026-09-16T12:00:00.000Z'),
      status: 'SENT',
    });
    const oldVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId, visitedAt: '2026-09-16T11:00:00.000Z' })
      .expect(201);
    await insertCommitment({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestId: preSent.requestId,
      deliveryId: preSent.deliveryId!,
      createdAt: new Date('2026-09-16T13:00:00.000Z'),
      expectedAt: new Date('2026-09-22T10:00:00.000Z'),
      visitId: oldVisit.body.id as string,
    });

    const observedSent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: secondCustomer,
      requestedAt: new Date('2026-05-01T10:00:00.000Z'),
      submittedAt: new Date('2026-05-01T10:00:00.000Z'),
      status: 'SENT',
    });
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: secondCustomer, visitedAt: '2026-09-17T10:00:00.000Z' })
      .expect(201);

    const adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email: `ro-admin-${randomUUID()}@example.test`,
        passwordHash: 'hash',
        name: 'Admin',
        updatedAt: new Date(),
      },
    });
    const listId = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: 'ro-vip-list',
        status: 'IN_USE',
        contactCount: 30,
        createdByAdminId: adminId,
        reservedBySalonId: salon.tenantId,
        reservedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const vipRequestId = randomUUID();
    await prisma.client.vipRequest.create({
      data: {
        id: vipRequestId,
        salonId: salon.tenantId,
        listId,
        createdByUserId: salon.userId,
        requestedCount: 30,
        geographicRange: 'ونک',
        status: 'SUBMITTED',
        reservedUntil: new Date(),
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: null,
      requestedAt: new Date('2026-09-12T16:00:00.000Z'),
      submittedAt: new Date('2026-09-12T16:00:00.000Z'),
      status: 'SENT',
      vipRequestId,
      recipientPhoneNumber: '09121112233',
    });

    const observedForLinked = await request(app.getHttpServer())
      .get(`/customers/${customerId}/observed-returns`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(
      listPage<{ observedReturn: { visitId: string } }>(observedForLinked.body).items.some(
        (row) => row.observedReturn.visitId === firstVisitId,
      ),
    ).toBe(true);

    const body = (await summary(salon.token).expect(200)).body as Summary;
    expect(body.period.timezone).toBe('Asia/Tehran');
    expect(body.period.start).toBe(WEEK_START);
    expect(body.period.end).toBe(WEEK_END);
    expect(body.sentFollowUps).toBe(5);
    expect(body.returnCommitmentsRecorded).toBe(4);
    expect(body.commitmentBackedReturns).toBe(3);
    expect(body.commitmentBackedRecordedRevenue).toEqual({
      recorded: true,
      currency: 'IRR',
      amount: '150.50',
    });
    expect(body.observedReturns).toBe(1);
    expect(body.messagingExecution.medianRequestToSentLatencyMs).not.toBeNull();

    const otherSummary = (await summary(other.token).expect(200)).body as Summary;
    expect(otherSummary.sentFollowUps).toBe(1);
    expect(otherSummary.commitmentBackedReturns).toBe(0);
    expect(otherSummary.commitmentBackedRecordedRevenue).toEqual({
      recorded: false,
      currency: 'IRR',
      amount: null,
    });
    expect(otherSummary.observedReturns).toBe(0);

    const cbPage = listPage<ReturnItem>(
      (
        await request(app.getHttpServer())
          .get('/recovery/outcomes/returns')
          .query({ kind: 'COMMITMENT_BACKED', weekStart: WEEK_START })
          .set('Authorization', `Bearer ${salon.token}`)
          .expect(200)
      ).body,
    );
    expect(cbPage.items).toHaveLength(3);
    expect(cbPage.items.every((row) => row.associationKind === 'COMMITMENT_BACKED')).toBe(true);
    expect(cbPage.items.map((row) => row.visitId).sort()).toEqual(
      [firstVisitId, secondVisitId, zeroVisitId].sort(),
    );
    expect(cbPage.items.some((row) => row.visitId === (oldVisit.body.id as string))).toBe(false);
    const firstRevenue = cbPage.items.find((row) => row.visitId === firstVisitId)?.associatedRevenue;
    expect(firstRevenue).toEqual({ recorded: true, currency: 'IRR', amount: '150.50' });
    const zeroRevenue = cbPage.items.find((row) => row.visitId === zeroVisitId)?.associatedRevenue;
    expect(zeroRevenue).toEqual({ recorded: true, currency: 'IRR', amount: '0.00' });
    const noneRevenue = cbPage.items.find((row) => row.visitId === secondVisitId)?.associatedRevenue;
    expect(noneRevenue).toEqual({ recorded: false, currency: 'IRR', amount: null });

    const observedPage = listPage<ReturnItem>(
      (
        await request(app.getHttpServer())
          .get('/recovery/outcomes/returns')
          .query({ kind: 'OBSERVED', weekStart: WEEK_START })
          .set('Authorization', `Bearer ${salon.token}`)
          .expect(200)
      ).body,
    );
    expect(observedPage.items).toHaveLength(1);
    expect(observedPage.items[0]?.associationKind).toBe('OBSERVED');
    expect(observedPage.items[0]?.customer.id).toBe(secondCustomer);
    expect(observedPage.items.some((row) => row.visitId === firstVisitId)).toBe(false);

    const voided = await prisma.client.ledgerTransaction.findFirstOrThrow({
      where: { salonId: salon.tenantId, visitId: firstVisitId, amount: '100.00' },
    });
    await request(app.getHttpServer())
      .post(`/transactions/${voided.id}/void`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(201);
    const afterVoid = (await summary(salon.token).expect(200)).body as Summary;
    expect(afterVoid.commitmentBackedRecordedRevenue.amount).toBe('50.50');

    await request(app.getHttpServer())
      .delete(`/visits/${secondVisitId}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(204);
    const afterUnlink = (await summary(salon.token).expect(200)).body as Summary;
    expect(afterUnlink.commitmentBackedReturns).toBe(2);
    expect(afterUnlink.observedReturns).toBe(1);

    await request(app.getHttpServer())
      .get('/recovery/outcomes/summary')
      .query({ weekStart: WEEK_START })
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(observedSent.deliveryId).toBeTruthy();
  });

  it('rejects a weekStart that is not Saturday 00:00 Tehran', async () => {
    const salon = await registerOwner('ro-bad-week');
    await request(app.getHttpServer())
      .get('/recovery/outcomes/summary')
      .query({ weekStart: '2026-09-12T00:00:00.000Z' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(400);
  });
});

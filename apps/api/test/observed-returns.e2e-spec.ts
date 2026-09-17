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

type ObservedItem = {
  associationKind: string;
  associationRule: string;
  intervention: {
    kind: string;
    origin: string;
    occurredAt: string;
    message: { requestId: string; deliveryId: string; requestedAt: string };
    actionId: string | null;
    opportunityType: string | null;
  };
  observedReturn: { visitId: string; occurredAt: string };
  associatedRevenue: { recorded: boolean; currency: string; amount: string | null };
};

describeIfDb('Observed returns (e2e)', () => {
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

  async function login(email: string) {
    return (
      await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201)
    ).body.accessToken as string;
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

  async function createService(token: string, name: string) {
    const response = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return response.body.id as string;
  }

  async function recordVisit(token: string, customerId: string, visitedAt: string) {
    const response = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, visitedAt })
      .expect(201);
    return response.body.id as string;
  }

  async function listObserved(token: string, customerId: string, cursor?: string) {
    const response = await request(app.getHttpServer())
      .get(`/customers/${customerId}/observed-returns`)
      .query(cursor ? { cursor } : {})
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return listPage<ObservedItem>(response.body);
  }

  async function insertCustomerMessage(input: {
    salonId: string;
    userId: string;
    customerId: string;
    requestedAt: Date;
    submittedAt: Date | null;
    createdAt?: Date;
    status: 'QUEUED' | 'SENT' | 'FAILED';
    actionId?: string | null;
    opportunityType?: 'REACTIVATION' | 'CUSTOMER_RETURN' | 'REVENUE_DECLINE' | null;
  }) {
    const requestId = randomUUID();
    const now = input.submittedAt ?? input.requestedAt;
    await prisma.client.messageRequest.create({
      data: {
        id: requestId,
        salonId: input.salonId,
        customerId: input.customerId,
        actionId: input.actionId ?? null,
        createdByUserId: input.userId,
        opportunityType: input.opportunityType ?? null,
        messageText: 'سلام',
        requestedAt: input.requestedAt,
        messageBusinessDate: new Date('2026-01-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: input.status === 'QUEUED' ? 'QUEUED' : input.status,
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
        actionId: input.actionId ?? null,
        mode: 'MANUAL',
        provider: null,
        channel: 'TEXT',
        status: input.status,
        providerRequestId: randomUUID(),
        createdBy: input.userId,
        createdAt: input.createdAt ?? input.requestedAt,
        updatedAt: now,
        submittedAt: input.status === 'SENT' ? input.submittedAt : null,
        failedAt: input.status === 'FAILED' ? now : null,
      },
    });
    return { requestId, deliveryId };
  }

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get(`/customers/${randomUUID()}/observed-returns`).expect(401);
  });

  it('returns 404 for a cross-tenant customer id', async () => {
    const salonA = await registerOwner('obs-iso-a');
    const salonB = await registerOwner('obs-iso-b');
    const customerB = await createCustomer(salonB.token, 'Other');
    await request(app.getHttpServer())
      .get(`/customers/${customerB}/observed-returns`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);
  });

  it('allows OWNER MANAGER and STAFF to read tenant outcomes', async () => {
    const salon = await registerOwner('obs-rbac');
    const customerId = await createCustomer(salon.token, 'Rbac');
    const staffEmail = `staff-obs-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);
    const managerEmail = `mgr-obs-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: 'Manager', email: managerEmail, password, role: 'MANAGER' })
      .expect(201);

    expect((await listObserved(salon.token, customerId)).items).toEqual([]);
    expect((await listObserved(await login(staffEmail), customerId)).items).toEqual([]);
    expect((await listObserved(await login(managerEmail), customerId)).items).toEqual([]);
  });

  it('associates last-touch SENT messages and excludes ineligible interventions', async () => {
    const salon = await registerOwner('obs-lt');
    const customerId = await createCustomer(salon.token, 'Loop');
    const otherCustomer = await createCustomer(salon.token, 'Other');

    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-01T08:00:00.000Z'),
      submittedAt: null,
      status: 'QUEUED',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-01T09:00:00.000Z'),
      submittedAt: null,
      status: 'FAILED',
    });

    const actionId = randomUUID();
    await prisma.client.opportunityAction.create({
      data: {
        id: actionId,
        salonId: salon.tenantId,
        customerId,
        opportunityType: 'REACTIVATION',
        status: 'COMPLETED',
        createdBy: salon.userId,
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
        updatedAt: new Date('2026-09-01T11:00:00.000Z'),
        completedAt: new Date('2026-09-01T11:00:00.000Z'),
      },
    });

    await recordVisit(salon.token, customerId, '2026-09-04T12:00:00.000Z');
    const a = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-01T07:00:00.000Z'),
      submittedAt: new Date('2026-09-05T10:00:00.000Z'),
      status: 'SENT',
      actionId,
      opportunityType: 'REACTIVATION',
    });

    await recordVisit(salon.token, customerId, '2026-09-05T09:00:00.000Z');
    await recordVisit(salon.token, customerId, '2026-09-05T10:00:00.000Z');

    const afterA = await recordVisit(salon.token, customerId, '2026-09-06T10:00:00.000Z');
    const pageAfterA = await listObserved(salon.token, customerId);
    expect(pageAfterA.items).toHaveLength(1);
    expect(pageAfterA.items[0]).toMatchObject({
      associationKind: 'OBSERVED',
      intervention: {
        kind: 'MESSAGE',
        origin: 'OPPORTUNITY',
        occurredAt: '2026-09-05T10:00:00.000Z',
        message: { requestId: a.requestId, deliveryId: a.deliveryId },
        actionId,
        opportunityType: 'REACTIVATION',
      },
      observedReturn: { visitId: afterA, occurredAt: '2026-09-06T10:00:00.000Z' },
      associatedRevenue: { recorded: false, currency: 'IRR', amount: null },
    });

    const b = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-07T08:00:00.000Z'),
      submittedAt: new Date('2026-09-07T10:00:00.000Z'),
      status: 'SENT',
    });
    const afterB1 = await recordVisit(salon.token, customerId, '2026-09-08T10:00:00.000Z');
    const afterB2 = await recordVisit(salon.token, customerId, '2026-09-09T10:00:00.000Z');
    const twoTouch = await listObserved(salon.token, customerId);
    expect(twoTouch.items.map((item) => [item.intervention.message.deliveryId, item.observedReturn.visitId])).toEqual(
      [
        [b.deliveryId, afterB1],
        [a.deliveryId, afterA],
      ],
    );
    expect(twoTouch.items.some((item) => item.observedReturn.visitId === afterB2)).toBe(false);

    const other = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: otherCustomer,
      requestedAt: new Date('2026-09-01T10:00:00.000Z'),
      submittedAt: new Date('2026-09-01T11:00:00.000Z'),
      status: 'SENT',
    });
    await recordVisit(salon.token, otherCustomer, '2026-09-03T10:00:00.000Z');
    const isolated = await listObserved(salon.token, customerId);
    expect(isolated.items.some((item) => item.intervention.message.deliveryId === other.deliveryId)).toBe(
      false,
    );
  });

  it('associates sequential A-visit then B-visit newest-return-first', async () => {
    const salon = await registerOwner('obs-seq');
    const customerId = await createCustomer(salon.token, 'Seq');
    const a = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-08-01T10:00:00.000Z'),
      submittedAt: new Date('2026-08-01T12:00:00.000Z'),
      status: 'SENT',
    });
    const visit1 = await recordVisit(salon.token, customerId, '2026-08-03T10:00:00.000Z');
    const b = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-08-05T10:00:00.000Z'),
      submittedAt: new Date('2026-08-05T12:00:00.000Z'),
      status: 'SENT',
    });
    const visit2 = await recordVisit(salon.token, customerId, '2026-08-08T10:00:00.000Z');
    const page = await listObserved(salon.token, customerId);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((item) => [item.intervention.message.deliveryId, item.observedReturn.visitId])).toEqual([
      [b.deliveryId, visit2],
      [a.deliveryId, visit1],
    ]);
    expect(page.items[0]?.intervention.origin).toBe('MANUAL');
  });

  it('breaks identical submittedAt with createdAt then delivery id', async () => {
    const salon = await registerOwner('obs-tie');
    const customerId = await createCustomer(salon.token, 'Tie');
    const submittedAt = new Date('2026-07-05T10:00:00.000Z');
    const early = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-07-05T08:00:00.000Z'),
      submittedAt,
      createdAt: new Date('2026-07-05T09:00:00.000Z'),
      status: 'SENT',
    });
    const later = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-07-05T08:30:00.000Z'),
      submittedAt,
      createdAt: new Date('2026-07-05T11:00:00.000Z'),
      status: 'SENT',
    });
    const visitId = await recordVisit(salon.token, customerId, '2026-07-08T10:00:00.000Z');
    const page = await listObserved(salon.token, customerId);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.intervention.message.deliveryId).toBe(later.deliveryId);
    expect(page.items[0]?.observedReturn.visitId).toBe(visitId);
    expect(page.items[0]?.intervention.message.deliveryId).not.toBe(early.deliveryId);
  });

  it('derives associated revenue from linked COMPLETED amounts only', async () => {
    const salon = await registerOwner('obs-rev');
    const customerId = await createCustomer(salon.token, 'Rev');
    const serviceId = await createService(salon.token, `Color ${Date.now()}`);
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-06-01T10:00:00.000Z'),
      submittedAt: new Date('2026-06-01T12:00:00.000Z'),
      status: 'SENT',
    });
    const noneVisit = await recordVisit(salon.token, customerId, '2026-06-08T10:00:00.000Z');
    const nonePage = await listObserved(salon.token, customerId);
    expect(nonePage.items[0]?.observedReturn.visitId).toBe(noneVisit);
    expect(nonePage.items[0]?.associatedRevenue).toEqual({
      recorded: false,
      currency: 'IRR',
      amount: null,
    });

    await request(app.getHttpServer())
      .delete(`/visits/${noneVisit}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(204);
    expect((await listObserved(salon.token, customerId)).items).toEqual([]);

    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-06-10T10:00:00.000Z'),
      submittedAt: new Date('2026-06-10T12:00:00.000Z'),
      status: 'SENT',
    });
    const zeroVisit = await recordVisit(salon.token, customerId, '2026-06-18T10:00:00.000Z');
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `obs-zero-${randomUUID()}`)
      .send({
        customerId,
        visitId: zeroVisit,
        occurredAt: '2026-06-18T10:00:00.000Z',
        amount: '0.00',
        currency: 'IRR',
        items: [{ serviceId, quantity: 1, unitPrice: '0.00' }],
      })
      .expect(201);
    const zeroPage = await listObserved(salon.token, customerId);
    expect(zeroPage.items[0]?.observedReturn.visitId).toBe(zeroVisit);
    expect(zeroPage.items[0]?.associatedRevenue).toEqual({
      recorded: true,
      currency: 'IRR',
      amount: '0.00',
    });

    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-06-19T10:00:00.000Z'),
      submittedAt: new Date('2026-06-19T12:00:00.000Z'),
      status: 'SENT',
    });
    const sale = await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `obs-sale-${randomUUID()}`)
      .send({
        customerId,
        visitedAt: '2026-06-20T10:00:00.000Z',
        serviceId,
        amount: '1500000.00',
        currency: 'IRR',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `obs-second-${randomUUID()}`)
      .send({
        customerId,
        visitId: sale.body.visit.id,
        occurredAt: '2026-06-20T10:00:00.000Z',
        amount: '1700000.00',
        currency: 'IRR',
        items: [{ serviceId, quantity: 1, unitPrice: '1700000.00' }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `obs-unlinked-${randomUUID()}`)
      .send({
        customerId,
        occurredAt: '2026-06-20T11:00:00.000Z',
        amount: '900000.00',
        currency: 'IRR',
        items: [{ serviceId, quantity: 1, unitPrice: '900000.00' }],
      })
      .expect(201);

    const summed = await listObserved(salon.token, customerId);
    const saleRow = summed.items.find((item) => item.observedReturn.visitId === sale.body.visit.id);
    expect(saleRow?.associatedRevenue).toEqual({
      recorded: true,
      currency: 'IRR',
      amount: '3200000.00',
    });

    await request(app.getHttpServer())
      .post(`/transactions/${sale.body.transaction.id}/void`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(201);
    const afterVoid = await listObserved(salon.token, customerId);
    const afterVoidRow = afterVoid.items.find(
      (item) => item.observedReturn.visitId === sale.body.visit.id,
    );
    expect(afterVoidRow?.associatedRevenue).toEqual({
      recorded: true,
      currency: 'IRR',
      amount: '1700000.00',
    });
  });
});

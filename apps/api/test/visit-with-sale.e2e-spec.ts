import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

describeIfDb('Complete visit with sale (e2e)', () => {
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
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: `${label} Salon`,
        ownerName: `${label} Owner`,
        email,
        password,
      })
      .expect(201);
    return {
      email,
      token: response.body.accessToken as string,
      tenantId: response.body.user.tenantId as string,
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

  async function createService(token: string, name: string) {
    const response = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return response.body.id as string;
  }

  async function login(email: string) {
    return (
      await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201)
    ).body.accessToken as string;
  }

  it('creates visit + sale atomically for OWNER and MANAGER, enforces RBAC, tenancy, and idempotency', async () => {
    const salonA = await registerOwner('vsale-a');
    const salonB = await registerOwner('vsale-b');
    const customerA = await createCustomer(salonA.token, 'A');
    const customerB = await createCustomer(salonB.token, 'B');
    const hair = await createService(salonA.token, `Hair ${Date.now()}`);
    const nail = await createService(salonA.token, `Nail ${Date.now()}`);
    const otherService = await createService(salonB.token, `Other ${Date.now()}`);

    const staffEmail = `staff-vsale-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);
    const staffToken = await login(staffEmail);

    const managerEmail = `mgr-vsale-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Manager', email: managerEmail, password, role: 'MANAGER' })
      .expect(201);
    const managerToken = await login(managerEmail);

    const payload = {
      customerId: customerA,
      visitedAt: '2026-08-06T10:00:00.000Z',
      serviceId: hair,
      amount: '8000000.00',
      currency: 'IRR',
    };

    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', 'staff-cannot-sale-01')
      .send(payload)
      .expect(403);

    const staffVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ customerId: customerA, visitedAt: '2026-08-05T10:00:00.000Z' })
      .expect(201);
    expect(staffVisit.body.customerId).toBe(customerA);

    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send(payload)
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visit-sale-owner-01')
      .send(payload)
      .expect(201);

    expect(created.body.visit.customerId).toBe(customerA);
    expect(created.body.visit.visitedAt).toBe(payload.visitedAt);
    expect(created.body.transaction.customerId).toBe(customerA);
    expect(created.body.transaction.visitId).toBe(created.body.visit.id);
    expect(created.body.transaction.amount).toBe('8000000.00');
    expect(created.body.transaction.currency).toBe('IRR');
    expect(created.body.transaction.status).toBe('COMPLETED');
    expect(created.body.transaction.occurredAt).toBe(payload.visitedAt);
    expect(created.body.transaction.items).toHaveLength(1);
    expect(created.body.transaction.items[0].serviceId).toBe(hair);
    expect(created.body.transaction.items[0].quantity).toBe(1);
    expect(created.body.transaction.items[0].totalAmount).toBe('8000000.00');

    const replay = await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visit-sale-owner-01')
      .send(payload)
      .expect(201);
    expect(replay.body.visit.id).toBe(created.body.visit.id);
    expect(replay.body.transaction.id).toBe(created.body.transaction.id);

    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visit-sale-owner-01')
      .send({ ...payload, amount: '100.00' })
      .expect(409);

    const races = await Promise.all(
      [1, 2, 3].map(() =>
        request(app.getHttpServer())
          .post('/visits/complete-with-sale')
          .set('Authorization', `Bearer ${salonA.token}`)
          .set('Idempotency-Key', 'visit-sale-race-aa')
          .send({
            ...payload,
            visitedAt: '2026-08-06T11:00:00.000Z',
          }),
      ),
    );
    const ok = races.filter((res) => res.status === 201);
    expect(ok).toHaveLength(3);
    expect(new Set(ok.map((res) => res.body.visit.id as string)).size).toBe(1);
    expect(new Set(ok.map((res) => res.body.transaction.id as string)).size).toBe(1);

    const managerSale = await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', 'visit-sale-manager-01')
      .send({
        customerId: customerA,
        visitedAt: '2026-08-06T12:00:00.000Z',
        serviceId: nail,
        amount: '1500000.00',
      })
      .expect(201);
    expect(managerSale.body.transaction.items[0].serviceId).toBe(nail);
    expect(managerSale.body.transaction.amount).toBe('1500000.00');

    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visit-sale-cross-customer')
      .send({ ...payload, customerId: customerB, visitedAt: '2026-08-06T13:00:00.000Z' })
      .expect(404);

    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visit-sale-cross-service')
      .send({ ...payload, serviceId: otherService, visitedAt: '2026-08-06T14:00:00.000Z' })
      .expect(404);

    const visitsBeforeUnknown = await prisma.client.visit.count({ where: { salonId: salonA.tenantId } });
    const txBeforeUnknown = await prisma.client.ledgerTransaction.count({ where: { salonId: salonA.tenantId } });
    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visit-sale-unknown-service')
      .send({ ...payload, serviceId: randomUUID(), visitedAt: '2026-08-06T15:00:00.000Z' })
      .expect(404);
    expect(await prisma.client.visit.count({ where: { salonId: salonA.tenantId } })).toBe(visitsBeforeUnknown);
    expect(await prisma.client.ledgerTransaction.count({ where: { salonId: salonA.tenantId } })).toBe(
      txBeforeUnknown,
    );

    await request(app.getHttpServer())
      .patch(`/services/${hair}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const visitsBeforeInactive = await prisma.client.visit.count({ where: { salonId: salonA.tenantId } });
    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visit-sale-inactive')
      .send({ ...payload, visitedAt: '2026-08-06T16:00:00.000Z' })
      .expect(400);
    expect(await prisma.client.visit.count({ where: { salonId: salonA.tenantId } })).toBe(visitsBeforeInactive);

    const hairName = (await prisma.client.service.findFirst({ where: { id: hair, salonId: salonA.tenantId } }))?.name;
    const historyAfterInactive = await request(app.getHttpServer())
      .get(`/customers/${customerA}/visits`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(historyAfterInactive.body.items.find((row: { id: string }) => row.id === created.body.visit.id)).toMatchObject({
      serviceName: hairName,
      amountReceived: '8000000.00',
    });
    const globalAfterInactive = await request(app.getHttpServer())
      .get('/visits')
      .query({ customerId: customerA })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(globalAfterInactive.body.items.find((row: { id: string }) => row.id === created.body.visit.id)).toMatchObject({
      serviceName: hairName,
      amountReceived: '8000000.00',
    });
    expect(
      await prisma.client.transactionItem.count({
        where: { salonId: salonA.tenantId, serviceId: hair },
      }),
    ).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .patch(`/services/${hair}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visit-sale-reactivated')
      .send({ ...payload, visitedAt: '2026-08-06T16:30:00.000Z' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/visits/complete-with-sale')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visit-sale-zero')
      .send({ ...payload, serviceId: nail, amount: '0.00', visitedAt: '2026-08-06T17:00:00.000Z' })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/visits/${created.body.visit.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/customers/${customerA}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(409);

    const intel = await request(app.getHttpServer())
      .get(`/intelligence/customers/${customerA}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(intel.body.revenue.totalRevenue).toBe('25500000.00');
    expect(intel.body.revenue.transactionCount).toBe(4);

    const dashboard = await request(app.getHttpServer())
      .get('/intelligence/summary')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(dashboard.body.totalRevenue).toBe('25500000.00');

    await request(app.getHttpServer())
      .post(`/transactions/${created.body.transaction.id}/void`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(201);

    const afterVoid = await request(app.getHttpServer())
      .get(`/intelligence/customers/${customerA}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(afterVoid.body.revenue.totalRevenue).toBe('17500000.00');
    expect(afterVoid.body.revenue.transactionCount).toBe(3);

    const stored = await prisma.client.ledgerTransaction.findFirst({
      where: { id: managerSale.body.transaction.id },
      include: { items: true },
    });
    expect(stored?.visitId).toBe(managerSale.body.visit.id);
    expect(stored?.customerId).toBe(customerA);
    expect(stored?.salonId).toBe(salonA.tenantId);
    expect(stored?.items).toHaveLength(1);
    expect(stored?.items[0]?.serviceId).toBe(nail);
    expect(stored?.items[0]?.totalAmount.toFixed(2)).toBe(stored?.amount.toFixed(2));

    const events = await prisma.client.outboxEvent.findMany({
      where: {
        tenantId: salonA.tenantId,
        eventType: { in: ['VisitCompleted', 'TransactionCreated'] },
      },
    });
    expect(events.some((event) => event.eventType === 'VisitCompleted')).toBe(true);
    expect(events.some((event) => event.eventType === 'TransactionCreated')).toBe(true);
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { listItems } from './list-page';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

describeIfDb('Services and transactions (e2e)', () => {
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

  it('enforces tenant isolation, RBAC, money strings, idempotency, void, and deletion protection', async () => {
    const salonA = await registerOwner('fin-a');
    const salonB = await registerOwner('fin-b');
    const customerA = await createCustomer(salonA.token, 'A');
    const customerB = await createCustomer(salonB.token, 'B');
    const serviceA = await createService(salonA.token, `Color ${Date.now()}`);
    const serviceB = await createService(salonB.token, `Cut ${Date.now()}`);

    const staffEmail = `staff-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);
    const staffToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: staffEmail, password }).expect(201)
    ).body.accessToken as string;

    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name: 'Forbidden' })
      .expect(403);

    const managerEmail = `mgr-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Manager', email: managerEmail, password, role: 'MANAGER' })
      .expect(201);
    const managerToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: managerEmail, password }).expect(201)
    ).body.accessToken as string;

    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Manager Cut' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/services/${serviceA}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Hijacked' })
      .expect(403);

    const payload = {
      customerId: customerA,
      occurredAt: '2026-08-01T10:00:00.000Z',
      amount: '300000.00',
      currency: 'IRR',
      items: [{ serviceId: serviceA, quantity: 2, unitPrice: '150000.00' }],
    };

    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', 'staff-cannot-write-01')
      .send(payload)
      .expect(403);

    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send(payload)
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'tx-key-same-01')
      .send(payload)
      .expect(201);
    expect(created.body.amount).toBe('300000.00');
    expect(created.body.currency).toBe('IRR');
    expect(created.body.status).toBe('COMPLETED');

    const otherKeySamePayload = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'tx-key-different-01')
      .send(payload)
      .expect(201);
    expect(otherKeySamePayload.body.id).not.toBe(created.body.id);

    await request(app.getHttpServer())
      .get('/transactions')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    const replay = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'tx-key-same-01')
      .send(payload)
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'tx-key-same-01')
      .send({ ...payload, amount: '100.00', items: [{ serviceId: serviceA, quantity: 1, unitPrice: '100.00' }] })
      .expect(409);

    const races = await Promise.all(
      [1, 2, 3].map(() =>
        request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${salonA.token}`)
          .set('Idempotency-Key', 'tx-race-key-aa')
          .send({
            ...payload,
            occurredAt: '2026-08-02T10:00:00.000Z',
          }),
      ),
    );
    const ok = races.filter((res) => res.status === 201);
    expect(ok).toHaveLength(3);
    expect(new Set(ok.map((res) => res.body.id as string)).size).toBe(1);

    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'tx-cross-service')
      .send({
        ...payload,
        occurredAt: '2026-08-03T10:00:00.000Z',
        items: [{ serviceId: serviceB, quantity: 1, unitPrice: '300000.00' }],
      })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/transactions/${created.body.id}`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    const listed = await request(app.getHttpServer())
      .get('/transactions')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(listItems(listed.body).every((row) => row.customerId !== customerA)).toBe(true);

    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ customerId: customerA, visitedAt: '2026-07-01T10:00:00.000Z' })
      .expect(201);

    const linked = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'tx-linked-visit')
      .send({
        ...payload,
        visitId: visit.body.id,
        occurredAt: '2026-07-01T11:00:00.000Z',
        amount: '150000.00',
        items: [{ serviceId: serviceA, quantity: 1, unitPrice: '150000.00' }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/visits/${visit.body.id}`)
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
    expect(intel.body.revenue.totalRevenue).toBe('1050000.00');
    expect(intel.body.revenue.transactionCount).toBe(4);
    expect(intel.body.revenue.averageSpendPerVisit).toBe('150000.00');
    expect(intel.body.revenue.averageRevenuePerTransaction).toBe('262500.00');
    expect(intel.body.revenue.reportingTime).toBe('UTC');

    await request(app.getHttpServer())
      .post(`/transactions/${created.body.id}/void`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);

    const voided = await request(app.getHttpServer())
      .post(`/transactions/${created.body.id}/void`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(201);
    expect(voided.body.status).toBe('VOIDED');
    const voidAgain = await request(app.getHttpServer())
      .post(`/transactions/${created.body.id}/void`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(201);
    expect(voidAgain.body.id).toBe(created.body.id);

    const afterVoid = await request(app.getHttpServer())
      .get(`/intelligence/customers/${customerA}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(afterVoid.body.revenue.totalRevenue).toBe('750000.00');
    expect(afterVoid.body.revenue.transactionCount).toBe(3);

    const events = await prisma.client.outboxEvent.findMany({
      where: { tenantId: salonA.tenantId, eventType: { in: ['TransactionCreated', 'TransactionVoided'] } },
    });
    expect(events.some((event) => event.eventType === 'TransactionCreated')).toBe(true);
    expect(events.filter((event) => event.eventType === 'TransactionVoided')).toHaveLength(1);

    const concurrentVoids = await Promise.all(
      [1, 2, 3].map(() =>
        request(app.getHttpServer())
          .post(`/transactions/${linked.body.id}/void`)
          .set('Authorization', `Bearer ${salonA.token}`),
      ),
    );
    expect(concurrentVoids.every((res) => res.status === 201)).toBe(true);
    expect(
      (
        await prisma.client.outboxEvent.findMany({
          where: { tenantId: salonA.tenantId, eventType: 'TransactionVoided' },
        })
      ).filter((event) => (event.payload as { transactionId?: string }).transactionId === linked.body.id),
    ).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/customers/${customerA}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(409);

    const cleanCustomer = await createCustomer(salonA.token, 'Clean');
    await request(app.getHttpServer())
      .delete(`/customers/${cleanCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(204);

    const mismatch = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'tx-sum-mismatch')
      .send({
        customerId: customerA,
        occurredAt: '2026-08-04T10:00:00.000Z',
        amount: '10.00',
        items: [{ serviceId: serviceA, quantity: 1, unitPrice: '20.00' }],
      })
      .expect(400);
    expect(mismatch.body.error).toBeDefined();

    const otherVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonB.token}`)
      .send({ customerId: customerB, visitedAt: '2026-07-02T10:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'tx-wrong-visit')
      .send({
        ...payload,
        visitId: otherVisit.body.id,
        occurredAt: '2026-08-05T10:00:00.000Z',
      })
      .expect(404);

    const concurrent = await Promise.all([
      request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${salonA.token}`)
        .set('Idempotency-Key', `tx-conc-${Date.now()}-1`)
        .send({
          customerId: customerA,
          occurredAt: '2026-08-06T10:00:00.000Z',
          amount: '1000.00',
          items: [{ serviceId: serviceA, quantity: 1, unitPrice: '1000.00' }],
        }),
      request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${salonA.token}`)
        .set('Idempotency-Key', `tx-conc-${Date.now()}-2`)
        .send({
          customerId: customerA,
          occurredAt: '2026-08-06T11:00:00.000Z',
          amount: '2000.00',
          items: [{ serviceId: serviceA, quantity: 1, unitPrice: '2000.00' }],
        }),
    ]);
    expect(concurrent.every((res) => res.status === 201)).toBe(true);
    expect(concurrent[0]!.body.id).not.toBe(concurrent[1]!.body.id);

    const victim = await createCustomer(salonA.token, 'RaceDel');
    const [createDuringDelete, deleteRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${salonA.token}`)
        .set('Idempotency-Key', `tx-del-race-${Date.now()}`)
        .send({
          customerId: victim,
          occurredAt: '2026-08-07T10:00:00.000Z',
          amount: '500.00',
          items: [{ serviceId: serviceA, quantity: 1, unitPrice: '500.00' }],
        }),
      request(app.getHttpServer())
        .delete(`/customers/${victim}`)
        .set('Authorization', `Bearer ${salonA.token}`),
    ]);
    expect([createDuringDelete.status, deleteRes.status].some((status) => status >= 500)).toBe(false);
    expect([201, 404, 409, 204]).toContain(createDuringDelete.status);
    expect([201, 404, 409, 204]).toContain(deleteRes.status);

    const remaining = await prisma.client.ledgerTransaction.findMany({
      where: { salonId: salonA.tenantId, customerId: victim },
    });
    const victimCustomer = await prisma.client.customer.findFirst({
      where: { id: victim, salonId: salonA.tenantId },
    });
    if (remaining.length > 0) {
      expect(victimCustomer).not.toBeNull();
    }
    if (deleteRes.status === 204) {
      expect(remaining).toHaveLength(0);
      expect(victimCustomer).toBeNull();
    }
    if (createDuringDelete.status === 201) {
      expect(remaining.length).toBeGreaterThan(0);
      expect(victimCustomer).not.toBeNull();
    }
  });

  it('lists tenant-scoped Hair Service and Nail Service and isolates them', async () => {
    const salonA = await registerOwner('svc-a');
    const salonB = await registerOwner('svc-b');
    await createService(salonA.token, 'Hair Service');
    await createService(salonA.token, 'Nail Service');
    await createService(salonB.token, 'Hair Service');

    const listed = await request(app.getHttpServer())
      .get('/services')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    const names = listItems(listed.body).map((row) => row.name as string).sort();
    expect(names).toEqual(['Hair Service', 'Nail Service']);
    expect(listed.body.hasMore).toBe(false);
    expect(listed.body.nextCursor).toBeNull();
    expect(listItems(listed.body).every((row) => row.status === 'ACTIVE')).toBe(true);

    const other = await request(app.getHttpServer())
      .get('/services')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    expect(listItems(other.body).map((row) => row.name)).toEqual(['Hair Service']);

    const retired = await createService(salonA.token, 'Retired Cut');
    await request(app.getHttpServer())
      .patch(`/services/${retired}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const afterInactive = await request(app.getHttpServer())
      .get('/services')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems(afterInactive.body).map((row) => row.name as string).sort()).toEqual([
      'Hair Service',
      'Nail Service',
    ]);

    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Hair Botox', salonId: salonB.tenantId })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: '  Hair Botox  ' })
      .expect(201);
    expect(created.body.name).toBe('Hair Botox');
    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Hair Botox' })
      .expect(409);
    const otherBotox = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salonB.token}`)
      .send({ name: 'Hair Botox' })
      .expect(201);
    expect(otherBotox.body.id).not.toBe(created.body.id);
    await request(app.getHttpServer())
      .patch(`/services/${otherBotox.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Stolen' })
      .expect(404);
    const renamed = await request(app.getHttpServer())
      .patch(`/services/${created.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Hair Botox Premium' })
      .expect(200);
    expect(renamed.body.id).toBe(created.body.id);
    expect(renamed.body.name).toBe('Hair Botox Premium');
    await request(app.getHttpServer())
      .patch(`/services/${created.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const managed = await request(app.getHttpServer())
      .get('/services')
      .query({ includeInactive: 'true' })
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listItems(managed.body).some((row) => row.id === created.body.id && row.status === 'INACTIVE')).toBe(
      true,
    );
    const audits = await prisma.client.auditLog.findMany({
      where: { tenantId: salonA.tenantId, resource: 'service', resourceId: created.body.id as string },
    });
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining(['SERVICE_CREATED', 'SERVICE_UPDATED', 'SERVICE_DEACTIVATED']),
    );
  });

  it('provisions Hair Service and Nail Service for a real owner registration', async () => {
    const email = `owner-${Date.now()}-${Math.random().toString(16).slice(2)}@gmail.com`;
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        salonName: 'Windows Dev Salon',
        ownerName: 'Owner',
        email,
        password,
      })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get('/services')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .expect(200);
    expect(listItems(listed.body).map((row) => row.name as string).sort()).toEqual([
      'Hair Service',
      'Nail Service',
    ]);
    expect(listItems(listed.body).every((row) => row.status === 'ACTIVE')).toBe(true);
  });
});

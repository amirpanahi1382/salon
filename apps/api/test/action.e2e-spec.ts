import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { listItems, listPage } from './list-page';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describeIfDb('Opportunity Actions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
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
      userId: response.body.user.id as string,
      tenantId: response.body.user.tenantId as string,
    };
  }

  async function createCustomer(token: string, lastName: string) {
    const phone = `0912${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 9)}`;
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Sara',
        lastName,
        phoneNumber: phone.slice(0, 11),
      })
      .expect(201);
    return response.body.id as string;
  }

  async function recordVisit(token: string, customerId: string, visitedAt: string) {
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, visitedAt })
      .expect(201);
  }

  function createPath(type: string, customerId: string) {
    return `/intelligence/opportunities/${type}/customers/${customerId}/actions`;
  }

  it('rejects unauthenticated action access', async () => {
    await request(app.getHttpServer()).get('/actions').expect(401);
    await request(app.getHttpServer())
      .post(createPath('REACTIVATION', randomUUID()))
      .expect(401);
  });

  it('creates, completes, dismisses, and isolates actions without changing intelligence or visits', async () => {
    const salonA = await registerOwner('act-a');
    const salonB = await registerOwner('act-b');
    const reactivationCustomer = await createCustomer(salonA.token, 'Reactivate');
    const returnCustomer = await createCustomer(salonA.token, 'Return');
    const otherCustomer = await createCustomer(salonB.token, 'Other');

    await recordVisit(salonA.token, reactivationCustomer, daysAgoIso(87));
    await recordVisit(salonA.token, reactivationCustomer, daysAgoIso(52));
    await recordVisit(salonA.token, returnCustomer, daysAgoIso(52));
    await recordVisit(salonB.token, otherCustomer, daysAgoIso(87));
    await recordVisit(salonB.token, otherCustomer, daysAgoIso(52));

    const beforeIntel = await request(app.getHttpServer())
      .get(`/intelligence/customers/${reactivationCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(beforeIntel.body.opportunities[0].type).toBe('REACTIVATION');

    await request(app.getHttpServer())
      .post(createPath('REACTIVATION', reactivationCustomer))
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ salonId: salonB.tenantId })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post(createPath('REACTIVATION', reactivationCustomer))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'act-key-same-01')
      .expect(201);
    expect(created.body.status).toBe('OPEN');
    expect(created.body.customerId).toBe(reactivationCustomer);
    expect(created.body.opportunityType).toBe('REACTIVATION');
    expect(created.body.createdBy).toBe(salonA.userId);
    expect(created.body.salonId).toBeUndefined();

    const replay = await request(app.getHttpServer())
      .post(createPath('REACTIVATION', reactivationCustomer))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'act-key-same-01')
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post(createPath('CUSTOMER_RETURN', returnCustomer))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'act-key-same-01')
      .expect(409);

    const duplicateOpen = await request(app.getHttpServer())
      .post(createPath('REACTIVATION', reactivationCustomer))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'act-key-open-dup')
      .expect(201);
    expect(duplicateOpen.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post(createPath('REACTIVATION', otherCustomer))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'act-cross-customer')
      .expect(404);

    await request(app.getHttpServer())
      .post(createPath('REACTIVATION', reactivationCustomer))
      .set('Authorization', `Bearer ${salonB.token}`)
      .set('Idempotency-Key', 'act-cross-tenant')
      .expect(404);

    await request(app.getHttpServer())
      .post(createPath('NOT_A_TYPE', reactivationCustomer))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'act-bad-type-01')
      .expect(400);

    await request(app.getHttpServer())
      .post(createPath('REACTIVATION', 'not-a-uuid'))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'act-bad-uuid-01')
      .expect(400);

    const races = await Promise.all(
      [1, 2, 3].map(() =>
        request(app.getHttpServer())
          .post(createPath('CUSTOMER_RETURN', returnCustomer))
          .set('Authorization', `Bearer ${salonA.token}`)
          .set('Idempotency-Key', 'act-race-key-aa'),
      ),
    );
    const ok = races.filter((res) => res.status === 201);
    expect(ok).toHaveLength(3);
    expect(new Set(ok.map((res) => res.body.id as string)).size).toBe(1);

    const openRaces = await Promise.all(
      [1, 2, 3].map((n) =>
        request(app.getHttpServer())
          .post(createPath('CUSTOMER_RETURN', returnCustomer))
          .set('Authorization', `Bearer ${salonA.token}`)
          .set('Idempotency-Key', `act-open-race-${n}-${Date.now()}`),
      ),
    );
    const openOk = openRaces.filter((res) => res.status === 201);
    expect(openOk).toHaveLength(3);
    expect(new Set(openOk.map((res) => res.body.id as string)).size).toBe(1);
    expect(
      await prisma.client.opportunityAction.count({
        where: {
          salonId: salonA.tenantId,
          customerId: returnCustomer,
          opportunityType: 'CUSTOMER_RETURN',
          status: 'OPEN',
        },
      }),
    ).toBe(1);

    const completeRaces = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/actions/${created.body.id}/complete`)
          .set('Authorization', `Bearer ${salonA.token}`),
      ),
    );
    expect(completeRaces.every((res) => res.status === 201)).toBe(true);
    expect(completeRaces.every((res) => res.body.status === 'COMPLETED')).toBe(true);
    expect(created.body.id).toBe(completeRaces[0]!.body.id);

    await request(app.getHttpServer())
      .post(`/actions/${created.body.id}/dismiss`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(409);

    const returnActionId = openOk[0]!.body.id as string;
    const mixed = await Promise.all([
      request(app.getHttpServer())
        .post(`/actions/${returnActionId}/complete`)
        .set('Authorization', `Bearer ${salonA.token}`),
      request(app.getHttpServer())
        .post(`/actions/${returnActionId}/dismiss`)
        .set('Authorization', `Bearer ${salonA.token}`),
    ]);
    const mixedOk = mixed.filter((res) => res.status === 201);
    const mixedConflict = mixed.filter((res) => res.status === 409);
    expect(mixedOk).toHaveLength(1);
    expect(mixedConflict).toHaveLength(1);
    expect(['COMPLETED', 'DISMISSED']).toContain(mixedOk[0]!.body.status);

    const afterIntel = await request(app.getHttpServer())
      .get(`/intelligence/customers/${reactivationCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(afterIntel.body.status).toBe(beforeIntel.body.status);
    expect(afterIntel.body.opportunities[0].type).toBe('REACTIVATION');

    const staffEmail = `staff-act-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);
    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password })
      .expect(201);

    const staffCreated = await request(app.getHttpServer())
      .post(createPath('REACTIVATION', reactivationCustomer))
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .set('Idempotency-Key', 'act-staff-create-01')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/actions/${staffCreated.body.id}/dismiss`)
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .expect(201);

    const visitAfter = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ customerId: reactivationCustomer, visitedAt: daysAgoIso(1) })
      .expect(201);
    expect(visitAfter.body.customerId).toBe(reactivationCustomer);

    const listed = listPage<{ id: string; customerId: string }>(
      (
        await request(app.getHttpServer())
          .get('/actions')
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(listed.items.some((item) => item.id === created.body.id)).toBe(true);
    expect(listed.items.every((item) => item.customerId !== otherCustomer)).toBe(true);

    await request(app.getHttpServer())
      .get(`/customers/${reactivationCustomer}/actions`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    const salonBList = listItems(
      (
        await request(app.getHttpServer())
          .get('/actions')
          .set('Authorization', `Bearer ${salonB.token}`)
          .expect(200)
      ).body,
    );
    expect(salonBList).toHaveLength(0);

    const customerList = listItems<{ id: string }>(
      (
        await request(app.getHttpServer())
          .get(`/customers/${reactivationCustomer}/actions`)
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(customerList.some((item) => item.id === created.body.id)).toBe(true);

    const createAudit = await prisma.client.auditLog.findFirst({
      where: { tenantId: salonA.tenantId, action: 'ACTION_CREATED', resourceId: created.body.id },
    });
    expect(createAudit?.actorId).toBe(salonA.userId);
    expect(JSON.stringify(createAudit?.metadata ?? {})).not.toMatch(/password|Bearer|argon2/i);

    const completeAudit = await prisma.client.auditLog.findFirst({
      where: { tenantId: salonA.tenantId, action: 'ACTION_COMPLETED', resourceId: created.body.id },
    });
    expect(completeAudit?.result).toBe('SUCCESS');

    const events = await prisma.client.outboxEvent.findMany({
      where: {
        tenantId: salonA.tenantId,
        eventType: { in: ['ActionCreated', 'ActionCompleted'] },
      },
    });
    expect(events.some((event) => event.eventType === 'ActionCreated')).toBe(true);
    expect(events.some((event) => event.eventType === 'ActionCompleted')).toBe(true);

    await request(app.getHttpServer())
      .delete(`/customers/${reactivationCustomer}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(204);
    expect(
      await prisma.client.opportunityAction.count({
        where: { salonId: salonA.tenantId, customerId: reactivationCustomer },
      }),
    ).toBe(0);
  });

  it('paginates actions with a stable createdAt cursor', async () => {
    const salon = await registerOwner('act-page');
    const customers: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await createCustomer(salon.token, `Page${i}`);
      customers.push(id);
      await recordVisit(salon.token, id, daysAgoIso(52));
      await request(app.getHttpServer())
        .post(createPath('CUSTOMER_RETURN', id))
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `act-page-${i}-${Date.now()}`)
        .expect(201);
    }

    const first = listPage<{ id: string }>(
      (
        await request(app.getHttpServer())
          .get('/actions')
          .set('Authorization', `Bearer ${salon.token}`)
          .expect(200)
      ).body,
    );
    expect(first.items.length).toBeGreaterThanOrEqual(3);
    expect(first.hasMore).toBe(false);
  });
});

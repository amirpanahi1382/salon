import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

describeIfDb('Opportunity messages (e2e)', () => {
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
    const phone = `0912${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 9)}`.slice(
      0,
      11,
    );
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

  async function createSale(
    token: string,
    customerId: string,
    serviceId: string,
    occurredAt: string,
    amount: string,
    key: string,
  ) {
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({
        customerId,
        occurredAt,
        amount,
        currency: 'IRR',
        items: [{ serviceId, quantity: 1, unitPrice: amount }],
      })
      .expect(201);
  }

  async function seedRevenueDecline(token: string, lastName: string) {
    const customerId = await createCustomer(token, lastName);
    const serviceId = await createService(token, `Cut ${Date.now()}-${Math.random()}`);
    const now = new Date();
    const thisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate(), 28), 12, 0, 0),
    ).toISOString();
    const previousMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10, 12, 0, 0),
    ).toISOString();
    await createSale(token, customerId, serviceId, previousMonth, '200000.00', randomUUID());
    await createSale(token, customerId, serviceId, thisMonth, '50000.00', randomUUID());
    return customerId;
  }

  function sendPath(type: string, customerId: string) {
    return `/intelligence/opportunities/${type}/customers/${customerId}/messages`;
  }

  it('rejects unauthenticated message access', async () => {
    await request(app.getHttpServer()).get(`/messages/${randomUUID()}`).expect(401);
    await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', randomUUID()))
      .send({ text: 'سلام' })
      .expect(401);
  });

  it('lets OWNER, MANAGER, and STAFF request a message without completing the Action or creating finance facts', async () => {
    const salonA = await registerOwner('msg-a');
    const salonB = await registerOwner('msg-b');
    const customerA = await seedRevenueDecline(salonA.token, 'Decline');
    const customerB = await seedRevenueDecline(salonB.token, 'Other');

    const staffEmail = `staff-msg-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);
    const managerEmail = `mgr-msg-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ name: 'Manager', email: managerEmail, password, role: 'MANAGER' })
      .expect(201);
    const staffToken = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password })
        .expect(201)
    ).body.accessToken as string;
    const managerToken = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: managerEmail, password })
        .expect(201)
    ).body.accessToken as string;

    await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerA))
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ text: 'سلام', salonId: salonB.tenantId })
      .expect(400);

    await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerA))
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ text: 'سلام' })
      .expect(400);

    const visitsBefore = await prisma.client.visit.count({
      where: { salonId: salonA.tenantId, customerId: customerA },
    });
    const txBefore = await prisma.client.ledgerTransaction.count({
      where: { salonId: salonA.tenantId, customerId: customerA },
    });

    const created = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerA))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'owner-send-01')
      .send({ text: 'سلام سارا جان' })
      .expect(201);

    expect(created.body.status).toBe('PENDING');
    expect(created.body.provider).toBe('BALE_SAFIR');
    expect(created.body.body).toBe('سلام سارا جان');
    expect(created.body.destinationHint).not.toMatch(/^09\d{9}$/);

    const replay = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerA))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'owner-send-01')
      .send({ text: 'سلام سارا جان' })
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerA))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'owner-send-01')
      .send({ text: 'متن دیگر' })
      .expect(409);

    const managerSend = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerA))
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', 'manager-send-01')
      .send({ text: 'پیام مدیر' })
      .expect(201);
    expect(managerSend.body.id).not.toBe(created.body.id);

    const staffSend = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerA))
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', 'staff-send-01')
      .send({ text: 'پیام کارمند' })
      .expect(201);
    expect(staffSend.body.status).toBe('PENDING');

    await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerB))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'cross-tenant-01')
      .send({ text: 'سلام' })
      .expect(404);

    const action = await prisma.client.opportunityAction.findFirst({
      where: { salonId: salonA.tenantId, customerId: customerA, opportunityType: 'REVENUE_DECLINE' },
    });
    expect(action?.status).toBe('OPEN');
    expect(action?.id).toBe(created.body.actionId);

    const outbox = await prisma.client.outboxEvent.findMany({
      where: {
        tenantId: salonA.tenantId,
        eventType: 'MessageSendRequested',
      },
    });
    expect(outbox.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(outbox[0]?.payload)).toContain(created.body.id);
    expect(JSON.stringify(outbox)).not.toContain('test-safir-access-key');

    const audit = await prisma.client.auditLog.findFirst({
      where: {
        tenantId: salonA.tenantId,
        action: 'MESSAGE_SEND_REQUESTED',
        resourceId: created.body.id,
      },
    });
    expect(audit?.actorId).toBe(salonA.userId);
    expect(JSON.stringify(audit?.metadata)).not.toContain('سلام سارا جان');

    const visitsAfter = await prisma.client.visit.count({
      where: { salonId: salonA.tenantId, customerId: customerA },
    });
    const txAfter = await prisma.client.ledgerTransaction.count({
      where: { salonId: salonA.tenantId, customerId: customerA },
    });
    expect(visitsAfter).toBe(visitsBefore);
    expect(txAfter).toBe(txBefore);

    const listed = await request(app.getHttpServer())
      .get(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listed.body.items.length).toBeGreaterThanOrEqual(3);

    await request(app.getHttpServer())
      .get(`/messages/${created.body.id}`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);
  });
});

import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { messageBusinessDateValue } from '@salon/shared';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';
const adminPassword = 'platform-admin-pass';

describeIfDb('Opportunity messages (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;

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

    const adminEmail = `platform-admin-${Date.now()}@example.test`;
    adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
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
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate(), 28), 0, 0, 0),
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
    await request(app.getHttpServer()).get('/admin/message-queue').expect(401);
  });

  it('queues a durable message without Bale credentials and enforces daily limit and idempotency', async () => {
    const salonA = await registerOwner('msg-a');
    const salonB = await registerOwner('msg-b');
    const customerA = await seedRevenueDecline(salonA.token, 'Decline');
    const customerB = await seedRevenueDecline(salonB.token, 'Other');
    const otherCustomer = await seedRevenueDecline(salonA.token, 'Second');

    const created = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerA))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'owner-send-01')
      .send({ text: 'سلام سارا جان' })
      .expect(201);

    expect(created.body.status).toBe('QUEUED');
    expect(created.body.body).toBe('سلام سارا جان');
    expect(created.body.mode).toBeNull();
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

    const daily = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerA))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'owner-send-02')
      .send({ text: 'پیام دوم همان روز' })
      .expect(409);
    expect(daily.body.error).toBe('MESSAGE_DAILY_LIMIT_REACHED');

    const other = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', otherCustomer))
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'owner-other-01')
      .send({ text: 'مشتری دیگر' })
      .expect(201);
    expect(other.body.id).not.toBe(created.body.id);

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
      where: { tenantId: salonA.tenantId, eventType: 'MessageRequested' },
    });
    expect(outbox.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(outbox)).not.toContain('test-safir-access-key');
    expect(JSON.stringify(outbox[0]?.payload)).not.toContain('سلام سارا جان');

    const sendRequested = await prisma.client.outboxEvent.count({
      where: { tenantId: salonA.tenantId, eventType: 'MessageSendRequested' },
    });
    expect(sendRequested).toBe(0);

    const audit = await prisma.client.auditLog.findFirst({
      where: {
        tenantId: salonA.tenantId,
        action: 'MESSAGE_REQUESTED',
        resourceId: created.body.id,
      },
    });
    expect(audit?.actorId).toBe(salonA.userId);
    expect(JSON.stringify(audit?.metadata)).not.toContain('سلام سارا جان');

    const listed = await request(app.getHttpServer())
      .get(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(listed.body.items.length).toBe(1);

    await request(app.getHttpServer())
      .get(`/messages/${created.body.id}`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .get('/admin/message-queue')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(403);

    const queue = await request(app.getHttpServer())
      .get('/admin/message-queue')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(queue.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
    const queued = queue.body.items.find((item: { id: string }) => item.id === created.body.id);
    expect(queued.customerPhone).toMatch(/^09\d{9}$/);
    expect(queued.messageText).toBe('سلام سارا جان');
    expect(queued.messageBusinessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(queue.body)).not.toContain('passwordHash');

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/select-manual`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(403);

    const manual = await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/select-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(manual.body.mode).toBe('MANUAL');
    expect(manual.body.status).toBe('DISPATCHED');

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/select-bale`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const sent = await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(sent.body.status).toBe('SENT');

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const salonView = await request(app.getHttpServer())
      .get(`/messages/${created.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(salonView.body.status).toBe('SENT');
    expect(salonView.body.mode).toBe('MANUAL');
  });

  it('selects Bale without credentials without losing the queued request', async () => {
    const salon = await registerOwner('msg-bale');
    const customerId = await seedRevenueDecline(salon.token, 'Bale');
    const created = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerId))
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'bale-queue-01')
      .send({ text: 'صف بله' })
      .expect(201);

    const selected = await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/select-bale`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(selected.body.mode).toBe('BALE');
    expect(selected.body.status).toBe('DISPATCHED');
    const requestRow = await prisma.client.messageRequest.findFirst({
      where: { id: created.body.id },
    });
    expect(requestRow?.status).toBe('DISPATCHED');
    if (!selected.body.providerReady) {
      const activated = await prisma.client.outboxEvent.count({
        where: { tenantId: salon.tenantId, eventType: 'MessageDeliveryActivated' },
      });
      expect(activated).toBe(0);
    }
  });

  it('does not let historical same-day backfill consume the new daily limit', async () => {
    const salon = await registerOwner('msg-hist');
    const customerId = await seedRevenueDecline(salon.token, 'Hist');
    const now = new Date();
    const actionId = randomUUID();
    await prisma.client.opportunityAction.create({
      data: {
        id: actionId,
        salonId: salon.tenantId,
        customerId,
        opportunityType: 'REVENUE_DECLINE',
        status: 'OPEN',
        createdBy: salon.userId,
        updatedAt: now,
      },
    });
    const day = messageBusinessDateValue(now);
    await prisma.client.messageRequest.createMany({
      data: ['legacy-a', 'legacy-b'].map((messageText) => ({
        id: randomUUID(),
        salonId: salon.tenantId,
        customerId,
        actionId,
        createdByUserId: salon.userId,
        opportunityType: 'REVENUE_DECLINE' as const,
        messageText,
        requestedAt: now,
        messageBusinessDate: day,
        countsTowardDailyLimit: false,
        status: 'DISPATCHED' as const,
        updatedAt: now,
      })),
    });

    const created = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerId))
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'hist-send-01')
      .send({ text: 'درخواست جدید' })
      .expect(201);
    expect(created.body.status).toBe('QUEUED');

    const replay = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerId))
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'hist-send-01')
      .send({ text: 'درخواست جدید' })
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerId))
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'hist-send-01')
      .send({ text: 'متن دیگر' })
      .expect(409);

    const daily = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerId))
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'hist-send-02')
      .send({ text: 'پیام دوم' })
      .expect(409);
    expect(daily.body.error).toBe('MESSAGE_DAILY_LIMIT_REACHED');
  });

  it('returns 409 MESSAGE_DAILY_LIMIT_REACHED for concurrent same-day sends and never 500', async () => {
    const salon = await registerOwner('msg-race');
    const customerId = await seedRevenueDecline(salon.token, 'Race');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        request(app.getHttpServer())
          .post(sendPath('REVENUE_DECLINE', customerId))
          .set('Authorization', `Bearer ${salon.token}`)
          .set('Idempotency-Key', `race-key-${index}-${randomUUID()}`)
          .send({ text: 'مسابقه همزمان' }),
      ),
    );

    const created = results.filter((result) => result.status === 201);
    const limited = results.filter(
      (result) => result.status === 409 && result.body.error === 'MESSAGE_DAILY_LIMIT_REACHED',
    );
    const unexpected = results.filter(
      (result) => result.status !== 201 && result.body.error !== 'MESSAGE_DAILY_LIMIT_REACHED',
    );
    expect(unexpected.map((result) => ({ status: result.status, error: result.body.error }))).toEqual(
      [],
    );
    expect(created).toHaveLength(1);
    expect(limited).toHaveLength(9);
    expect(created[0]?.body.status).toBe('QUEUED');

    const enforceable = await prisma.client.messageRequest.count({
      where: { salonId: salon.tenantId, customerId, countsTowardDailyLimit: true },
    });
    expect(enforceable).toBe(1);
    const openActions = await prisma.client.opportunityAction.count({
      where: {
        salonId: salon.tenantId,
        customerId,
        opportunityType: 'REVENUE_DECLINE',
        status: 'OPEN',
      },
    });
    expect(openActions).toBe(1);
  });
});

import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { messageBusinessDateValue } from '@salon/shared';
import { SendCustomerMessageHandler } from '../../worker/src/messaging/send-customer-message.handler';
import { listPage } from './list-page';

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

  async function createOwnerBypassingRegisterThrottle(label: string) {
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
    const token = await app.get(JwtService).signAsync({ sub: userId, tid: salonId, role: 'OWNER' });
    return {
      email,
      token,
      userId,
      tenantId: salonId,
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

  it.each(['manual', 'opportunity'] as const)(
    'keeps the %s destination through phone change, replay, and worker execution',
    async (origin) => {
      const salon = await createOwnerBypassingRegisterThrottle(`destination-${origin}`);
      const customerId = origin === 'manual'
        ? await createCustomer(salon.token, 'Snapshot')
        : await seedRevenueDecline(salon.token, 'Snapshot');
      const originalPhone = (await prisma.client.customer.findUniqueOrThrow({ where: { id: customerId } })).phoneNumber;
      const nextPhone = originalPhone === '09129999999' ? '09128888888' : '09129999999';
      const path = origin === 'manual' ? `/customers/${customerId}/messages` : sendPath('REVENUE_DECLINE', customerId);
      const key = `destination-${origin}-${randomUUID()}`;
      const text = `Destination snapshot ${origin}`;
      const send = (token: string, idempotencyKey: string, body = text) => request(app.getHttpServer())
        .post(path).set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', idempotencyKey).send({ text: body });

      const first = await send(salon.token, key).expect(201);
      const requestId = first.body.id as string;
      expect((await prisma.client.messageRequest.findUniqueOrThrow({ where: { id: requestId } })).recipientPhoneNumber).toBe(originalPhone);
      await request(app.getHttpServer()).patch(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${salon.token}`).send({ phoneNumber: nextPhone }).expect(200);
      expect((await prisma.client.messageRequest.findUniqueOrThrow({ where: { id: requestId } })).recipientPhoneNumber).toBe(originalPhone);
      expect((await request(app.getHttpServer()).get(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${salon.token}`).expect(200)).body.phoneNumber).toBe(nextPhone);

      const replay = await send(salon.token, key).expect(201);
      expect(replay.body.id).toBe(requestId);
      expect(replay.body.destinationHint).toBe(first.body.destinationHint);
      await send(salon.token, key, `${text} changed`).expect(409);
      expect(await prisma.client.messageRequest.count({ where: { salonId: salon.tenantId, customerId } })).toBe(1);
      expect(await prisma.client.auditLog.count({ where: { tenantId: salon.tenantId, action: 'MESSAGE_REQUESTED', resourceId: requestId } })).toBe(1);
      expect(await prisma.client.outboxEvent.count({ where: { tenantId: salon.tenantId, eventType: 'MessageRequested', payload: { path: ['messageRequestId'], equals: requestId } } })).toBe(1);
      const requestedAudit = await prisma.client.auditLog.findFirstOrThrow({ where: { tenantId: salon.tenantId, action: 'MESSAGE_REQUESTED', resourceId: requestId } });
      const requestedEvent = await prisma.client.outboxEvent.findFirstOrThrow({ where: { tenantId: salon.tenantId, eventType: 'MessageRequested', payload: { path: ['messageRequestId'], equals: requestId } } });
      for (const evidence of [requestedAudit.metadata, requestedEvent.payload]) {
        expect(JSON.stringify(evidence)).not.toContain(originalPhone);
        expect(JSON.stringify(evidence)).not.toContain(text);
      }
      const adminBefore = await request(app.getHttpServer()).get(`/admin/message-queue/${requestId}`)
        .set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(adminBefore.body.customerPhone).toBe(originalPhone);
      const salonBefore = await request(app.getHttpServer()).get(`/messages/${requestId}`)
        .set('Authorization', `Bearer ${salon.token}`).expect(200);
      expect(salonBefore.body.destinationHint).toBe(first.body.destinationHint);
      expect(JSON.stringify(salonBefore.body)).not.toContain(originalPhone);

      const config = app.get(AppConfigService).values;
      const previousKey = config.BALE_SAFIR_API_ACCESS_KEY;
      const previousBot = config.BALE_SAFIR_BOT_ID;
      config.BALE_SAFIR_API_ACCESS_KEY = 'isolated-fake-provider';
      config.BALE_SAFIR_BOT_ID = 1;
      try {
        await request(app.getHttpServer()).post(`/admin/message-queue/${requestId}/select-bale`)
          .set('Authorization', `Bearer ${adminToken}`).expect(201);
      } finally {
        config.BALE_SAFIR_API_ACCESS_KEY = previousKey;
        config.BALE_SAFIR_BOT_ID = previousBot;
      }
      const delivery = await prisma.client.messageDelivery.findUniqueOrThrow({ where: { messageRequestId: requestId } });
      const activation = await prisma.client.outboxEvent.findFirstOrThrow({
        where: { tenantId: salon.tenantId, eventType: 'MessageDeliveryActivated', payload: { path: ['messageDeliveryId'], equals: delivery.id } },
      });
      const now = new Date();
      const claimed = await prisma.client.outboxEvent.update({ where: { id: activation.id }, data: {
        status: 'PROCESSING', claimGeneration: { increment: 1 }, lockedAt: now,
        lockedUntil: new Date(now.getTime() + 30_000), attemptCount: { increment: 1 },
      } });
      const sendText = jest.fn(async () => ({ outcome: 'sent' as const, providerMessageId: `fake-${origin}` }));
      const handler = new SendCustomerMessageHandler({ client: prisma.client } as never, { sendText } as never);
      expect(await handler.handle(claimed, 8)).toEqual({ outcome: 'completed' });
      expect(sendText).toHaveBeenCalledWith(expect.objectContaining({
        phoneNumber: originalPhone, requestId: delivery.providerRequestId, text,
      }));
      expect((await prisma.client.messageDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('SENT');
      expect((await prisma.client.messageRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('SENT');
      const terminalAudit = await prisma.client.auditLog.findFirstOrThrow({ where: { tenantId: salon.tenantId, action: 'MESSAGE_SENT', resourceId: delivery.id } });
      const terminalEvent = await prisma.client.outboxEvent.findFirstOrThrow({ where: { tenantId: salon.tenantId, eventType: 'MessageSent', payload: { path: ['messageRequestId'], equals: requestId } } });
      for (const evidence of [terminalAudit.metadata, terminalEvent.payload]) {
        expect(JSON.stringify(evidence)).not.toContain(originalPhone);
        expect(JSON.stringify(evidence)).not.toContain(text);
      }

      // A controlled next Tehran day permits a genuinely new intent without changing the daily-limit fixture.
      jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask', 'performance'] });
      try {
        jest.setSystemTime(new Date(Date.now() + 2 * 86_400_000));
        const laterToken = await app.get(JwtService).signAsync({ sub: salon.userId, tid: salon.tenantId, role: 'OWNER' });
        const later = await send(laterToken, `later-${randomUUID()}`).expect(201);
        expect(later.body.id).not.toBe(requestId);
        expect((await prisma.client.messageRequest.findUniqueOrThrow({ where: { id: later.body.id } })).recipientPhoneNumber).toBe(nextPhone);
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('rejects unauthenticated message access', async () => {
    await request(app.getHttpServer()).get(`/messages/${randomUUID()}`).expect(401);
    await request(app.getHttpServer()).get('/messages/manual-outreach').expect(401);
    await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', randomUUID()))
      .send({ text: 'سلام' })
      .expect(401);
    await request(app.getHttpServer()).get('/admin/message-queue').expect(401);
  });

  it('queues a durable message without Bale credentials and enforces daily limit and idempotency', async () => {
    const salonA = await createOwnerBypassingRegisterThrottle('msg-a');
    const salonB = await createOwnerBypassingRegisterThrottle('msg-b');
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
    expect(JSON.stringify(outbox, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain('test-safir-access-key');
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

    const manualInbox = listPage<{ messageRequestId: string }>(
      (
        await request(app.getHttpServer())
          .get('/messages/manual-outreach')
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(
      manualInbox.items.some((item) => item.messageRequestId === created.body.id),
    ).toBe(false);

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
    expect(sent.body.canMarkManualSent).toBe(false);
    expect(sent.body.canCancel).toBe(false);

    const sentReplay = await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(sentReplay.body.status).toBe('SENT');
    expect(sentReplay.body.submittedAt).toBe(sent.body.submittedAt);

    const salonView = await request(app.getHttpServer())
      .get(`/messages/${created.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(salonView.body.status).toBe('SENT');
    expect(salonView.body.mode).toBe('MANUAL');
  });

  it('selects Bale without credentials without losing the queued request', async () => {
    const salon = await createOwnerBypassingRegisterThrottle('msg-bale');
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

  it('serializes different-admin Bale retries to one activation generation', async () => {
    const config = app.get(AppConfigService).values;
    const previousKey = config.BALE_SAFIR_API_ACCESS_KEY;
    const previousBot = config.BALE_SAFIR_BOT_ID;
    config.BALE_SAFIR_API_ACCESS_KEY = 'phase2-test-key';
    config.BALE_SAFIR_BOT_ID = 1;
    try {
    const otherEmail = `retry-admin-${randomUUID()}@example.test`;
    await prisma.client.platformAdmin.create({ data: {
      id: randomUUID(), email: otherEmail, name: 'Retry race admin',
      passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }), updatedAt: new Date(),
    } });
    const otherLogin = await request(app.getHttpServer()).post('/admin/auth/login')
      .send({ email: otherEmail, password: adminPassword }).expect(201);
    const salon = await createOwnerBypassingRegisterThrottle('msg-retry-race');
    const customerId = await seedRevenueDecline(salon.token, 'RetryRace');
    const created = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', customerId))
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `retry-create-${randomUUID()}`)
      .send({ text: 'فقط برای تست retry' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/select-bale`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const delivery = await prisma.client.messageDelivery.findUniqueOrThrow({
      where: { messageRequestId: created.body.id },
    });
    const failedAt = new Date();
    await prisma.client.$transaction([
      prisma.client.messageDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', failureCode: 'PROVIDER_TEMPORARY', failedAt },
      }),
      prisma.client.messageRequest.update({
        where: { id: created.body.id },
        data: { status: 'FAILED' },
      }),
      prisma.client.outboxEvent.updateMany({
        where: { eventType: 'MessageDeliveryActivated', payload: { path: ['messageDeliveryId'], equals: delivery.id } },
        data: { status: 'PROCESSED', processedAt: new Date(), lockedAt: null, lockedUntil: null },
      }),
    ]);

    const retries = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/message-queue/${created.body.id}/retry`)
        .set('Authorization', `Bearer ${otherLogin.body.accessToken}`),
      request(app.getHttpServer())
        .post(`/admin/message-queue/${created.body.id}/retry`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(retries.map((response) => response.status).sort()).toEqual([201, 409]);
    const finalDelivery = await prisma.client.messageDelivery.findUniqueOrThrow({
      where: { messageRequestId: created.body.id },
    });
    expect(finalDelivery.executionGeneration).toBe(1);
    expect(finalDelivery.status).toBe('PENDING');
    const activationEvents = await prisma.client.outboxEvent.findMany({
      where: { tenantId: salon.tenantId, eventType: 'MessageDeliveryActivated' },
    });
    const forDelivery = activationEvents.filter(
      (item) => (item.payload as { messageDeliveryId?: string }).messageDeliveryId === delivery.id,
    );
    expect(forDelivery).toHaveLength(2);
    expect(forDelivery.filter((item) => item.dedupeKey === `message-delivery:${delivery.id}:1`)).toHaveLength(1);
    for (const operation of ['cancel', 'mark-manual-sent']) {
      await request(app.getHttpServer()).post(`/admin/message-queue/${created.body.id}/${operation}`)
        .set('Authorization', `Bearer ${adminToken}`).expect(409);
    }
    await prisma.client.$transaction([
      prisma.client.messageDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', submittedAt: new Date() } }),
      prisma.client.messageRequest.update({ where: { id: created.body.id }, data: { status: 'SENT' } }),
    ]);
    await request(app.getHttpServer()).post(`/admin/message-queue/${created.body.id}/retry`)
      .set('Authorization', `Bearer ${adminToken}`).expect(409);
    expect(await prisma.client.outboxEvent.count({ where: { dedupeKey: { startsWith: `message-delivery:${delivery.id}:` } } })).toBe(2);
    } finally {
      config.BALE_SAFIR_API_ACCESS_KEY = previousKey;
      config.BALE_SAFIR_BOT_ID = previousBot;
    }
  });

  it('does not let historical same-day backfill consume the new daily limit', async () => {
    const salon = await createOwnerBypassingRegisterThrottle('msg-hist');
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
        recipientPhoneNumber: '09121111111',
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
    const salon = await createOwnerBypassingRegisterThrottle('msg-race');
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

  it('queues manual outreach without an OpportunityAction and shares the daily limit', async () => {
    const salonA = await createOwnerBypassingRegisterThrottle('outreach-a');
    const salonB = await createOwnerBypassingRegisterThrottle('outreach-b');
    const customerA = await createCustomer(salonA.token, 'One');
    const customerTwo = await createCustomer(salonA.token, 'Two');
    const customerB = await createCustomer(salonB.token, 'Other');
    const text =
      'سارا عزیز برای فردا ساعت ۱۸:۰۰ می‌توانیم با ۲۰۰ هزار تومان تخفیف در سالن گلاب در خدمت شما باشیم! برای رزرو این وقت با شماره ۰۹۱۲۱۱۱۱۱۱۱ تماس بگیرید!';

    const created = await request(app.getHttpServer())
      .post(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'manual-outreach-01')
      .send({ text })
      .expect(201);

    expect(created.body.status).toBe('QUEUED');
    expect(created.body.body).toBe(text);
    expect(created.body.actionId).toBeNull();
    expect(created.body.opportunityType).toBeNull();
    expect(created.body.mode).toBeNull();

    const replay = await request(app.getHttpServer())
      .post(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'manual-outreach-01')
      .send({ text })
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'manual-outreach-01')
      .send({ text: `${text}۲` })
      .expect(409);

    const daily = await request(app.getHttpServer())
      .post(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'manual-outreach-02')
      .send({ text: `${text}۳` })
      .expect(409);
    expect(daily.body.error).toBe('MESSAGE_DAILY_LIMIT_REACHED');

    const second = await request(app.getHttpServer())
      .post(`/customers/${customerTwo}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'manual-outreach-other')
      .send({ text })
      .expect(201);
    expect(second.body.id).not.toBe(created.body.id);

    await request(app.getHttpServer())
      .post(`/customers/${customerB}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'manual-outreach-cross')
      .send({ text })
      .expect(404);

    const actions = await prisma.client.opportunityAction.count({
      where: { salonId: salonA.tenantId, customerId: customerA },
    });
    expect(actions).toBe(0);

    const deliveries = await prisma.client.messageDelivery.count({
      where: { salonId: salonA.tenantId, customerId: customerA },
    });
    expect(deliveries).toBe(0);

    const stored = await prisma.client.messageRequest.findFirst({
      where: { id: created.body.id, salonId: salonA.tenantId },
    });
    expect(stored?.messageText).toBe(text);
    expect(stored?.actionId).toBeNull();

    const outbox = await prisma.client.outboxEvent.findMany({
      where: { tenantId: salonA.tenantId, eventType: 'MessageRequested' },
    });
    expect(
      outbox.some(
        (event) =>
          (event.payload as { messageRequestId?: string }).messageRequestId === created.body.id,
      ),
    ).toBe(true);
    expect(JSON.stringify(outbox, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain(text);

    const audit = await prisma.client.auditLog.findFirst({
      where: {
        tenantId: salonA.tenantId,
        action: 'MESSAGE_REQUESTED',
        resourceId: created.body.id,
      },
    });
    expect(audit?.actorId).toBe(salonA.userId);
    expect(JSON.stringify(audit?.metadata)).not.toContain(text);

    const queue = await request(app.getHttpServer())
      .get('/admin/message-queue')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(queue.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
    const queued = queue.body.items.find((item: { id: string }) => item.id === created.body.id);
    expect(queued.messageText).toBe(text);
    expect(queued.opportunityType).toBeNull();
  });

  it('enforces the same Tehran-day limit across opportunity and manual outreach', async () => {
    const salon = await createOwnerBypassingRegisterThrottle('msg-cross-day');
    const opportunityFirst = await seedRevenueDecline(salon.token, 'OppFirst');
    const manualFirst = await seedRevenueDecline(salon.token, 'ManFirst');

    const opportunityQueued = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', opportunityFirst))
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'cross-opp-first')
      .send({ text: 'پیام فرصت اول' })
      .expect(201);
    expect(opportunityQueued.body.actionId).toBeTruthy();
    expect(opportunityQueued.body.opportunityType).toBe('REVENUE_DECLINE');

    const blockedManual = await request(app.getHttpServer())
      .post(`/customers/${opportunityFirst}/messages`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'cross-manual-blocked')
      .send({ text: 'پیام دستی همان روز' })
      .expect(409);
    expect(blockedManual.body.error).toBe('MESSAGE_DAILY_LIMIT_REACHED');

    expect(
      await prisma.client.messageRequest.count({
        where: { salonId: salon.tenantId, customerId: opportunityFirst, countsTowardDailyLimit: true },
      }),
    ).toBe(1);
    expect(
      await prisma.client.opportunityAction.count({
        where: { salonId: salon.tenantId, customerId: opportunityFirst },
      }),
    ).toBe(1);
    expect(
      await prisma.client.messageDelivery.count({
        where: { salonId: salon.tenantId, customerId: opportunityFirst },
      }),
    ).toBe(0);

    const manualQueued = await request(app.getHttpServer())
      .post(`/customers/${manualFirst}/messages`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'cross-manual-first')
      .send({ text: 'پیام دستی اول' })
      .expect(201);
    expect(manualQueued.body.actionId).toBeNull();
    expect(manualQueued.body.opportunityType).toBeNull();

    const blockedOpportunity = await request(app.getHttpServer())
      .post(sendPath('REVENUE_DECLINE', manualFirst))
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'cross-opp-blocked')
      .send({ text: 'پیام فرصت همان روز' })
      .expect(409);
    expect(blockedOpportunity.body.error).toBe('MESSAGE_DAILY_LIMIT_REACHED');

    expect(
      await prisma.client.messageRequest.count({
        where: { salonId: salon.tenantId, customerId: manualFirst, countsTowardDailyLimit: true },
      }),
    ).toBe(1);
    expect(
      await prisma.client.opportunityAction.count({
        where: { salonId: salon.tenantId, customerId: manualFirst },
      }),
    ).toBe(0);
    expect(
      await prisma.client.messageDelivery.count({
        where: { salonId: salon.tenantId, customerId: manualFirst },
      }),
    ).toBe(0);
    const manualFirstOutbox = await prisma.client.outboxEvent.findMany({
      where: { tenantId: salon.tenantId, eventType: 'MessageRequested' },
    });
    expect(
      manualFirstOutbox.filter(
        (event) =>
          (event.payload as { messageRequestId?: string }).messageRequestId === manualQueued.body.id,
      ),
    ).toHaveLength(1);
  });

  it('dispatches a manual outreach request through the admin queue with a null action', async () => {
    const salon = await createOwnerBypassingRegisterThrottle('outreach-dispatch');
    const customerId = await createCustomer(salon.token, 'Dispatch');
    const text = 'پیام دستی برای صف ادمین';

    const created = await request(app.getHttpServer())
      .post(`/customers/${customerId}/messages`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', 'manual-dispatch-01')
      .send({ text })
      .expect(201);

    expect(created.body.status).toBe('QUEUED');
    expect(created.body.actionId).toBeNull();
    expect(created.body.opportunityType).toBeNull();
    expect(created.body.mode).toBeNull();

    const stored = await prisma.client.messageRequest.findFirst({
      where: { id: created.body.id, salonId: salon.tenantId },
    });
    expect(stored?.status).toBe('QUEUED');
    expect(stored?.actionId).toBeNull();
    expect(stored?.opportunityType).toBeNull();
    expect(await prisma.client.opportunityAction.count({ where: { salonId: salon.tenantId } })).toBe(
      0,
    );
    expect(
      await prisma.client.messageDelivery.count({
        where: { salonId: salon.tenantId, customerId },
      }),
    ).toBe(0);

    const dispatched = await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/select-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(dispatched.body.status).toBe('DISPATCHED');
    expect(dispatched.body.mode).toBe('MANUAL');
    expect(dispatched.body.opportunityType).toBeNull();
    expect(dispatched.body.messageText).toBe(text);

    const delivery = await prisma.client.messageDelivery.findFirst({
      where: { messageRequestId: created.body.id, salonId: salon.tenantId },
    });
    expect(delivery).toMatchObject({
      customerId,
      actionId: null,
      mode: 'MANUAL',
      status: 'PENDING',
      provider: null,
    });
    expect(await prisma.client.opportunityAction.count({ where: { salonId: salon.tenantId } })).toBe(
      0,
    );
    expect(
      await prisma.client.outboxEvent.count({
        where: { tenantId: salon.tenantId, eventType: 'MessageDeliveryActivated' },
      }),
    ).toBe(0);
  });

  it('returns 409 MESSAGE_DAILY_LIMIT_REACHED for concurrent manual outreach', async () => {
    const salon = await createOwnerBypassingRegisterThrottle('outreach-race');
    const customerId = await createCustomer(salon.token, 'Race');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        request(app.getHttpServer())
          .post(`/customers/${customerId}/messages`)
          .set('Authorization', `Bearer ${salon.token}`)
          .set('Idempotency-Key', `outreach-race-${index}-${randomUUID()}`)
          .send({ text: 'پیام همزمان دستی' }),
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
    expect(await prisma.client.opportunityAction.count({ where: { salonId: salon.tenantId } })).toBe(
      0,
    );
  });

  it('exposes manual outreach lifecycle on salon reads without creating OpportunityActions', async () => {
    const salonA = await createOwnerBypassingRegisterThrottle('outreach-visible-a');
    const salonB = await createOwnerBypassingRegisterThrottle('outreach-visible-b');
    const customerA = await createCustomer(salonA.token, 'Visible');
    const customerB = await createCustomer(salonA.token, 'Second');
    const otherCustomer = await createCustomer(salonB.token, 'Other');
    const text = 'پیام دستی برای وضعیت سالن';

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salonA.token}`)
      .send({ customerId: customerA, visitedAt: '2026-09-01T10:00:00.000Z' })
      .expect(201);

    const first = await request(app.getHttpServer())
      .post(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visible-manual-01')
      .send({ text })
      .expect(201);
    expect(first.body.status).toBe('QUEUED');
    expect(first.body.actionId).toBeNull();

    const second = await request(app.getHttpServer())
      .post(`/customers/${customerB}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', 'visible-manual-02')
      .send({ text })
      .expect(201);
    expect(second.body.id).not.toBe(first.body.id);

    const listed = listPage<{
      customerId: string;
      messageRequestId: string;
      status: string;
      customerName: string;
    }>(
      (
        await request(app.getHttpServer())
          .get('/messages/manual-outreach')
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(listed.items).toHaveLength(2);
    const firstItem = listed.items.find((item) => item.customerId === customerA);
    const secondItem = listed.items.find((item) => item.customerId === customerB);
    expect(firstItem).toMatchObject({
      messageRequestId: first.body.id,
      status: 'QUEUED',
    });
    expect(secondItem).toMatchObject({
      messageRequestId: second.body.id,
      status: 'QUEUED',
    });
    expect(JSON.stringify(listed)).not.toContain(text);
    expect(JSON.stringify(listed)).not.toContain('actionId');
    expect(JSON.stringify(listed)).not.toContain('opportunityType');

    await request(app.getHttpServer())
      .get('/messages/manual-outreach')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200)
      .expect((response) => {
        expect(
          listPage(response.body).items.some(
            (item: { customerId: string }) => item.customerId === customerA,
          ),
        ).toBe(false);
      });

    const activity = listPage<{ type: string; status: string | null; id: string }>(
      (
        await request(app.getHttpServer())
          .get(`/customers/${customerA}/activity`)
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(activity.items.filter((item) => item.type === 'MANUAL_MESSAGE')).toHaveLength(1);
    expect(activity.items.some((item) => item.type === 'VISIT')).toBe(true);
    expect(activity.items.find((item) => item.type === 'MANUAL_MESSAGE')).toMatchObject({
      id: first.body.id,
      status: 'QUEUED',
    });
    expect(JSON.stringify(activity)).not.toContain(text);

    await request(app.getHttpServer())
      .get(`/customers/${customerA}/activity`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/customers/${otherCustomer}/activity`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(404);

    const storedQueued = await prisma.client.messageRequest.findFirst({
      where: { id: first.body.id, salonId: salonA.tenantId },
    });
    expect(storedQueued).toMatchObject({
      actionId: null,
      opportunityType: null,
      status: 'QUEUED',
    });

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${first.body.id}/select-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const afterDispatch = listPage<{ customerId: string; status: string }>(
      (
        await request(app.getHttpServer())
          .get('/messages/manual-outreach')
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(afterDispatch.items.find((item) => item.customerId === customerA)?.status).toBe(
      'DISPATCHED',
    );
    expect(afterDispatch.items.find((item) => item.customerId === customerB)?.status).toBe('QUEUED');

    const salonCollapsed = await request(app.getHttpServer())
      .get(`/messages/${first.body.id}`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(salonCollapsed.body.status).toBe('QUEUED');

    const activityAfter = listPage<{ type: string; status: string | null }>(
      (
        await request(app.getHttpServer())
          .get(`/customers/${customerA}/activity`)
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(activityAfter.items.filter((item) => item.type === 'MANUAL_MESSAGE')).toHaveLength(1);
    expect(activityAfter.items.find((item) => item.type === 'MANUAL_MESSAGE')?.status).toBe(
      'DISPATCHED',
    );

    const delivery = await prisma.client.messageDelivery.findFirst({
      where: { messageRequestId: first.body.id, salonId: salonA.tenantId },
    });
    expect(delivery?.actionId).toBeNull();
    expect(delivery?.status).toBe('PENDING');
    expect(await prisma.client.opportunityAction.count({ where: { salonId: salonA.tenantId } })).toBe(
      0,
    );

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${first.body.id}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const afterSent = listPage<{ customerId: string; status: string; messageRequestId: string }>(
      (
        await request(app.getHttpServer())
          .get('/messages/manual-outreach')
          .set('Authorization', `Bearer ${salonA.token}`)
          .expect(200)
      ).body,
    );
    expect(afterSent.items).toHaveLength(2);
    expect(afterSent.items.find((item) => item.customerId === customerA)).toMatchObject({
      messageRequestId: first.body.id,
      status: 'SENT',
    });
    expect(afterSent.items.find((item) => item.customerId === customerB)?.status).toBe('QUEUED');
  });

  it('groups ordinary messages by salon and excludes VIP provenance', async () => {
    const salonA = await createOwnerBypassingRegisterThrottle('fold-a');
    const salonB = await createOwnerBypassingRegisterThrottle('fold-b');
    const emptySalon = await createOwnerBypassingRegisterThrottle('fold-empty');
    const customerA = await createCustomer(salonA.token, 'FolderA');
    const customerB = await createCustomer(salonB.token, 'FolderB');
    const first = await request(app.getHttpServer())
      .post(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', `fold-a-${randomUUID()}`)
      .send({ text: 'سلام سالن آ' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/customers/${customerB}/messages`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .set('Idempotency-Key', `fold-b-${randomUUID()}`)
      .send({ text: 'سلام سالن ب' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/admin/messages/normal/salons')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(403);

    const folders = await request(app.getHttpServer())
      .get('/admin/messages/normal/salons')
      .query({ q: 'fold-a' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(folders.body.items.some((row: { salonId: string }) => row.salonId === salonA.tenantId)).toBe(
      true,
    );
    expect(folders.body.items.some((row: { salonId: string }) => row.salonId === salonB.tenantId)).toBe(
      false,
    );
    const folderA = folders.body.items.find((row: { salonId: string }) => row.salonId === salonA.tenantId);
    expect(folderA.totalMessageCount).toBeGreaterThanOrEqual(1);
    expect(folderA.sentMessageCount).toBe(0);
    expect(folderA.pendingMessageCount).toBeGreaterThanOrEqual(1);

    const renamed = await prisma.client.salon.update({
      where: { id: salonA.tenantId },
      data: { name: `FolderA-renamed ${Date.now()}` },
    });
    const afterRename = await request(app.getHttpServer())
      .get('/admin/messages/normal/salons')
      .query({ q: renamed.name })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(afterRename.body.items[0].salonName).toBe(renamed.name);

    const detail = await request(app.getHttpServer())
      .get(`/admin/messages/normal/salons/${salonA.tenantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.salonId).toBe(salonA.tenantId);
    expect(detail.body.items.some((row: { id: string }) => row.id === first.body.id)).toBe(true);
    expect(detail.body.items.every((row: { salonId: string }) => row.salonId === salonA.tenantId)).toBe(
      true,
    );
    expect(detail.body.items.every((row: { vipRequestId: string | null }) => row.vipRequestId == null)).toBe(
      true,
    );
    expect(detail.body.items[0].canCancel).toBeDefined();
    expect(detail.body.items[0].canMarkManualSent).toBeDefined();

    const emptyDetail = await request(app.getHttpServer())
      .get(`/admin/messages/normal/salons/${emptySalon.tenantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(emptyDetail.body).toMatchObject({
      totalMessageCount: 0,
      sentMessageCount: 0,
      pendingMessageCount: 0,
      failedMessageCount: 0,
      cancelledMessageCount: 0,
      items: [],
    });
  });

  it('cancels queued ordinary messages without deleting history and races with claim/manual-sent', async () => {
    const salon = await createOwnerBypassingRegisterThrottle('cancel-q');
    const customer = await createCustomer(salon.token, 'Cancel');
    const created = await request(app.getHttpServer())
      .post(`/customers/${customer}/messages`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `cancel-${randomUUID()}`)
      .send({ text: 'حذف از صف' })
      .expect(201);

    const cancelled = await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.canCancel).toBe(false);
    expect(cancelled.body.executionState).toBe('CANCELLED');

    const replay = await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(replay.body.status).toBe('CANCELLED');

    const persisted = await prisma.client.messageRequest.findFirst({
      where: { id: created.body.id },
    });
    expect(persisted?.status).toBe('CANCELLED');
    expect(persisted?.messageText).toBe('حذف از صف');

    const salonView = await request(app.getHttpServer())
      .get(`/messages/${created.body.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(salonView.body.status).toBe('CANCELLED');

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/select-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${created.body.id}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const sentCustomer = await createCustomer(salon.token, 'SentCancel');
    const toSend = await request(app.getHttpServer())
      .post(`/customers/${sentCustomer}/messages`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `sent-cancel-${randomUUID()}`)
      .send({ text: 'ارسال شده' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${toSend.body.id}/mark-manual-sent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${toSend.body.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const raceCustomer = await createCustomer(salon.token, 'Race');
    const raced = await request(app.getHttpServer())
      .post(`/customers/${raceCustomer}/messages`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `race-${randomUUID()}`)
      .send({ text: 'مسابقه' })
      .expect(201);
    const racedResults = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/message-queue/${raced.body.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app.getHttpServer())
        .post(`/admin/message-queue/${raced.body.id}/select-manual`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);
    const racedStatuses = racedResults.map((res) => res.status).sort();
    expect(racedStatuses).toEqual([201, 409]);
    const afterRace = await prisma.client.messageRequest.findFirstOrThrow({
      where: { id: raced.body.id },
    });
    expect(['CANCELLED', 'DISPATCHED']).toContain(afterRace.status);
    if (afterRace.status === 'CANCELLED') {
      expect(
        await prisma.client.messageDelivery.count({ where: { messageRequestId: raced.body.id } }),
      ).toBe(0);
    }

    const manualCustomer = await createCustomer(salon.token, 'ManualRace');
    const manual = await request(app.getHttpServer())
      .post(`/customers/${manualCustomer}/messages`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `manual-race-${randomUUID()}`)
      .send({ text: 'دستی' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${manual.body.id}/select-manual`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const manualRace = await Promise.all([
      request(app.getHttpServer())
        .post(`/admin/message-queue/${manual.body.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app.getHttpServer())
        .post(`/admin/message-queue/${manual.body.id}/mark-manual-sent`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(manualRace.map((res) => res.status).sort()).toEqual([201, 409]);
    const afterManual = await prisma.client.messageRequest.findFirstOrThrow({
      where: { id: manual.body.id },
    });
    expect(['CANCELLED', 'SENT']).toContain(afterManual.status);
    const delivery = await prisma.client.messageDelivery.findFirst({
      where: { messageRequestId: manual.body.id },
    });
    if (afterManual.status === 'SENT') {
      expect(delivery?.status).toBe('SENT');
      expect(delivery?.submittedAt).toBeTruthy();
    } else {
      expect(delivery?.status).not.toBe('SENT');
    }

    const folder = await request(app.getHttpServer())
      .get(`/admin/messages/normal/salons/${salon.tenantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(folder.body.cancelledMessageCount).toBeGreaterThanOrEqual(1);
    expect(folder.body.totalMessageCount).toBeGreaterThanOrEqual(folder.body.sentMessageCount);
  });
});

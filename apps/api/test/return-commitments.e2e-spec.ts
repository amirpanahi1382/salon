import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { listPage } from './list-page';
import { staffRequest, syntheticMobile } from './support/phone-account';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

type Commitment = {
  id: string;
  customerId: string;
  sourceMessage: { requestId: string; deliveryId: string };
  expectedAt: string;
  actualVisitId: string | null;
  updatedAt: string;
};

describeIfDb('Return commitments (e2e)', () => {
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

  beforeEach(() => {
    // Cases in this file share the in-memory address counter. The concurrency
    // case is not a throttle test; start each case from an empty counter.
    const storage = app.get(ThrottlerStorage) as {
      storage: Map<string, { totalHits: Map<string, number>; isBlocked: boolean }>;
      timeoutIds?: Map<string, NodeJS.Timeout[]>;
    };
    storage.timeoutIds?.forEach((ids) => {
      for (const id of ids) clearTimeout(id);
    });
    storage.timeoutIds?.clear();
    storage.storage.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerOwner(label: string) {
    const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
    const phone = syntheticMobile();
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
        phone,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'OWNER',
        updatedAt: now,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login/phone')
      .send({ phone, password })
      .expect(201);
    return {
      email,
      token: login.body.accessToken as string,
      userId: login.body.user.id as string,
      tenantId: login.body.user.tenantId as string,
    };
  }

  async function login(phone: string) {
    return (
      await request(app.getHttpServer()).post('/auth/login/phone').send({ phone, password }).expect(201)
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

  async function insertCustomerMessage(input: {
    salonId: string;
    userId: string;
    customerId: string;
    requestedAt: Date;
    submittedAt: Date | null;
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
        recipientPhoneNumber: (await prisma.client.customer.findUniqueOrThrow({ where: { id: input.customerId } })).phoneNumber,
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
        createdAt: input.requestedAt,
        updatedAt: now,
        submittedAt: input.status === 'SENT' ? input.submittedAt : null,
        failedAt: input.status === 'FAILED' ? now : null,
      },
    });
    return { requestId, deliveryId };
  }

  function futureIso(hours = 48) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  it('creates from SENT manual and opportunity outreach and rejects ineligible sources', async () => {
    const salon = await registerOwner('rc-src');
    const customerId = await createCustomer(salon.token, 'Src');
    const otherCustomer = await createCustomer(salon.token, 'Other');
    const otherSalon = await registerOwner('rc-src-b');

    const queued = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date(Date.now() - 60 * 60 * 1000),
      submittedAt: null,
      status: 'QUEUED',
    });
    await request(app.getHttpServer())
      .post(`/messages/${queued.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-queued-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(400);

    const failed = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date(Date.now() - 50 * 60 * 1000),
      submittedAt: null,
      status: 'FAILED',
    });
    await request(app.getHttpServer())
      .post(`/messages/${failed.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-failed-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(400);

    const otherTenant = await insertCustomerMessage({
      salonId: otherSalon.tenantId,
      userId: otherSalon.userId,
      customerId: await createCustomer(otherSalon.token, 'B'),
      requestedAt: new Date(Date.now() - 40 * 60 * 1000),
      submittedAt: new Date(Date.now() - 30 * 60 * 1000),
      status: 'SENT',
    });
    await request(app.getHttpServer())
      .post(`/messages/${otherTenant.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-xtenant-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(404);

    const wrongCustomer = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: otherCustomer,
      requestedAt: new Date(Date.now() - 40 * 60 * 1000),
      submittedAt: new Date(Date.now() - 30 * 60 * 1000),
      status: 'SENT',
    });
    const createdWrong = await request(app.getHttpServer())
      .post(`/messages/${wrongCustomer.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-othercust-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(201);
    expect(createdWrong.body.customerId).toBe(otherCustomer);

    const actionId = randomUUID();
    await prisma.client.opportunityAction.create({
      data: {
        id: actionId,
        salonId: salon.tenantId,
        customerId,
        opportunityType: 'CUSTOMER_RETURN',
        status: 'OPEN',
        createdBy: salon.userId,
        updatedAt: new Date(),
      },
    });
    const opportunity = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date(Date.now() - 40 * 60 * 1000),
      submittedAt: new Date(Date.now() - 20 * 60 * 1000),
      status: 'SENT',
      actionId,
      opportunityType: 'CUSTOMER_RETURN',
    });
    const manual = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date(Date.now() - 35 * 60 * 1000),
      submittedAt: new Date(Date.now() - 15 * 60 * 1000),
      status: 'SENT',
    });

    const expectedAt = futureIso(72);
    const createKey = `rc-manual-${randomUUID()}`;
    const created = await request(app.getHttpServer())
      .post(`/messages/${manual.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', createKey)
      .send({ expectedAt })
      .expect(201);
    expect(created.body).toMatchObject({
      customerId,
      sourceMessage: { requestId: manual.requestId, deliveryId: manual.deliveryId },
      expectedAt,
      actualVisitId: null,
    });

    const replay = await request(app.getHttpServer())
      .post(`/messages/${manual.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', createKey)
      .send({ expectedAt })
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post(`/messages/${manual.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', createKey)
      .send({ expectedAt: futureIso(80) })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/messages/${manual.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-second-${randomUUID()}`)
      .send({ expectedAt: futureIso(90) })
      .expect(409);

    const opportunityCreated = await request(app.getHttpServer())
      .post(`/messages/${opportunity.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-opp-${randomUUID()}`)
      .send({ expectedAt: futureIso(96) })
      .expect(201);
    expect(opportunityCreated.body.id).not.toBe(created.body.id);

    const message = await request(app.getHttpServer())
      .get(`/messages/${manual.requestId}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(message.body.returnCommitment).toMatchObject({
      id: created.body.id,
      expectedAt,
      actualVisitId: null,
    });

    const visitsBefore = await request(app.getHttpServer())
      .get(`/customers/${customerId}/visits`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(visitsBefore.body.items).toEqual([]);
  });

  it('rejects VIP outreach and past or pre-send expectedAt', async () => {
    const salon = await registerOwner('rc-vip');
    const customerId = await createCustomer(salon.token, 'Vip');
    const sent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-16T10:00:00.000Z'),
      submittedAt: new Date('2026-09-16T10:30:00.000Z'),
      status: 'SENT',
    });

    await request(app.getHttpServer())
      .post(`/messages/${sent.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-past-${randomUUID()}`)
      .send({ expectedAt: '2026-09-16T09:00:00.000Z' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/messages/${sent.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-before-send-${randomUUID()}`)
      .send({ expectedAt: '2026-09-16T10:30:00.000Z' })
      .expect(400);

    const adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email: `rc-admin-${randomUUID()}@example.test`,
        phone: syntheticMobile(),
        passwordHash: 'hash',
        name: 'Admin',
        updatedAt: new Date(),
      },
    });
    const listId = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: 'rc-vip-list',
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
    const vipMessageId = randomUUID();
    const vipNow = new Date();
    await prisma.client.messageRequest.create({
      data: {
        id: vipMessageId,
        salonId: salon.tenantId,
        vipRequestId,
        createdByUserId: salon.userId,
        messageText: 'سلام',
        requestedAt: vipNow,
        messageBusinessDate: new Date('2026-09-16T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'SENT',
        recipientDisplayName: 'VIP',
        recipientPhoneNumber: '09121112233',
        createdAt: vipNow,
        updatedAt: vipNow,
      },
    });
    await prisma.client.messageDelivery.create({
      data: {
        id: randomUUID(),
        salonId: salon.tenantId,
        messageRequestId: vipMessageId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: 'SENT',
        providerRequestId: randomUUID(),
        createdBy: salon.userId,
        createdAt: vipNow,
        updatedAt: vipNow,
        submittedAt: vipNow,
      },
    });
    await request(app.getHttpServer())
      .post(`/messages/${vipMessageId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-vip-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(400);
  });

  it('reschedules the same row with CAS, audit, and idempotent retry', async () => {
    const salon = await registerOwner('rc-edit');
    const customerId = await createCustomer(salon.token, 'Edit');
    const sent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date(Date.now() - 60 * 60 * 1000),
      submittedAt: new Date(Date.now() - 30 * 60 * 1000),
      status: 'SENT',
    });
    const created = await request(app.getHttpServer())
      .post(`/messages/${sent.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-edit-c-${randomUUID()}`)
      .send({ expectedAt: futureIso(24) })
      .expect(201);
    const nextExpectedAt = futureIso(36);
    const patchKey = `rc-edit-p-${randomUUID()}`;
    const patched = await request(app.getHttpServer())
      .patch(`/return-commitments/${created.body.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', patchKey)
      .send({ expectedAt: nextExpectedAt, updatedAt: created.body.updatedAt })
      .expect(200);
    expect(patched.body.id).toBe(created.body.id);
    expect(patched.body.expectedAt).toBe(nextExpectedAt);

    await request(app.getHttpServer())
      .patch(`/return-commitments/${created.body.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', patchKey)
      .send({ expectedAt: nextExpectedAt, updatedAt: created.body.updatedAt })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/return-commitments/${created.body.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-edit-stale-${randomUUID()}`)
      .send({ expectedAt: futureIso(48), updatedAt: created.body.updatedAt })
      .expect(409);

    const otherSalon = await registerOwner('rc-edit-b');
    await request(app.getHttpServer())
      .patch(`/return-commitments/${created.body.id}`)
      .set('Authorization', `Bearer ${otherSalon.token}`)
      .set('Idempotency-Key', `rc-edit-xt-${randomUUID()}`)
      .send({ expectedAt: futureIso(48), updatedAt: patched.body.updatedAt })
      .expect(404);

    await prisma.client.visit.create({
      data: {
        id: randomUUID(),
        salonId: salon.tenantId,
        customerId,
        visitedAt: new Date('2026-09-01T10:00:00.000Z'),
        updatedAt: new Date(),
      },
    });
    const visit = await prisma.client.visit.findFirst({
      where: { salonId: salon.tenantId, customerId },
    });
    await prisma.client.returnCommitment.update({
      where: { id: created.body.id },
      data: { actualVisitId: visit!.id },
    });
    await request(app.getHttpServer())
      .patch(`/return-commitments/${created.body.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-edit-linked-${randomUUID()}`)
      .send({ expectedAt: futureIso(60), updatedAt: patched.body.updatedAt })
      .expect(409);

    const audits = await prisma.client.auditLog.findMany({
      where: { resourceId: created.body.id, action: 'RETURN_COMMITMENT_UPDATED' },
    });
    expect(audits.some((row) => {
      const metadata = row.metadata as { previousExpectedAt?: string; expectedAt?: string };
      return metadata.previousExpectedAt === created.body.expectedAt && metadata.expectedAt === nextExpectedAt;
    })).toBe(true);
  });

  it('lists customer and upcoming commitments without mixing visits or leaking tenants', async () => {
    const salon = await registerOwner('rc-list');
    const other = await registerOwner('rc-list-b');
    const customerId = await createCustomer(salon.token, 'List');
    const otherCustomer = await createCustomer(other.token, 'Secret');
    const a = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date(Date.now() - 80 * 60 * 1000),
      submittedAt: new Date(Date.now() - 70 * 60 * 1000),
      status: 'SENT',
    });
    const b = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date(Date.now() - 60 * 60 * 1000),
      submittedAt: new Date(Date.now() - 50 * 60 * 1000),
      status: 'SENT',
    });
    const otherMsg = await insertCustomerMessage({
      salonId: other.tenantId,
      userId: other.userId,
      customerId: otherCustomer,
      requestedAt: new Date(Date.now() - 40 * 60 * 1000),
      submittedAt: new Date(Date.now() - 30 * 60 * 1000),
      status: 'SENT',
    });
    const first = futureIso(10);
    const second = futureIso(20);
    await request(app.getHttpServer())
      .post(`/messages/${a.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-list-a-${randomUUID()}`)
      .send({ expectedAt: first })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/messages/${b.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-list-b-${randomUUID()}`)
      .send({ expectedAt: second })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/messages/${otherMsg.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${other.token}`)
      .set('Idempotency-Key', `rc-list-o-${randomUUID()}`)
      .send({ expectedAt: futureIso(12) })
      .expect(201);

    const customerPage = listPage<Commitment>(
      (
        await request(app.getHttpServer())
          .get(`/customers/${customerId}/return-commitments`)
          .set('Authorization', `Bearer ${salon.token}`)
          .expect(200)
      ).body,
    );
    expect(customerPage.items.map((item) => item.expectedAt)).toEqual([second, first]);
    await request(app.getHttpServer())
      .get(`/customers/${customerId}/return-commitments`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    const upcoming = await request(app.getHttpServer())
      .get('/return-commitments/upcoming')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(upcoming.body.items.map((item: { customerId: string }) => item.customerId)).toEqual([
      customerId,
      customerId,
    ]);
    expect(upcoming.body).toHaveProperty('from');
    expect(upcoming.body).toHaveProperty('to');
    expect(JSON.stringify(upcoming.body)).not.toMatch(/unavailable|occupancy|capacity|slot/i);

    await request(app.getHttpServer())
      .get('/return-commitments/upcoming')
      .query({ from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(400);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId, visitedAt: new Date().toISOString() })
      .expect(201);
    const visits = listPage(
      (
        await request(app.getHttpServer())
          .get(`/customers/${customerId}/visits`)
          .set('Authorization', `Bearer ${salon.token}`)
          .expect(200)
      ).body,
    );
    expect(visits.items).toHaveLength(1);
  });

  it('serializes concurrent creates from two actors to one row', async () => {
    const salon = await registerOwner('rc-race');
    const staff = staffRequest({
      name: 'Staff',
      role: 'STAFF',
      password,
      email: `staff-rc-${Date.now()}@example.test`,
    });
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salon.token}`)
      .send(staff)
      .expect(201);
    const staffToken = await login(staff.phone);
    const staffUser = await prisma.client.user.findFirstOrThrow({
      where: { salonId: salon.tenantId, phone: staff.phone },
      select: { id: true },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const customerId = await createCustomer(salon.token, `Race${attempt}`);
      const sent = await insertCustomerMessage({
        salonId: salon.tenantId,
        userId: salon.userId,
        customerId,
        requestedAt: new Date(Date.now() - 60 * 60 * 1000),
        submittedAt: new Date(Date.now() - 30 * 60 * 1000),
        status: 'SENT',
      });
      const ownerExpectedAt = futureIso(24 + attempt);
      const staffExpectedAt = futureIso(48 + attempt);
      const ownerKey = `rc-race-o-${attempt}-${randomUUID()}`;
      const staffKey = `rc-race-s-${attempt}-${randomUUID()}`;
      const [ownerResult, staffResult] = await Promise.all([
        request(app.getHttpServer())
          .post(`/messages/${sent.requestId}/return-commitments`)
          .set('Authorization', `Bearer ${salon.token}`)
          .set('Idempotency-Key', ownerKey)
          .send({ expectedAt: ownerExpectedAt }),
        request(app.getHttpServer())
          .post(`/messages/${sent.requestId}/return-commitments`)
          .set('Authorization', `Bearer ${staffToken}`)
          .set('Idempotency-Key', staffKey)
          .send({ expectedAt: staffExpectedAt }),
      ]);
      const winner = ownerResult.status === 201 ? ownerResult : staffResult;
      const loser = winner === ownerResult ? staffResult : ownerResult;
      const winnerUserId = winner === ownerResult ? salon.userId : staffUser.id;
      const winnerKey = winner === ownerResult ? ownerKey : staffKey;
      const loserKey = winner === ownerResult ? staffKey : ownerKey;
      const winnerExpectedAt = winner === ownerResult ? ownerExpectedAt : staffExpectedAt;
      expect(winner.status).toBe(201);
      expect(loser.status).toBe(409);
      expect(winner.body.createdByUserId).toBe(winnerUserId);
      expect(winner.body.sourceMessage).toEqual({
        requestId: sent.requestId,
        deliveryId: sent.deliveryId,
      });
      expect(winner.body.expectedAt).toBe(winnerExpectedAt);

      const rows = await prisma.client.returnCommitment.findMany({
        where: { salonId: salon.tenantId, sourceMessageRequestId: sent.requestId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: winner.body.id,
        createdByUserId: winnerUserId,
        sourceMessageDeliveryId: sent.deliveryId,
        expectedAt: new Date(winnerExpectedAt),
      });

      const successAudits = await prisma.client.auditLog.findMany({
        where: {
          tenantId: salon.tenantId,
          action: 'RETURN_COMMITMENT_CREATED',
          result: 'SUCCESS',
          resourceId: winner.body.id,
        },
      });
      expect(successAudits).toHaveLength(1);
      expect(successAudits[0]?.actorId).toBe(winnerUserId);
      expect(await prisma.client.auditLog.count({
        where: {
          tenantId: salon.tenantId,
          action: 'RETURN_COMMITMENT_CREATED',
          result: 'SUCCESS',
          metadata: { path: ['sourceMessageRequestId'], equals: sent.requestId },
          NOT: { resourceId: winner.body.id },
        },
      })).toBe(0);
      expect(await prisma.client.idempotencyRecord.count({
        where: { tenantId: salon.tenantId, key: loserKey },
      })).toBe(0);
      expect(await prisma.client.idempotencyRecord.count({
        where: { tenantId: salon.tenantId, key: winnerKey, actorId: winnerUserId },
      })).toBe(1);

      const replay = await request(app.getHttpServer())
        .post(`/messages/${sent.requestId}/return-commitments`)
        .set('Authorization', `Bearer ${winner === ownerResult ? salon.token : staffToken}`)
        .set('Idempotency-Key', winnerKey)
        .send({ expectedAt: winnerExpectedAt })
        .expect(201);
      expect(replay.body.id).toBe(winner.body.id);
      await request(app.getHttpServer())
        .post(`/messages/${sent.requestId}/return-commitments`)
        .set('Authorization', `Bearer ${winner === ownerResult ? salon.token : staffToken}`)
        .set('Idempotency-Key', winnerKey)
        .send({ expectedAt: futureIso(80 + attempt) })
        .expect(409);
      expect(await prisma.client.returnCommitment.count({
        where: { salonId: salon.tenantId, sourceMessageRequestId: sent.requestId },
      })).toBe(1);
    }
  }, 120_000);

  it('does not change Phase 4A observed-return association', async () => {
    const salon = await registerOwner('rc-obs');
    const customerId = await createCustomer(salon.token, 'Obs');
    const sent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      requestedAt: new Date('2026-09-05T10:00:00.000Z'),
      submittedAt: new Date('2026-09-05T10:00:00.000Z'),
      status: 'SENT',
    });
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId, visitedAt: '2026-09-08T10:00:00.000Z' })
      .expect(201);
    const before = await request(app.getHttpServer())
      .get(`/customers/${customerId}/observed-returns`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(before.body.items).toHaveLength(1);
    expect(before.body.items[0].observedReturn.visitId).toBe(visit.body.id);

    await request(app.getHttpServer())
      .post(`/messages/${sent.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `rc-obs-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(`/customers/${customerId}/observed-returns`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(after.body.items).toEqual(before.body.items);
  });
});

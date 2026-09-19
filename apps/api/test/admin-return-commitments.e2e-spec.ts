import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';
const adminPassword = 'platform-admin-pass';

describeIfDb('Admin return commitments and open agreed returns (e2e)', () => {
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
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const adminEmail = `platform-admin-rc-${Date.now()}@example.test`;
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
    return { id: response.body.id as string, phone: response.body.phoneNumber as string };
  }

  async function insertSentMessage(input: {
    salonId: string;
    userId: string;
    customerId: string | null;
    vipRequestId?: string;
    status?: 'QUEUED' | 'SENT';
    submittedAt?: Date | null;
  }) {
    const requestId = randomUUID();
    const requestedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const submittedAt = input.submittedAt === undefined ? new Date(Date.now() - 60 * 60 * 1000) : input.submittedAt;
    const status = input.status ?? 'SENT';
    await prisma.client.messageRequest.create({
      data: {
        id: requestId,
        salonId: input.salonId,
        customerId: input.customerId,
        vipRequestId: input.vipRequestId ?? null,
        createdByUserId: input.userId,
        messageText: 'سلام',
        requestedAt,
        messageBusinessDate: new Date('2026-01-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status,
        recipientDisplayName: input.customerId ? null : 'VIP',
        recipientPhoneNumber: input.customerId ? null : '09120000000',
        createdAt: requestedAt,
        updatedAt: requestedAt,
      },
    });
    if (status === 'QUEUED') {
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
        status,
        providerRequestId: randomUUID(),
        createdBy: input.userId,
        createdAt: requestedAt,
        updatedAt: submittedAt ?? requestedAt,
        submittedAt: status === 'SENT' ? submittedAt : null,
      },
    });
    return { requestId, deliveryId };
  }

  function futureIso(hours = 48) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  it('lets an admin record a canonical commitment from eligible SENT outreach', async () => {
    const salon = await registerOwner('adm-rc');
    const customer = await createCustomer(salon.token, 'AdminRc');
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
    });
    const expectedAt = futureIso();
    const key = `adm-create-${randomUUID()}`;

    const created = await request(app.getHttpServer())
      .post(`/admin/message-queue/${message.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({ expectedAt })
      .expect(201);

    expect(created.body.customerId).toBe(customer.id);
    expect(created.body.sourceMessage.requestId).toBe(message.requestId);
    expect(created.body.sourceMessage.deliveryId).toBe(message.deliveryId);
    expect(created.body.recordedBySupport).toBe(true);
    expect(created.body.createdByUserId).toBeNull();
    expect(created.body.createdByPlatformAdminId).toBeUndefined();

    const replay = await request(app.getHttpServer())
      .post(`/admin/message-queue/${message.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({ expectedAt })
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${message.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `adm-dup-${randomUUID()}`)
      .send({ expectedAt: futureIso(72) })
      .expect(409);

    const detail = await request(app.getHttpServer())
      .get(`/admin/message-queue/${message.requestId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.returnCommitment.id).toBe(created.body.id);

    const profile = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(profile.body.items[0].id).toBe(created.body.id);
    expect(profile.body.items[0].recordedBySupport).toBe(true);

    const otherSalon = await registerOwner('adm-rc-b');
    const isolated = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/return-commitments`)
      .set('Authorization', `Bearer ${otherSalon.token}`)
      .expect(404);
    expect(isolated.body.items).toBeUndefined();

    const open = await request(app.getHttpServer())
      .get('/return-commitments/open')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(open.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerId: customer.id,
          customerPhone: customer.phone,
          recordedBySupport: true,
        }),
      ]),
    );

    const otherOpen = await request(app.getHttpServer())
      .get('/return-commitments/open')
      .set('Authorization', `Bearer ${otherSalon.token}`)
      .expect(200);
    expect(otherOpen.body.items.some((row: { customerId: string }) => row.customerId === customer.id)).toBe(
      false,
    );

    const patched = await request(app.getHttpServer())
      .patch(`/admin/return-commitments/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `adm-patch-${randomUUID()}`)
      .send({ expectedAt: futureIso(96), updatedAt: created.body.updatedAt })
      .expect(200);
    expect(patched.body.recordedBySupport).toBe(true);
  });

  it('rejects salon users, unauthenticated callers, and ineligible sources', async () => {
    const salon = await registerOwner('adm-rej');
    const customer = await createCustomer(salon.token, 'Rej');
    const queued = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
      status: 'QUEUED',
      submittedAt: null,
    });
    await request(app.getHttpServer())
      .post(`/admin/message-queue/${queued.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `adm-q-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${queued.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `adm-salon-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/admin/message-queue/${queued.requestId}/return-commitments`)
      .set('Idempotency-Key', `adm-unauth-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(401);
  });

  it('keeps independent Visit creation unlinked and removes the customer from the operational open list', async () => {
    const salon = await registerOwner('adm-visit');
    const customer = await createCustomer(salon.token, 'VisitPath');
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
    });
    const created = await request(app.getHttpServer())
      .post(`/admin/message-queue/${message.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `adm-vis-${randomUUID()}`)
      .send({ expectedAt: futureIso() })
      .expect(201);

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `visit-${randomUUID()}`)
      .send({ customerId: customer.id, visitedAt: new Date().toISOString() })
      .expect(201);

    const afterVisit = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(afterVisit.body.items[0].id).toBe(created.body.id);
    expect(afterVisit.body.items[0].actualVisitId).toBeNull();
    expect(afterVisit.body.items[0].commitmentBackedReturn).toBeNull();
    expect(afterVisit.body.items[0].operationallyOpen).toBe(false);

    const open = await request(app.getHttpServer())
      .get('/return-commitments/open')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(open.body.items.some((row: { customerId: string }) => row.customerId === customer.id)).toBe(false);

    const observed = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/observed-returns`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(observed.body.items.length).toBeGreaterThan(0);

    const blocked = await request(app.getHttpServer())
      .post(`/return-commitments/${created.body.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arrive-${randomUUID()}`)
      .send({ visitedAt: new Date().toISOString() });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED');

    const stillUnlinked = await prisma.client.returnCommitment.findFirstOrThrow({
      where: { id: created.body.id, salonId: salon.tenantId },
    });
    expect(stillUnlinked.actualVisitId).toBeNull();
    expect(
      await prisma.client.visit.count({ where: { salonId: salon.tenantId, customerId: customer.id } }),
    ).toBe(1);

    const closed = await request(app.getHttpServer())
      .get('/return-commitments/open')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(closed.body.items.some((row: { customerId: string }) => row.customerId === customer.id)).toBe(
      false,
    );
  });

  it('deduplicates open rows per customer and includes overdue commitments', async () => {
    const salon = await registerOwner('adm-open');
    const customer = await createCustomer(salon.token, 'OpenDup');
    const first = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
    });
    const second = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer.id,
    });
    const earlier = futureIso(24);
    const later = futureIso(72);
    await request(app.getHttpServer())
      .post(`/messages/${first.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `open-a-${randomUUID()}`)
      .send({ expectedAt: later })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/messages/${second.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `open-b-${randomUUID()}`)
      .send({ expectedAt: earlier })
      .expect(201);

    const open = await request(app.getHttpServer())
      .get('/return-commitments/open')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    const rows = open.body.items.filter((row: { customerId: string }) => row.customerId === customer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].expectedAt).toBe(earlier);

    const overdueCustomer = await createCustomer(salon.token, 'Overdue');
    const overdueMessage = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: overdueCustomer.id,
    });
    await prisma.client.returnCommitment.create({
      data: {
        id: randomUUID(),
        salonId: salon.tenantId,
        customerId: overdueCustomer.id,
        sourceMessageRequestId: overdueMessage.requestId,
        sourceMessageDeliveryId: overdueMessage.deliveryId!,
        expectedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        createdByUserId: salon.userId,
        updatedByUserId: salon.userId,
        updatedAt: new Date(),
      },
    });
    const overdueList = await request(app.getHttpServer())
      .get('/return-commitments/open')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(overdueList.body.items.some((row: { overdue: boolean }) => row.overdue === true)).toBe(true);
  });
});

import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

type OverallPerformance = {
  customerCount: number;
  salonCustomerSentMessageCount: number;
  vipSentMessageCount: number;
  agreedReturnCount: number;
  messageAssociatedReturnedCustomerCount: number;
  returningSalonCustomerCount: number;
};

const zeros: OverallPerformance = {
  customerCount: 0,
  salonCustomerSentMessageCount: 0,
  vipSentMessageCount: 0,
  agreedReturnCount: 0,
  messageAssociatedReturnedCustomerCount: 0,
  returningSalonCustomerCount: 0,
};

describeIfDb('Salon overall performance (e2e)', () => {
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
      token: login.body.accessToken as string,
      userId: login.body.user.id as string,
      tenantId: login.body.user.tenantId as string,
    };
  }

  async function loginStaff(owner: { tenantId: string; token: string }) {
    const email = `staff-${randomUUID()}@example.test`;
    await prisma.client.user.create({
      data: {
        id: randomUUID(),
        salonId: owner.tenantId,
        name: 'Staff',
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'STAFF',
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return login.body.accessToken as string;
  }

  async function createCustomer(token: string) {
    const phone = `0912${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 9)}`.slice(0, 11);
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Sara', lastName: randomUUID().slice(0, 6), phoneNumber: phone })
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
        status:
          input.status === 'PROCESSING'
            ? 'DISPATCHED'
            : input.status === 'QUEUED'
              ? 'QUEUED'
              : input.status,
        vipRequestId: input.vipRequestId ?? null,
        recipientDisplayName: input.vipRequestId ? 'VIP' : null,
        recipientPhoneNumber: input.customerId
          ? (await prisma.client.customer.findUniqueOrThrow({ where: { id: input.customerId } })).phoneNumber
          : input.recipientPhoneNumber ?? '09120000000',
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
    userId?: string;
    adminId?: string;
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
        createdByUserId: input.userId ?? null,
        createdByPlatformAdminId: input.adminId ?? null,
        updatedByUserId: input.userId ?? null,
        updatedByPlatformAdminId: input.adminId ?? null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    });
    return id;
  }

  async function insertVipRequest(salonId: string, userId: string) {
    const adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email: `op-admin-${randomUUID()}@example.test`,
        passwordHash: 'hash',
        name: 'Admin',
        updatedAt: new Date(),
      },
    });
    const listId = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: `op-vip-${randomUUID().slice(0, 8)}`,
        status: 'IN_USE',
        contactCount: 30,
        createdByAdminId: adminId,
        reservedBySalonId: salonId,
        reservedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const vipRequestId = randomUUID();
    await prisma.client.vipRequest.create({
      data: {
        id: vipRequestId,
        salonId,
        listId,
        createdByUserId: userId,
        requestedCount: 30,
        geographicRange: 'ونک',
        status: 'SUBMITTED',
        reservedUntil: new Date(),
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return { adminId, vipRequestId };
  }

  function performance(token: string) {
    return request(app.getHttpServer())
      .get('/salon/overall-performance')
      .set('Authorization', `Bearer ${token}`);
  }

  it('returns six zeros for an empty salon and allows STAFF', async () => {
    const salon = await registerOwner('op-zero');
    const staffToken = await loginStaff(salon);
    await request(app.getHttpServer()).get('/salon/overall-performance').expect(401);
    const ownerBody = (await performance(salon.token).expect(200)).body as OverallPerformance;
    const staffBody = (await performance(staffToken).expect(200)).body as OverallPerformance;
    expect(ownerBody).toEqual(zeros);
    expect(staffBody).toEqual(zeros);
  });

  it('counts tenant-scoped facts with canonical SENT, VIP, commitment, and return evidence', async () => {
    const salon = await registerOwner('op-a');
    const other = await registerOwner('op-b');
    const a = salon.token;
    const customerA = await createCustomer(a);
    const customerB = await createCustomer(a);
    const customerC = await createCustomer(a);
    const otherCustomer = await createCustomer(other.token);

    const sent1 = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customerA,
      requestedAt: new Date('2026-01-01T10:00:00.000Z'),
      submittedAt: new Date('2026-01-01T11:00:00.000Z'),
      status: 'SENT',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customerA,
      requestedAt: new Date('2026-01-02T10:00:00.000Z'),
      submittedAt: new Date('2026-01-02T11:00:00.000Z'),
      status: 'SENT',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customerA,
      requestedAt: new Date('2026-01-03T10:00:00.000Z'),
      submittedAt: null,
      status: 'FAILED',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customerA,
      requestedAt: new Date('2026-01-04T10:00:00.000Z'),
      submittedAt: null,
      status: 'PROCESSING',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customerA,
      requestedAt: new Date('2026-01-05T10:00:00.000Z'),
      submittedAt: null,
      status: 'QUEUED',
    });

    const { adminId, vipRequestId } = await insertVipRequest(salon.tenantId, salon.userId);
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: null,
      requestedAt: new Date('2026-02-01T10:00:00.000Z'),
      submittedAt: new Date('2026-02-01T11:00:00.000Z'),
      status: 'SENT',
      vipRequestId,
      recipientPhoneNumber: '09121112233',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: null,
      requestedAt: new Date('2026-02-02T10:00:00.000Z'),
      submittedAt: null,
      status: 'FAILED',
      vipRequestId,
      recipientPhoneNumber: '09121112234',
    });

    await insertCustomerMessage({
      salonId: other.tenantId,
      userId: other.userId,
      customerId: otherCustomer,
      requestedAt: new Date('2026-01-01T10:00:00.000Z'),
      submittedAt: new Date('2026-01-01T11:00:00.000Z'),
      status: 'SENT',
    });

    const openSent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customerB,
      requestedAt: new Date('2026-03-01T10:00:00.000Z'),
      submittedAt: new Date('2026-03-01T11:00:00.000Z'),
      status: 'SENT',
    });
    await insertCommitment({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customerB,
      requestId: openSent.requestId,
      deliveryId: openSent.deliveryId!,
      createdAt: new Date('2026-03-01T12:00:00.000Z'),
      expectedAt: new Date('2026-03-10T10:00:00.000Z'),
    });

    const adminSent = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customerC,
      requestedAt: new Date('2026-03-02T10:00:00.000Z'),
      submittedAt: new Date('2026-03-02T11:00:00.000Z'),
      status: 'SENT',
    });
    const laterVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${a}`)
      .send({ customerId: customerC, visitedAt: '2026-03-03T10:00:00.000Z' })
      .expect(201);
    await insertCommitment({
      salonId: salon.tenantId,
      adminId,
      customerId: customerC,
      requestId: adminSent.requestId,
      deliveryId: adminSent.deliveryId!,
      createdAt: new Date('2026-03-02T12:00:00.000Z'),
      expectedAt: new Date('2026-03-04T10:00:00.000Z'),
      visitId: laterVisit.body.id as string,
    });

    const firstVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${a}`)
      .send({ customerId: customerA, visitedAt: '2026-01-10T10:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${a}`)
      .send({ customerId: customerA, visitedAt: '2026-01-20T10:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${a}`)
      .send({ customerId: customerA, visitedAt: '2026-01-30T10:00:00.000Z' })
      .expect(201);

    await insertCommitment({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customerA,
      requestId: sent1.requestId,
      deliveryId: sent1.deliveryId!,
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
      expectedAt: new Date('2026-01-15T10:00:00.000Z'),
      visitId: firstVisit.body.id as string,
    });

    const otherVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ customerId: otherCustomer, visitedAt: '2026-01-10T10:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ customerId: otherCustomer, visitedAt: '2026-01-20T10:00:00.000Z' })
      .expect(201);

    const body = (await performance(a).expect(200)).body as OverallPerformance;
    expect(body.customerCount).toBe(3);
    expect(body.salonCustomerSentMessageCount).toBe(4);
    expect(body.vipSentMessageCount).toBe(1);
    expect(body.agreedReturnCount).toBe(3);
    expect(body.messageAssociatedReturnedCustomerCount).toBe(2);
    expect(body.returningSalonCustomerCount).toBe(1);

    const isolated = (await performance(other.token).expect(200)).body as OverallPerformance;
    expect(isolated.customerCount).toBe(1);
    expect(isolated.salonCustomerSentMessageCount).toBe(1);
    expect(isolated.vipSentMessageCount).toBe(0);
    expect(isolated.agreedReturnCount).toBe(0);
    expect(isolated.messageAssociatedReturnedCustomerCount).toBe(1);
    expect(isolated.returningSalonCustomerCount).toBe(1);
    expect(isolated).not.toMatchObject(body);
    expect(otherVisit.body.id).toBeTruthy();
  });
});

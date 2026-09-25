import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';
const adminPassword = 'platform-admin-pass';

describeIfDb('ReturnCommitment /arrive duplicate-Visit hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let adminToken: string;

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
    jwt = app.get(JwtService);

    const adminEmail = `platform-admin-arrive-hard-${Date.now()}@example.test`;
    await prisma.client.platformAdmin.create({
      data: {
        id: randomUUID(),
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
    const accessToken = await jwt.signAsync({
      sub: userId,
      tid: salonId,
      role: 'OWNER',
    });
    return { token: accessToken, userId, tenantId: salonId };
  }

  async function createCustomer(token: string, lastName: string, phone?: string) {
    const phoneNumber =
      phone ?? `0912${Math.floor(1000000 + Math.random() * 9000000).toString()}`;
    const response = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Sara', lastName, phoneNumber })
      .expect(201);
    return response.body.id as string;
  }

  async function insertSentMessage(input: {
    salonId: string;
    userId: string;
    customerId: string;
    submittedAt: Date;
  }) {
    const requestId = randomUUID();
    const requestedAt = new Date(input.submittedAt.getTime() - 60 * 60 * 1000);
    await prisma.client.messageRequest.create({
      data: {
        id: requestId,
        salonId: input.salonId,
        customerId: input.customerId,
        createdByUserId: input.userId,
        messageText: 'سلام',
        recipientPhoneNumber: (await prisma.client.customer.findUniqueOrThrow({ where: { id: input.customerId } })).phoneNumber,
        requestedAt,
        messageBusinessDate: new Date('2026-01-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'SENT',
        createdAt: requestedAt,
        updatedAt: requestedAt,
      },
    });
    const deliveryId = randomUUID();
    await prisma.client.messageDelivery.create({
      data: {
        id: deliveryId,
        salonId: input.salonId,
        messageRequestId: requestId,
        customerId: input.customerId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: 'SENT',
        providerRequestId: randomUUID(),
        createdBy: input.userId,
        createdAt: requestedAt,
        updatedAt: input.submittedAt,
        submittedAt: input.submittedAt,
      },
    });
    return { requestId, deliveryId };
  }

  async function createCommitment(token: string, requestId: string) {
    const created = await request(app.getHttpServer())
      .post(`/messages/${requestId}/return-commitments`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `rc-${randomUUID()}`)
      .send({ expectedAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() })
      .expect(201);
    return created.body as {
      id: string;
      actualVisitId: string | null;
      operationallyOpen: boolean;
      commitmentBackedReturn: { associationKind: string } | null;
    };
  }

  function postVisit(token: string, customerId: string, visitedAt: Date) {
    return request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `visit-${randomUUID()}`)
      .send({ customerId, visitedAt: visitedAt.toISOString() });
  }

  function arrive(token: string, commitmentId: string, body: Record<string, unknown>, key?: string) {
    return request(app.getHttpServer())
      .post(`/return-commitments/${commitmentId}/arrive`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key ?? `arrive-${randomUUID()}`)
      .send(body);
  }

  async function visitCount(salonId: string, customerId: string) {
    return prisma.client.visit.count({ where: { salonId, customerId } });
  }

  it('TEST A normal arrive creates one Visit, links actualVisitId, and replays', async () => {
    const salon = await registerOwner('hard-a');
    const customerId = await createCustomer(salon.token, 'A');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    const key = `arrive-a-${randomUUID()}`;
    const body = { visitedAt: new Date().toISOString() };
    const first = await arrive(salon.token, commitment.id, body, key);
    expect(first.status).toBe(201);
    expect(first.body.actualVisitId).toBeTruthy();
    expect(first.body.commitmentBackedReturn.associationKind).toBe('COMMITMENT_BACKED');
    expect(await visitCount(salon.tenantId, customerId)).toBe(1);

    const replay = await arrive(salon.token, commitment.id, body, key);
    expect(replay.status).toBe(201);
    expect(replay.body.actualVisitId).toBe(first.body.actualVisitId);
    expect(await visitCount(salon.tenantId, customerId)).toBe(1);
  });

  it('TEST B independent later Visit blocks /arrive without attribution', async () => {
    const salon = await registerOwner('hard-b');
    const customerId = await createCustomer(salon.token, 'B');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    await postVisit(salon.token, customerId, new Date(submittedAt.getTime() + 60 * 1000)).expect(201);

    const blocked = await arrive(salon.token, commitment.id, { visitedAt: new Date().toISOString() });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED');
    expect(blocked.body.message).not.toMatch(/fulfill|COMMITMENT_BACKED|sql/i);

    const row = await prisma.client.returnCommitment.findFirstOrThrow({
      where: { id: commitment.id, salonId: salon.tenantId },
    });
    expect(row.actualVisitId).toBeNull();
    expect(await visitCount(salon.tenantId, customerId)).toBe(1);

    const listed = await request(app.getHttpServer())
      .get(`/customers/${customerId}/return-commitments`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(listed.body.items[0].actualVisitId).toBeNull();
    expect(listed.body.items[0].commitmentBackedReturn).toBeNull();
    expect(listed.body.items[0].operationallyOpen).toBe(false);
  });

  it('TEST C sale arrive is atomic: no Visit, ledger, items, or business events', async () => {
    const salon = await registerOwner('hard-c');
    const customerId = await createCustomer(salon.token, 'C');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    await postVisit(salon.token, customerId, new Date()).expect(201);
    const service = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: `Cut-${randomUUID().slice(0, 8)}` })
      .expect(201);

    const visitsBefore = await visitCount(salon.tenantId, customerId);
    const txBefore = await prisma.client.ledgerTransaction.count({
      where: { salonId: salon.tenantId, customerId },
    });
    const itemsBefore = await prisma.client.transactionItem.count({
      where: { salonId: salon.tenantId },
    });
    const outboxBefore = await prisma.client.outboxEvent.count({
      where: {
        tenantId: salon.tenantId,
        eventType: { in: ['VisitCompleted', 'TransactionCreated'] },
      },
    });
    const linkAuditBefore = await prisma.client.auditLog.count({
      where: { tenantId: salon.tenantId, action: 'RETURN_COMMITMENT_LINKED_TO_VISIT' },
    });

    const blocked = await arrive(salon.token, commitment.id, {
      visitedAt: new Date().toISOString(),
      sale: { serviceId: service.body.id, amount: '150000.00', currency: 'IRR' },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED');
    expect(await visitCount(salon.tenantId, customerId)).toBe(visitsBefore);
    expect(
      await prisma.client.ledgerTransaction.count({
        where: { salonId: salon.tenantId, customerId },
      }),
    ).toBe(txBefore);
    expect(await prisma.client.transactionItem.count({ where: { salonId: salon.tenantId } })).toBe(
      itemsBefore,
    );
    expect(
      await prisma.client.outboxEvent.count({
        where: {
          tenantId: salon.tenantId,
          eventType: { in: ['VisitCompleted', 'TransactionCreated'] },
        },
      }),
    ).toBe(outboxBefore);
    expect(
      await prisma.client.auditLog.count({
        where: { tenantId: salon.tenantId, action: 'RETURN_COMMITMENT_LINKED_TO_VISIT' },
      }),
    ).toBe(linkAuditBefore);
  });

  it('TEST D visit before SENT does not block arrive', async () => {
    const salon = await registerOwner('hard-d');
    const customerId = await createCustomer(salon.token, 'D');
    const visitAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
    await postVisit(salon.token, customerId, visitAt).expect(201);
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    const arrived = await arrive(salon.token, commitment.id, { visitedAt: new Date().toISOString() });
    expect(arrived.status).toBe(201);
    expect(arrived.body.actualVisitId).toBeTruthy();
    expect(await visitCount(salon.tenantId, customerId)).toBe(2);
  });

  it('TEST E visitedAt equal to submittedAt does not block arrive', async () => {
    const salon = await registerOwner('hard-e');
    const customerId = await createCustomer(salon.token, 'E');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await postVisit(salon.token, customerId, submittedAt).expect(201);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    const arrived = await arrive(salon.token, commitment.id, { visitedAt: new Date().toISOString() });
    expect(arrived.status).toBe(201);
    expect(arrived.body.actualVisitId).toBeTruthy();
    expect(await visitCount(salon.tenantId, customerId)).toBe(2);
  });

  it('TEST F multiple later Visits still 409 with no third Visit', async () => {
    const salon = await registerOwner('hard-f');
    const customerId = await createCustomer(salon.token, 'F');
    const submittedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    await postVisit(salon.token, customerId, new Date(submittedAt.getTime() + 60 * 1000)).expect(201);
    await postVisit(salon.token, customerId, new Date(submittedAt.getTime() + 120 * 1000)).expect(201);
    const blocked = await arrive(salon.token, commitment.id, { visitedAt: new Date().toISOString() });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED');
    expect(blocked.body.actualVisitId).toBeUndefined();
    expect(await visitCount(salon.tenantId, customerId)).toBe(2);
  });

  it('TEST G explicit link-visit then arrive is already-linked, not a new Visit', async () => {
    const salon = await registerOwner('hard-g');
    const customerId = await createCustomer(salon.token, 'G');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    const visit = await postVisit(salon.token, customerId, new Date()).expect(201);
    const linked = await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `link-${randomUUID()}`)
      .send({ visitId: visit.body.id })
      .expect(201);
    expect(linked.body.actualVisitId).toBe(visit.body.id);
    expect(linked.body.commitmentBackedReturn.associationKind).toBe('COMMITMENT_BACKED');

    const afterLink = await arrive(salon.token, commitment.id, { visitedAt: new Date().toISOString() });
    expect(afterLink.status).toBe(409);
    expect(afterLink.body.error).toBe('CONFLICT');
    expect(afterLink.body.message).toBe('Return commitment is already linked to an actual visit');
    expect(await visitCount(salon.tenantId, customerId)).toBe(1);
  });

  it('TEST H admin-created commitment is protected the same way', async () => {
    const salon = await registerOwner('hard-h');
    const customerId = await createCustomer(salon.token, 'H');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const created = await request(app.getHttpServer())
      .post(`/admin/message-queue/${message.requestId}/return-commitments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `adm-${randomUUID()}`)
      .send({ expectedAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() })
      .expect(201);
    await postVisit(salon.token, customerId, new Date()).expect(201);
    const blocked = await arrive(salon.token, created.body.id, { visitedAt: new Date().toISOString() });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED');
    const row = await prisma.client.returnCommitment.findFirstOrThrow({
      where: { id: created.body.id },
    });
    expect(row.actualVisitId).toBeNull();
    expect(await visitCount(salon.tenantId, customerId)).toBe(1);
  });

  it('TEST I tenant isolation: salon B visit does not block salon A arrive', async () => {
    const salonA = await registerOwner('hard-ia');
    const salonB = await registerOwner('hard-ib');
    const phone = `0912${Math.floor(1000000 + Math.random() * 9000000).toString()}`;
    const customerA = await createCustomer(salonA.token, 'IA', phone);
    const customerB = await createCustomer(salonB.token, 'IB', phone);
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const messageA = await insertSentMessage({
      salonId: salonA.tenantId,
      userId: salonA.userId,
      customerId: customerA,
      submittedAt,
    });
    const messageB = await insertSentMessage({
      salonId: salonB.tenantId,
      userId: salonB.userId,
      customerId: customerB,
      submittedAt,
    });
    const commitmentA = await createCommitment(salonA.token, messageA.requestId);
    await createCommitment(salonB.token, messageB.requestId);
    await postVisit(salonB.token, customerB, new Date()).expect(201);

    const arrived = await arrive(salonA.token, commitmentA.id, { visitedAt: new Date().toISOString() });
    expect(arrived.status).toBe(201);
    expect(arrived.body.actualVisitId).toBeTruthy();
  });

  it('TEST J stale client: independent Visit after load still 409 on /arrive', async () => {
    const salon = await registerOwner('hard-j');
    const customerId = await createCustomer(salon.token, 'J');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    expect(commitment.operationallyOpen).toBe(true);
    await postVisit(salon.token, customerId, new Date()).expect(201);
    const blocked = await arrive(salon.token, commitment.id, { visitedAt: new Date().toISOString() });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED');
  });

  it('TEST O platform admin cannot call salon /arrive', async () => {
    const salon = await registerOwner('hard-o');
    const customerId = await createCustomer(salon.token, 'O');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    const denied = await arrive(adminToken, commitment.id, { visitedAt: new Date().toISOString() });
    expect(denied.status).toBe(403);
    expect(await visitCount(salon.tenantId, customerId)).toBe(0);
  });

  it('CONCURRENCY: parallel POST /visits and /arrive', async () => {
    const salon = await registerOwner('hard-conc');
    const customerId = await createCustomer(salon.token, 'Conc');
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const message = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt,
    });
    const commitment = await createCommitment(salon.token, message.requestId);
    const visitedAt = new Date().toISOString();

    const [visitRes, arriveRes] = await Promise.all([
      postVisit(salon.token, customerId, new Date()),
      arrive(salon.token, commitment.id, { visitedAt }),
    ]);

    expect(visitRes.status).toBe(201);
    expect([201, 409]).toContain(arriveRes.status);
    const count = await visitCount(salon.tenantId, customerId);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(2);

    const row = await prisma.client.returnCommitment.findFirstOrThrow({
      where: { id: commitment.id, salonId: salon.tenantId },
    });

    if (arriveRes.status === 409) {
      expect(arriveRes.body.error).toBe('RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED');
      expect(row.actualVisitId).toBeNull();
      expect(count).toBe(1);
    } else {
      expect(row.actualVisitId).toBeTruthy();
    }
  });
});

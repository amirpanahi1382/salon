import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import {
  classifyPreferredVisitEvidence,
  COMMITMENT_BACKED_ASSOCIATION_KIND,
  OBSERVED_ASSOCIATION_KIND,
} from '@salon/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { listPage } from './list-page';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

type Commitment = {
  id: string;
  customerId: string;
  expectedAt: string;
  actualVisitId: string | null;
  updatedAt: string;
  commitmentBackedReturn: {
    associationKind: string;
    actualVisit: { visitId: string; visitedAt: string };
    associatedRevenue: { recorded: boolean; currency: string; amount: string | null };
  } | null;
};

describeIfDb('Return commitment arrival (e2e)', () => {
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
      email,
      token: login.body.accessToken as string,
      userId: login.body.user.id as string,
      tenantId: login.body.user.tenantId as string,
    };
  }

  async function login(email: string) {
    return (
      await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201)
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

  async function insertSentMessage(input: {
    salonId: string;
    userId: string;
    customerId: string;
    submittedAt?: Date;
  }) {
    const requestId = randomUUID();
    const deliveryId = randomUUID();
    const submittedAt = input.submittedAt ?? new Date(Date.now() - 30 * 60 * 1000);
    const requestedAt = new Date(submittedAt.getTime() - 30 * 60 * 1000);
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
        updatedAt: submittedAt,
      },
    });
    await prisma.client.messageDelivery.create({
      data: {
        id: deliveryId,
        salonId: input.salonId,
        messageRequestId: requestId,
        customerId: input.customerId,
        mode: 'MANUAL',
        provider: null,
        channel: 'TEXT',
        status: 'SENT',
        providerRequestId: randomUUID(),
        createdBy: input.userId,
        createdAt: requestedAt,
        updatedAt: submittedAt,
        submittedAt,
      },
    });
    return { requestId, deliveryId };
  }

  async function openCommitment(token: string, requestId: string, expectedAt: string) {
    const created = await request(app.getHttpServer())
      .post(`/messages/${requestId}/return-commitments`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `rc-open-${randomUUID()}`)
      .send({ expectedAt })
      .expect(201);
    return created.body as Commitment;
  }

  function futureIso(hours = 48) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  async function createService(token: string, name: string) {
    const created = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return created.body.id as string;
  }

  it('creates an authoritative Visit at visitedAt and links COMMITMENT_BACKED evidence', async () => {
    const salon = await registerOwner('arr-main');
    const customerId = await createCustomer(salon.token, 'Main');
    const sent = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const expectedAt = futureIso(24);
    const commitment = await openCommitment(salon.token, sent.requestId, expectedAt);
    const visitedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const key = `arr-main-${randomUUID()}`;

    await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ visitedAt })
      .expect(400);

    const arrived = await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send({ visitedAt })
      .expect(201);

    expect(arrived.body.expectedAt).toBe(expectedAt);
    expect(arrived.body.actualVisitId).toBeTruthy();
    expect(arrived.body.commitmentBackedReturn.associationKind).toBe('COMMITMENT_BACKED');
    expect(arrived.body.commitmentBackedReturn.actualVisit.visitedAt).toBe(visitedAt);
    expect(arrived.body.commitmentBackedReturn.actualVisit.visitedAt).not.toBe(expectedAt);
    expect(arrived.body.commitmentBackedReturn.associatedRevenue).toEqual({
      recorded: false,
      currency: 'IRR',
      amount: null,
    });

    const replay = await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send({ visitedAt })
      .expect(201);
    expect(replay.body.actualVisitId).toBe(arrived.body.actualVisitId);

    await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', key)
      .send({ visitedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arr-second-${randomUUID()}`)
      .send({ visitedAt })
      .expect(409);

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const other = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const open = await openCommitment(salon.token, other.requestId, futureIso(30));
    await request(app.getHttpServer())
      .post(`/return-commitments/${open.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arr-future-${randomUUID()}`)
      .send({ visitedAt: future })
      .expect(400);

    const visits = await prisma.client.visit.count({
      where: { salonId: salon.tenantId, customerId },
    });
    expect(visits).toBe(1);
    const outbox = await prisma.client.outboxEvent.count({
      where: {
        tenantId: salon.tenantId,
        eventType: 'VisitCompleted',
      },
    });
    expect(outbox).toBe(1);
    const linkedAudit = await prisma.client.auditLog.findFirst({
      where: { resourceId: commitment.id, action: 'RETURN_COMMITMENT_LINKED_TO_VISIT' },
    });
    expect(linkedAudit).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/return-commitments/${commitment.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arr-edit-${randomUUID()}`)
      .send({ expectedAt: futureIso(60), updatedAt: arrived.body.updatedAt })
      .expect(409);
  });

  it('enforces sale RBAC and records Visit+sale atomically with exact decimals', async () => {
    const salon = await registerOwner('arr-sale');
    const customerId = await createCustomer(salon.token, 'Sale');
    const staffEmail = `staff-arr-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);
    const staffToken = await login(staffEmail);
    const managerEmail = `mgr-arr-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: 'Manager', email: managerEmail, password, role: 'MANAGER' })
      .expect(201);
    const managerToken = await login(managerEmail);
    const serviceId = await createService(salon.token, `Hair ${randomUUID().slice(0, 8)}`);
    const sent = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const staffCommitment = await openCommitment(salon.token, sent.requestId, futureIso(24));
    const visitedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    await request(app.getHttpServer())
      .post(`/return-commitments/${staffCommitment.id}/arrive`)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', `arr-staff-sale-${randomUUID()}`)
      .send({
        visitedAt,
        sale: { serviceId, amount: '8000000.00', currency: 'IRR' },
      })
      .expect(403);
    expect(
      await prisma.client.visit.count({ where: { salonId: salon.tenantId, customerId } }),
    ).toBe(0);

    const staffArrive = await request(app.getHttpServer())
      .post(`/return-commitments/${staffCommitment.id}/arrive`)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', `arr-staff-${randomUUID()}`)
      .send({ visitedAt })
      .expect(201);
    expect(staffArrive.body.commitmentBackedReturn.associatedRevenue.recorded).toBe(false);

    const laterOutreachAt = new Date();
    const mgrMsg = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt: laterOutreachAt,
    });
    const mgrCommitment = await openCommitment(salon.token, mgrMsg.requestId, futureIso(26));
    const mgrArrive = await request(app.getHttpServer())
      .post(`/return-commitments/${mgrCommitment.id}/arrive`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', `arr-mgr-${randomUUID()}`)
      .send({
        visitedAt: new Date().toISOString(),
        sale: { serviceId, amount: '1500000.50', currency: 'IRR' },
      })
      .expect(201);
    expect(mgrArrive.body.commitmentBackedReturn.associatedRevenue).toEqual({
      recorded: true,
      currency: 'IRR',
      amount: '1500000.50',
    });

    const ownerMsg = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
      submittedAt: new Date(),
    });
    const ownerCommitment = await openCommitment(salon.token, ownerMsg.requestId, futureIso(28));
    const inactive = await createService(salon.token, `Old ${randomUUID().slice(0, 8)}`);
    await request(app.getHttpServer())
      .patch(`/services/${inactive}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ status: 'INACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/return-commitments/${ownerCommitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arr-bad-sale-${randomUUID()}`)
      .send({
        visitedAt: new Date().toISOString(),
        sale: { serviceId: inactive, amount: '10.00' },
      })
      .expect(400);
    const afterFail = await prisma.client.returnCommitment.findFirst({
      where: { id: ownerCommitment.id },
    });
    expect(afterFail?.actualVisitId).toBeNull();

    const ownerArrive = await request(app.getHttpServer())
      .post(`/return-commitments/${ownerCommitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arr-owner-${randomUUID()}`)
      .send({
        visitedAt: new Date().toISOString(),
        sale: { serviceId, amount: '10.00' },
      })
      .expect(201);
    expect(ownerArrive.body.commitmentBackedReturn.associatedRevenue.amount).toBe('10.00');
  });

  it('links an existing Visit explicitly and never by timestamp', async () => {
    const salon = await registerOwner('arr-link');
    const customerId = await createCustomer(salon.token, 'Link');
    const otherCustomer = await createCustomer(salon.token, 'Other');
    const otherSalon = await registerOwner('arr-link-b');
    const sent = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const expectedAt = futureIso(12);
    const commitment = await openCommitment(salon.token, sent.requestId, expectedAt);
    const nearbyVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId, visitedAt: new Date(Date.now() - 60 * 1000).toISOString() })
      .expect(201);

    const listedBefore = listPage<Commitment>(
      (
        await request(app.getHttpServer())
          .get(`/customers/${customerId}/return-commitments`)
          .set('Authorization', `Bearer ${salon.token}`)
          .expect(200)
      ).body,
    );
    expect(listedBefore.items[0]?.actualVisitId).toBeNull();

    const otherCustomerVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: otherCustomer, visitedAt: new Date().toISOString() })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `link-wrong-c-${randomUUID()}`)
      .send({ visitId: otherCustomerVisit.body.id })
      .expect(409);

    const foreignVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${otherSalon.token}`)
      .send({
        customerId: await createCustomer(otherSalon.token, 'B'),
        visitedAt: new Date().toISOString(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `link-xt-${randomUUID()}`)
      .send({ visitId: foreignVisit.body.id })
      .expect(404);

    const linked = await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `link-ok-${randomUUID()}`)
      .send({ visitId: nearbyVisit.body.id })
      .expect(201);
    expect(linked.body.actualVisitId).toBe(nearbyVisit.body.id);
    expect(linked.body.commitmentBackedReturn.associationKind).toBe('COMMITMENT_BACKED');

    const secondMsg = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const second = await openCommitment(salon.token, secondMsg.requestId, futureIso(18));
    await request(app.getHttpServer())
      .post(`/return-commitments/${second.id}/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `link-dup-${randomUUID()}`)
      .send({ visitId: nearbyVisit.body.id })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/link-visit`)
      .set('Authorization', `Bearer ${otherSalon.token}`)
      .set('Idempotency-Key', `link-xcommit-${randomUUID()}`)
      .send({ visitId: nearbyVisit.body.id })
      .expect(404);
  });

  it('derives revenue, preserves Phase 4A OBSERVED, and does not double-count in the classifier', async () => {
    const salon = await registerOwner('arr-rev');
    const customerId = await createCustomer(salon.token, 'Rev');
    const serviceId = await createService(salon.token, `Cut ${randomUUID().slice(0, 8)}`);
    const sent = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const commitment = await openCommitment(salon.token, sent.requestId, futureIso(24));
    const visitedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const arrived = await request(app.getHttpServer())
      .post(`/return-commitments/${commitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arr-rev-${randomUUID()}`)
      .send({ visitedAt })
      .expect(201);
    const visitId = arrived.body.actualVisitId as string;

    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `tx-a-${randomUUID()}`)
      .send({
        customerId,
        visitId,
        occurredAt: visitedAt,
        amount: '10.25',
        items: [{ serviceId, quantity: 1, unitPrice: '10.25' }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `tx-b-${randomUUID()}`)
      .send({
        customerId,
        visitId,
        occurredAt: visitedAt,
        amount: '0.75',
        items: [{ serviceId, quantity: 1, unitPrice: '0.75' }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `tx-unlinked-${randomUUID()}`)
      .send({
        customerId,
        occurredAt: visitedAt,
        amount: '99.00',
        items: [{ serviceId, quantity: 1, unitPrice: '99.00' }],
      })
      .expect(201);

    const page = listPage<Commitment>(
      (
        await request(app.getHttpServer())
          .get(`/customers/${customerId}/return-commitments`)
          .set('Authorization', `Bearer ${salon.token}`)
          .expect(200)
      ).body,
    );
    expect(page.items[0]?.commitmentBackedReturn?.associatedRevenue).toEqual({
      recorded: true,
      currency: 'IRR',
      amount: '11.00',
    });

    const voided = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `tx-void-${randomUUID()}`)
      .send({
        customerId,
        visitId,
        occurredAt: visitedAt,
        amount: '5.00',
        items: [{ serviceId, quantity: 1, unitPrice: '5.00' }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/transactions/${voided.body.id}/void`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(201);
    const afterVoid = listPage<Commitment>(
      (
        await request(app.getHttpServer())
          .get(`/customers/${customerId}/return-commitments`)
          .set('Authorization', `Bearer ${salon.token}`)
          .expect(200)
      ).body,
    );
    expect(afterVoid.items[0]?.commitmentBackedReturn?.associatedRevenue.amount).toBe('11.00');

    const zeroMsg = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const zeroCommitment = await openCommitment(salon.token, zeroMsg.requestId, futureIso(40));
    const zeroVisit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId, visitedAt: new Date(Date.now() - 90 * 1000).toISOString() })
      .expect(201);
    await prisma.client.ledgerTransaction.create({
      data: {
        id: randomUUID(),
        salonId: salon.tenantId,
        customerId,
        visitId: zeroVisit.body.id,
        occurredAt: new Date(zeroVisit.body.visitedAt),
        amount: '0.00',
        currency: 'IRR',
        status: 'COMPLETED',
        updatedAt: new Date(),
      },
    });
    const zeroLinked = await request(app.getHttpServer())
      .post(`/return-commitments/${zeroCommitment.id}/link-visit`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `link-zero-${randomUUID()}`)
      .send({ visitId: zeroVisit.body.id })
      .expect(201);
    expect(zeroLinked.body.commitmentBackedReturn.associatedRevenue).toEqual({
      recorded: true,
      currency: 'IRR',
      amount: '0.00',
    });

    const observed = await request(app.getHttpServer())
      .get(`/customers/${customerId}/observed-returns`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(observed.body.items.some((row: { observedReturn: { visitId: string } }) => row.observedReturn.visitId === visitId)).toBe(
      true,
    );
    const classified = classifyPreferredVisitEvidence([
      ...observed.body.items.map((row: { observedReturn: { visitId: string } }) => ({
        visitId: row.observedReturn.visitId,
        kind: OBSERVED_ASSOCIATION_KIND,
      })),
      ...afterVoid.items
        .filter((row) => row.actualVisitId)
        .map((row) => ({
          visitId: row.actualVisitId as string,
          kind: COMMITMENT_BACKED_ASSOCIATION_KIND,
        })),
    ]);
    const visitKinds = classified.filter((row) => row.visitId === visitId);
    expect(visitKinds).toEqual([{ visitId, kind: COMMITMENT_BACKED_ASSOCIATION_KIND }]);
  });

  it('unlinks on Visit delete when there is no money and leaves linkage on financial 409', async () => {
    const salon = await registerOwner('arr-del');
    const customerId = await createCustomer(salon.token, 'Del');
    const serviceId = await createService(salon.token, `Del ${randomUUID().slice(0, 8)}`);
    const sent = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const open = await openCommitment(salon.token, sent.requestId, futureIso(24));
    const visitedAt = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    const arrived = await request(app.getHttpServer())
      .post(`/return-commitments/${open.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arr-del-${randomUUID()}`)
      .send({ visitedAt })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/visits/${arrived.body.actualVisitId}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(204);

    const afterUnlink = listPage<Commitment>(
      (
        await request(app.getHttpServer())
          .get(`/customers/${customerId}/return-commitments`)
          .set('Authorization', `Bearer ${salon.token}`)
          .expect(200)
      ).body,
    );
    expect(afterUnlink.items[0]?.actualVisitId).toBeNull();
    expect(afterUnlink.items[0]?.commitmentBackedReturn).toBeNull();
    const unlinkAudit = await prisma.client.auditLog.findFirst({
      where: { resourceId: open.id, action: 'RETURN_COMMITMENT_UNLINKED_FROM_VISIT' },
    });
    expect(unlinkAudit).toBeTruthy();
    const deletedOutbox = await prisma.client.outboxEvent.findFirst({
      where: {
        tenantId: salon.tenantId,
        eventType: 'VisitDeleted',
      },
    });
    expect(deletedOutbox).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/return-commitments/${open.id}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arr-del-edit-${randomUUID()}`)
      .send({ expectedAt: futureIso(50), updatedAt: afterUnlink.items[0]!.updatedAt })
      .expect(200);

    const moneyMsg = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const moneyCommitment = await openCommitment(salon.token, moneyMsg.requestId, futureIso(32));
    const moneyArrive = await request(app.getHttpServer())
      .post(`/return-commitments/${moneyCommitment.id}/arrive`)
      .set('Authorization', `Bearer ${salon.token}`)
      .set('Idempotency-Key', `arr-del-m-${randomUUID()}`)
      .send({
        visitedAt,
        sale: { serviceId, amount: '20.00' },
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/visits/${moneyArrive.body.actualVisitId}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(409);
    const stillLinked = await prisma.client.returnCommitment.findFirst({
      where: { id: moneyCommitment.id },
    });
    expect(stillLinked?.actualVisitId).toBe(moneyArrive.body.actualVisitId);

    await request(app.getHttpServer())
      .delete(`/customers/${customerId}`)
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(409);
  });

  it('serializes concurrent arrivals to one linked Visit', async () => {
    const salon = await registerOwner('arr-race');
    const customerId = await createCustomer(salon.token, 'Race');
    const staffEmail = `staff-arr-r-${Date.now()}@example.test`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ name: 'Staff', email: staffEmail, password, role: 'STAFF' })
      .expect(201);
    const staffToken = await login(staffEmail);
    const sent = await insertSentMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId,
    });
    const commitment = await openCommitment(salon.token, sent.requestId, futureIso(24));
    const visitedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const [ownerResult, staffResult] = await Promise.all([
      request(app.getHttpServer())
        .post(`/return-commitments/${commitment.id}/arrive`)
        .set('Authorization', `Bearer ${salon.token}`)
        .set('Idempotency-Key', `arr-race-o-${randomUUID()}`)
        .send({ visitedAt }),
      request(app.getHttpServer())
        .post(`/return-commitments/${commitment.id}/arrive`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('Idempotency-Key', `arr-race-s-${randomUUID()}`)
        .send({ visitedAt }),
    ]);
    const statuses = [ownerResult.status, staffResult.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.client.visit.count({ where: { salonId: salon.tenantId, customerId } })).toBe(1);
    const row = await prisma.client.returnCommitment.findFirst({ where: { id: commitment.id } });
    expect(row?.actualVisitId).toBeTruthy();
  });
});

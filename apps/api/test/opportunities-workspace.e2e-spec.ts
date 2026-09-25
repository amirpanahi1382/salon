import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import {
  comparableJalaliMonthWindows,
  tehranJalaliToUtc,
} from '@salon/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

type WorkspaceRow = {
  rowKind: string;
  stableId: string;
  customerId: string | null;
  displayName: string;
  messageState: string | null;
  messageRequestId: string | null;
  submittedAt: string | null;
  returnEvidenceKind: string | null;
  previousVisitAt: string | null;
};

describeIfDb('Opportunities V2 workspace (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

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
    return {
      token: accessToken,
      userId,
      tenantId: salonId,
    };
  }

  async function loginStaff(owner: { tenantId: string }) {
    const email = `staff-${randomUUID()}@example.test`;
    const userId = randomUUID();
    await prisma.client.user.create({
      data: {
        id: userId,
        salonId: owner.tenantId,
        name: 'Staff',
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'STAFF',
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    });
    return jwt.signAsync({
      sub: userId,
      tid: owner.tenantId,
      role: 'STAFF',
    });
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
    status: 'QUEUED' | 'SENT' | 'FAILED' | 'PROCESSING' | 'DISPATCHED';
    deliveryStatus?: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
    vipRequestId?: string | null;
    recipientPhoneNumber?: string | null;
    actionId?: string | null;
    opportunityType?: 'REACTIVATION' | 'CUSTOMER_RETURN' | 'REVENUE_DECLINE' | null;
  }) {
    const requestId = randomUUID();
    const now = input.submittedAt ?? input.requestedAt;
    const requestStatus =
      input.status === 'PROCESSING' || input.status === 'DISPATCHED'
        ? 'DISPATCHED'
        : input.status;
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
        status: requestStatus,
        vipRequestId: input.vipRequestId ?? null,
        recipientDisplayName: input.vipRequestId ? 'VIP Guest' : null,
        recipientPhoneNumber: input.customerId
          ? (await prisma.client.customer.findUniqueOrThrow({ where: { id: input.customerId } })).phoneNumber
          : input.recipientPhoneNumber ?? '09120000000',
        actionId: input.actionId ?? null,
        opportunityType: input.opportunityType ?? null,
        createdAt: input.requestedAt,
        updatedAt: now,
      },
    });
    if (input.status === 'QUEUED') {
      return { requestId, deliveryId: null as string | null };
    }
    const deliveryId = randomUUID();
    const deliveryStatus =
      input.deliveryStatus ??
      (input.status === 'DISPATCHED' ? 'PENDING' : input.status === 'PROCESSING' ? 'PROCESSING' : input.status);
    await prisma.client.messageDelivery.create({
      data: {
        id: deliveryId,
        salonId: input.salonId,
        messageRequestId: requestId,
        customerId: input.customerId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: deliveryStatus,
        providerRequestId: randomUUID(),
        createdBy: input.userId,
        createdAt: input.requestedAt,
        updatedAt: now,
        submittedAt: deliveryStatus === 'SENT' ? input.submittedAt : null,
        failedAt: deliveryStatus === 'FAILED' ? now : null,
      },
    });
    return { requestId, deliveryId };
  }

  async function insertCommitment(input: {
    salonId: string;
    userId?: string;
    customerId: string;
    requestId: string;
    deliveryId: string;
    createdAt: Date;
    expectedAt: Date;
    visitId?: string | null;
  }) {
    await prisma.client.returnCommitment.create({
      data: {
        id: randomUUID(),
        salonId: input.salonId,
        customerId: input.customerId,
        sourceMessageRequestId: input.requestId,
        sourceMessageDeliveryId: input.deliveryId,
        expectedAt: input.expectedAt,
        actualVisitId: input.visitId ?? null,
        createdByUserId: input.userId ?? null,
        createdByPlatformAdminId: null,
        updatedByUserId: input.userId ?? null,
        updatedByPlatformAdminId: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    });
  }

  async function insertVipRequest(salonId: string, userId: string) {
    const adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        email: `ws-admin-${randomUUID()}@example.test`,
        passwordHash: 'hash',
        name: 'Admin',
        updatedAt: new Date(),
      },
    });
    const listId = randomUUID();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: `ws-vip-${randomUUID().slice(0, 8)}`,
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
    return vipRequestId;
  }

  function workspace(token: string, filter: string, cursor?: string) {
    return request(app.getHttpServer())
      .get('/opportunities/workspace')
      .query({ filter, ...(cursor ? { cursor } : {}) })
      .set('Authorization', `Bearer ${token}`);
  }

  it('rejects unauthenticated access and missing filter', async () => {
    await request(app.getHttpServer()).get('/opportunities/workspace').expect(401);
    const salon = await registerOwner('ws-auth');
    await workspace(salon.token, 'NOT_A_FILTER').expect(400);
  });

  it('excludes customers without MessageRequest and isolates tenants', async () => {
    const salon = await registerOwner('ws-empty');
    const other = await registerOwner('ws-other');
    const staffToken = await loginStaff(salon);
    await createCustomer(salon.token);
    const otherCustomer = await createCustomer(other.token);
    await insertCustomerMessage({
      salonId: other.tenantId,
      userId: other.userId,
      customerId: otherCustomer,
      requestedAt: new Date('2026-01-01T10:00:00.000Z'),
      submittedAt: new Date('2026-01-01T11:00:00.000Z'),
      status: 'SENT',
    });

    const empty = (await workspace(staffToken, 'SALON_MESSAGES').expect(200)).body;
    expect(empty.items).toEqual([]);
    expect(empty.hasMore).toBe(false);
    const leaked = (await workspace(salon.token, 'ALL').expect(200)).body.items as WorkspaceRow[];
    expect(leaked).toEqual([]);
  });

  it('classifies ordinary, VIP, queued, sent, failed, commitment, and return evidence', async () => {
    const salon = await registerOwner('ws-states');
    const none = await createCustomer(salon.token);
    const queued = await createCustomer(salon.token);
    const pipeline = await createCustomer(salon.token);
    const sent = await createCustomer(salon.token);
    const failed = await createCustomer(salon.token);
    const agreed = await createCustomer(salon.token);
    const returned = await createCustomer(salon.token);
    const opportunity = await createCustomer(salon.token);
    void none;

    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: queued,
      requestedAt: new Date('2026-04-01T10:00:00.000Z'),
      submittedAt: null,
      status: 'QUEUED',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: pipeline,
      requestedAt: new Date('2026-04-02T10:00:00.000Z'),
      submittedAt: null,
      status: 'DISPATCHED',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: sent,
      requestedAt: new Date('2026-04-03T10:00:00.000Z'),
      submittedAt: new Date('2026-04-03T11:00:00.000Z'),
      status: 'SENT',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: failed,
      requestedAt: new Date('2026-04-05T10:00:00.000Z'),
      submittedAt: null,
      status: 'FAILED',
    });

    const agreedMsg = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: agreed,
      requestedAt: new Date('2026-04-06T10:00:00.000Z'),
      submittedAt: new Date('2026-04-06T11:00:00.000Z'),
      status: 'SENT',
    });
    await insertCommitment({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: agreed,
      requestId: agreedMsg.requestId,
      deliveryId: agreedMsg.deliveryId!,
      createdAt: new Date('2026-04-06T12:00:00.000Z'),
      expectedAt: new Date('2026-04-20T10:00:00.000Z'),
    });

    const returnedMsg = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: returned,
      requestedAt: new Date('2026-04-07T10:00:00.000Z'),
      submittedAt: new Date('2026-04-07T11:00:00.000Z'),
      status: 'SENT',
    });
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: returned, visitedAt: '2026-04-08T10:00:00.000Z' })
      .expect(201);

    const actionId = randomUUID();
    await prisma.client.opportunityAction.create({
      data: {
        id: actionId,
        salonId: salon.tenantId,
        customerId: opportunity,
        opportunityType: 'REACTIVATION',
        status: 'OPEN',
        createdBy: salon.userId,
        updatedAt: new Date(),
      },
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: opportunity,
      requestedAt: new Date('2026-04-09T10:00:00.000Z'),
      submittedAt: new Date('2026-04-09T11:00:00.000Z'),
      status: 'SENT',
      actionId,
      opportunityType: 'REACTIVATION',
    });

    const vipRequestId = await insertVipRequest(salon.tenantId, salon.userId);
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: null,
      requestedAt: new Date('2026-04-10T10:00:00.000Z'),
      submittedAt: new Date('2026-04-10T11:00:00.000Z'),
      status: 'SENT',
      vipRequestId,
      recipientPhoneNumber: '09120000001',
    });
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: null,
      requestedAt: new Date('2026-04-11T10:00:00.000Z'),
      submittedAt: null,
      status: 'FAILED',
      vipRequestId,
      recipientPhoneNumber: '09120000002',
    });

    const ordinary = (await workspace(salon.token, 'SALON_MESSAGES').expect(200)).body
      .items as WorkspaceRow[];
    const vip = (await workspace(salon.token, 'VIP').expect(200)).body.items as WorkspaceRow[];
    const all = (await workspace(salon.token, 'ALL').expect(200)).body.items as WorkspaceRow[];

    expect(ordinary.every((row) => row.rowKind === 'SALON_CUSTOMER')).toBe(true);
    expect(ordinary.some((row) => row.customerId === queued)).toBe(true);
    expect(ordinary.some((row) => row.customerId === opportunity)).toBe(true);
    expect(ordinary.some((row) => row.customerId === none)).toBe(false);
    expect(ordinary.some((row) => row.rowKind === 'VIP_RECIPIENT')).toBe(false);

    const byCustomer = new Map(ordinary.map((row) => [row.customerId, row]));
    expect(byCustomer.get(queued)?.messageState).toBe('QUEUED');
    expect(byCustomer.get(pipeline)?.messageState).toBe('IN_PIPELINE');
    expect(byCustomer.get(sent)?.messageState).toBe('SENT');
    expect(byCustomer.get(failed)?.messageState).toBe('FAILED');
    expect(byCustomer.get(agreed)?.messageState).toBe('SENT_WITH_RETURN_COMMITMENT');
    expect(byCustomer.get(returned)?.messageState).toBe('SENT_WITH_RETURN_EVIDENCE');
    expect(byCustomer.get(returned)?.returnEvidenceKind).toBe('OBSERVED');
    expect(returnedMsg.requestId).toBe(byCustomer.get(returned)?.messageRequestId);

    expect(vip).toHaveLength(2);
    expect(vip.every((row) => row.rowKind === 'VIP_RECIPIENT' && row.customerId == null)).toBe(true);
    expect(vip.some((row) => row.messageState === 'SENT')).toBe(true);
    expect(vip.some((row) => row.messageState === 'FAILED')).toBe(true);
    expect(new Set(vip.map((row) => row.stableId)).size).toBe(2);

    expect(all).toHaveLength(ordinary.length + vip.length);
    expect(all.some((row) => row.rowKind === 'SALON_CUSTOMER')).toBe(true);
    expect(all.some((row) => row.rowKind === 'VIP_RECIPIENT')).toBe(true);

    const independentOrdinary = await prisma.client.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT customer_id)::bigint AS n
      FROM message_requests
      WHERE salon_id = ${salon.tenantId}::uuid
        AND customer_id IS NOT NULL
        AND vip_request_id IS NULL
    `;
    expect(ordinary).toHaveLength(Number(independentOrdinary[0]?.n ?? 0));
    const independentVip = await prisma.client.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
      FROM message_requests
      WHERE salon_id = ${salon.tenantId}::uuid
        AND vip_request_id IS NOT NULL
    `;
    expect(vip).toHaveLength(Number(independentVip[0]?.n ?? 0));

    const salonMessagesPlan = await prisma.client.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT DISTINCT ON (r.customer_id) r.id
      FROM message_requests r
      WHERE r.salon_id = ${salon.tenantId}::uuid
        AND r.customer_id IS NOT NULL
        AND r.vip_request_id IS NULL
      ORDER BY r.customer_id, r.requested_at DESC, r.id DESC
    `;
    const vipPlan = await prisma.client.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT r.id
      FROM message_requests r
      WHERE r.salon_id = ${salon.tenantId}::uuid
        AND r.vip_request_id IS NOT NULL
      ORDER BY r.requested_at DESC, r.id DESC
    `;
    expect(salonMessagesPlan.map((row) => row['QUERY PLAN']).join('\n').length).toBeGreaterThan(0);
    expect(vipPlan.map((row) => row['QUERY PLAN']).join('\n').length).toBeGreaterThan(0);
  });

  it('uses the latest ordinary message as the reference episode, not historical highest status', async () => {
    const salon = await registerOwner('ws-latest');
    const customer = await createCustomer(salon.token);
    const older = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer,
      requestedAt: new Date('2026-05-01T10:00:00.000Z'),
      submittedAt: new Date('2026-05-01T11:00:00.000Z'),
      status: 'SENT',
    });
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: customer, visitedAt: '2026-05-02T10:00:00.000Z' })
      .expect(201);
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer,
      requestedAt: new Date('2026-05-03T10:00:00.000Z'),
      submittedAt: new Date('2026-05-03T11:00:00.000Z'),
      status: 'SENT',
    });
    const rows = (await workspace(salon.token, 'SALON_MESSAGES').expect(200)).body.items as WorkspaceRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageState).toBe('SENT');
    expect(rows[0]?.messageRequestId).not.toBe(older.requestId);
    expect(rows[0]?.returnEvidenceKind).toBeNull();
  });

  it('attributes OBSERVED last-touch to one of two earlier SENT messages, not both', async () => {
    const salon = await registerOwner('ws-last-touch');
    const customer = await createCustomer(salon.token);
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer,
      requestedAt: new Date('2026-06-01T10:00:00.000Z'),
      submittedAt: new Date('2026-06-01T11:00:00.000Z'),
      status: 'SENT',
    });
    const later = await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer,
      requestedAt: new Date('2026-06-02T10:00:00.000Z'),
      submittedAt: new Date('2026-06-02T11:00:00.000Z'),
      status: 'SENT',
    });
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: customer, visitedAt: '2026-06-03T10:00:00.000Z' })
      .expect(201);
    const rows = (await workspace(salon.token, 'SALON_MESSAGES').expect(200)).body.items as WorkspaceRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageRequestId).toBe(later.requestId);
    expect(rows[0]?.messageState).toBe('SENT_WITH_RETURN_EVIDENCE');
    expect(rows[0]?.returnEvidenceKind).toBe('OBSERVED');
  });

  it('does not treat VIP entitlement/list rows as message execution', async () => {
    const salon = await registerOwner('ws-vip-list');
    await insertVipRequest(salon.tenantId, salon.userId);
    const vip = (await workspace(salon.token, 'VIP').expect(200)).body.items as WorkspaceRow[];
    expect(vip).toEqual([]);
  });

  it('paginates messaging rows without duplicates', async () => {
    const salon = await registerOwner('ws-page');
    for (let i = 0; i < 3; i += 1) {
      const customer = await createCustomer(salon.token);
      await insertCustomerMessage({
        salonId: salon.tenantId,
        userId: salon.userId,
        customerId: customer,
        requestedAt: new Date(Date.UTC(2026, 6, 1, 10, i, 0)),
        submittedAt: new Date(Date.UTC(2026, 6, 1, 11, i, 0)),
        status: 'SENT',
      });
    }
    const first = (await workspace(salon.token, 'SALON_MESSAGES').expect(200)).body as {
      items: WorkspaceRow[];
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(first.items.length).toBeGreaterThan(0);
    if (first.hasMore && first.nextCursor) {
      const second = (await workspace(salon.token, 'SALON_MESSAGES', first.nextCursor).expect(200))
        .body as { items: WorkspaceRow[] };
      const ids = [...first.items, ...second.items].map((row) => row.stableId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('includes visit-lapse customers in REVENUE_DROP using Tehran Jalali windows', async () => {
    const now = tehranJalaliToUtc(1404, 6, 20, 12, 0, 0);
    const windows = comparableJalaliMonthWindows(now);
    const salon = await registerOwner('ws-drop');
    const other = await registerOwner('ws-drop-other');
    const included = await createCustomer(salon.token);
    const alsoCurrent = await createCustomer(salon.token);
    const onlyCurrent = await createCustomer(salon.token);
    const none = await createCustomer(salon.token);
    const otherCustomer = await createCustomer(other.token);
    void none;

    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: included, visitedAt: windows.previousStart.toISOString() })
      .expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: alsoCurrent, visitedAt: windows.previousStart.toISOString() })
      .expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: alsoCurrent, visitedAt: windows.currentStart.toISOString() })
      .expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: onlyCurrent, visitedAt: windows.currentStart.toISOString() })
      .expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${other.token}`)
      .send({ customerId: otherCustomer, visitedAt: windows.previousStart.toISOString() })
      .expect(201);

    const useCase = app.get(
      (await import('../src/opportunities/get-opportunities-workspace.use-case'))
        .GetOpportunitiesWorkspaceUseCase,
    );
    const page = await useCase.execute(
      { tenantId: salon.tenantId, userId: salon.userId, role: 'OWNER' },
      { filter: 'REVENUE_DROP' },
      now,
    );
    const ids = page.items.map((row) => row.customerId);
    expect(ids).toContain(included);
    expect(ids).not.toContain(alsoCurrent);
    expect(ids).not.toContain(onlyCurrent);
    expect(ids).not.toContain(none);
    expect(ids).not.toContain(otherCustomer);
    expect(page.items.filter((row) => row.customerId === included)).toHaveLength(1);
    expect(page.items[0]?.messageRequestId).toBeNull();
    const dropPlan = await prisma.client.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT c.id
      FROM customers c
      WHERE c.salon_id = ${salon.tenantId}::uuid
        AND EXISTS (
          SELECT 1 FROM visits v
          WHERE v.salon_id = ${salon.tenantId}::uuid
            AND v.customer_id = c.id
            AND v.visited_at >= ${windows.previousStart}
            AND v.visited_at < ${windows.previousEndExclusive}
        )
        AND NOT EXISTS (
          SELECT 1 FROM visits v
          WHERE v.salon_id = ${salon.tenantId}::uuid
            AND v.customer_id = c.id
            AND v.visited_at >= ${windows.currentStart}
            AND v.visited_at <= ${windows.now}
        )
    `;
    expect(dropPlan.map((row) => row['QUERY PLAN']).join('\n').length).toBeGreaterThan(0);
  });

  it('does not require a MessageRequest for REVENUE_DROP inclusion', async () => {
    const now = tehranJalaliToUtc(1404, 6, 15, 9, 0, 0);
    const windows = comparableJalaliMonthWindows(now);
    const salon = await registerOwner('ws-drop-msg');
    const customer = await createCustomer(salon.token);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${salon.token}`)
      .send({ customerId: customer, visitedAt: windows.previousStart.toISOString() })
      .expect(201);
    await insertCustomerMessage({
      salonId: salon.tenantId,
      userId: salon.userId,
      customerId: customer,
      requestedAt: windows.previousStart,
      submittedAt: windows.previousStart,
      status: 'SENT',
    });
    const useCase = app.get(
      (await import('../src/opportunities/get-opportunities-workspace.use-case'))
        .GetOpportunitiesWorkspaceUseCase,
    );
    const page = await useCase.execute(
      { tenantId: salon.tenantId, userId: salon.userId, role: 'OWNER' },
      { filter: 'REVENUE_DROP' },
      now,
    );
    expect(page.items.some((row) => row.customerId === customer)).toBe(true);
  });
});

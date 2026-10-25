import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { comparableJalaliMonthWindows, createId } from '@salon/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { REVENUE_DROP_PAGE_LIMIT } from '../src/intelligence/list-revenue-drops.use-case';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { HttpExceptionFilter } from '../src/infrastructure/http/http-exception.filter';
import { listItems } from './list-page';
import { createProductOwnerSession, syntheticMobile } from './support/phone-account';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
const password = 'correct-horse-battery';

/**
 * Integrity coverage for the three Opportunities serving paths.
 * Intended DATABASE_URL: disposable Postgres (never persistent salon/salon_preview).
 */
describeIfDb('Opportunities serving paths integrity (e2e)', () => {
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
    const registered = await createProductOwnerSession(prisma.client, app.getHttpServer(), {
      salonName: `${label} Salon`,
      ownerName: `${label} Owner`,
      password,
    });
    return {
      token: registered.body.accessToken as string,
      tenantId: registered.body.user.tenantId as string,
      userId: registered.body.user.id as string,
    };
  }

  async function createCustomer(token: string, lastName: string, salonId?: string) {
    // Prefer direct inserts for volume/integrity seeding to avoid HTTP rate limits.
    if (salonId) {
      const id = createId();
      await prisma.client.customer.create({
        data: {
          id,
          salonId,
          firstName: 'Sara',
          lastName,
          phoneNumber: syntheticMobile(),
          updatedAt: new Date(),
        },
      });
      return id;
    }
    const phone = syntheticMobile();
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

  async function createCompletedTx(input: {
    salonId: string;
    customerId: string;
    serviceId: string;
    amount: string;
    occurredAt: Date;
    status?: 'COMPLETED' | 'VOIDED';
  }) {
    const txId = createId();
    const itemId = createId();
    await prisma.client.$transaction(async (tx) => {
      await tx.ledgerTransaction.create({
        data: {
          id: txId,
          salonId: input.salonId,
          customerId: input.customerId,
          amount: input.amount,
          currency: 'IRR',
          status: input.status ?? 'COMPLETED',
          occurredAt: input.occurredAt,
          updatedAt: new Date(),
        },
      });
      await tx.transactionItem.create({
        data: {
          id: itemId,
          salonId: input.salonId,
          transactionId: txId,
          serviceId: input.serviceId,
          quantity: 1,
          unitPrice: input.amount,
          totalAmount: input.amount,
        },
      });
    });
    return txId;
  }

  it('revenue-drops: voids, boundaries, ties, tenant isolation, fixed asOf pagination', async () => {
    const salonA = await registerOwner(`rd-a-${Date.now()}`);
    const salonB = await registerOwner(`rd-b-${Date.now()}`);
    const serviceA = await createService(salonA.token, `SvcA ${Date.now()}`);
    const serviceB = await createService(salonB.token, `SvcB ${Date.now()}`);

    // Seed against the live evaluation windows the HTTP handler will use (≈ now).
    const windows = comparableJalaliMonthWindows(new Date());
    const midPrevious = new Date(
      windows.previousStart.getTime() +
        (windows.previousEndExclusive.getTime() - windows.previousStart.getTime()) / 2,
    );
    const justBeforePreviousEnd = new Date(windows.previousEndExclusive.getTime() - 1);
    // Outside the comparable previous window with headroom so a slightly later HTTP
    // evaluation (previousEndExclusive tracks `now`) still excludes it. Prefer a point
    // still before currentStart when a gap exists; otherwise sit well after the exclusive end.
    const gapAfterPrevious = windows.currentStart.getTime() - windows.previousEndExclusive.getTime();
    const justOutsidePrevious =
      gapAfterPrevious > 2_000
        ? new Date(windows.previousEndExclusive.getTime() + Math.min(60_000, Math.floor(gapAfterPrevious / 2)))
        : new Date(windows.previousEndExclusive.getTime() + 60_000);
    const currentSpan = Math.max(1, windows.now.getTime() - windows.currentStart.getTime());
    const midCurrent = new Date(windows.currentStart.getTime() + currentSpan / 2);
    // Far after evaluation instant so a slightly later HTTP `now` still excludes it.
    const afterAsOf = new Date(windows.now.getTime() + 3_600_000);

    const dropCustomer = await createCustomer(salonA.token, 'Drop', salonA.tenantId);
    const equalCustomer = await createCustomer(salonA.token, 'Equal', salonA.tenantId);
    const riseCustomer = await createCustomer(salonA.token, 'Rise', salonA.tenantId);
    const voidCustomer = await createCustomer(salonA.token, 'Voided', salonA.tenantId);
    const tieCustomerLow = await createCustomer(salonA.token, 'TieLow', salonA.tenantId);
    const tieCustomerHigh = await createCustomer(salonA.token, 'TieHigh', salonA.tenantId);
    const otherSalonCustomer = await createCustomer(salonB.token, 'Other', salonB.tenantId);

    // Qualifying drop: previous 500, current 100
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: dropCustomer,
      serviceId: serviceA,
      amount: '300.00',
      occurredAt: midPrevious,
    });
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: dropCustomer,
      serviceId: serviceA,
      amount: '200.00',
      occurredAt: justBeforePreviousEnd,
    });
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: dropCustomer,
      serviceId: serviceA,
      amount: '100.00',
      occurredAt: midCurrent,
    });
    // Outside previous window (at exclusive end) — must not count as previous
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: dropCustomer,
      serviceId: serviceA,
      amount: '9000.00',
      occurredAt: justOutsidePrevious,
    });
    // After asOf — must not count in current
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: dropCustomer,
      serviceId: serviceA,
      amount: '9000.00',
      occurredAt: afterAsOf,
    });

    // Equal previous/current — excluded
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: equalCustomer,
      serviceId: serviceA,
      amount: '150.00',
      occurredAt: midPrevious,
    });
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: equalCustomer,
      serviceId: serviceA,
      amount: '150.00',
      occurredAt: midCurrent,
    });

    // Rise — excluded
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: riseCustomer,
      serviceId: serviceA,
      amount: '50.00',
      occurredAt: midPrevious,
    });
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: riseCustomer,
      serviceId: serviceA,
      amount: '80.00',
      occurredAt: midCurrent,
    });

    // VOIDED large previous — must not invent a drop
    const voidedId = await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: voidCustomer,
      serviceId: serviceA,
      amount: '8000.00',
      occurredAt: midPrevious,
      status: 'VOIDED',
    });
    expect(voidedId).toBeTruthy();
    await createCompletedTx({
      salonId: salonA.tenantId,
      customerId: voidCustomer,
      serviceId: serviceA,
      amount: '10.00',
      occurredAt: midCurrent,
    });

    // Equal differences for cursor tie-break (both prev 400 current 100 → diff 300)
    for (const customerId of [tieCustomerLow, tieCustomerHigh]) {
      await createCompletedTx({
        salonId: salonA.tenantId,
        customerId,
        serviceId: serviceA,
        amount: '400.00',
        occurredAt: midPrevious,
      });
      await createCompletedTx({
        salonId: salonA.tenantId,
        customerId,
        serviceId: serviceA,
        amount: '100.00',
        occurredAt: midCurrent,
      });
    }

    // Other salon must not leak
    await createCompletedTx({
      salonId: salonB.tenantId,
      customerId: otherSalonCustomer,
      serviceId: serviceB,
      amount: '9999.00',
      occurredAt: midPrevious,
    });

    const page1 = await request(app.getHttpServer())
      .get('/intelligence/revenue-drops')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);

    expect(page1.body.consistency).toBe('LIVE_READ');
    expect(page1.body.reportingTimezone).toBe('Asia/Tehran');
    expect(typeof page1.body.asOf).toBe('string');
    expect(page1.body.explanation).toContain('تازه‌سازی');

    const items = listItems(page1.body) as Array<{
      customerId: string;
      previousComparableAmount: string;
      currentAmount: string;
      differenceAmount: string;
      currency: string;
    }>;
    const ids = new Set(items.map((row) => row.customerId));
    expect(ids.has(dropCustomer)).toBe(true);
    expect(ids.has(tieCustomerLow)).toBe(true);
    expect(ids.has(tieCustomerHigh)).toBe(true);
    expect(ids.has(otherSalonCustomer)).toBe(false);
    expect(ids.has(equalCustomer)).toBe(false);
    expect(ids.has(riseCustomer)).toBe(false);
    expect(ids.has(voidCustomer)).toBe(false);
    const dropRow = items.find((row) => row.customerId === dropCustomer)!;
    expect(dropRow.previousComparableAmount).toBe('500.00');
    expect(dropRow.currentAmount).toBe('100.00');
    expect(dropRow.differenceAmount).toBe('400.00');
    // Equal differences (300.00): ordered by customerId DESC among the ties.
    const tieRows = items.filter((row) =>
      [tieCustomerLow, tieCustomerHigh].includes(row.customerId),
    );
    expect(tieRows).toHaveLength(2);
    expect(tieRows.every((row) => row.differenceAmount === '300.00')).toBe(true);
    const tieIndexHigh = items.findIndex((row) => row.customerId === tieCustomerHigh);
    const tieIndexLow = items.findIndex((row) => row.customerId === tieCustomerLow);
    if (tieCustomerHigh > tieCustomerLow) {
      expect(tieIndexHigh).toBeLessThan(tieIndexLow);
    } else {
      expect(tieIndexLow).toBeLessThan(tieIndexHigh);
    }
    for (const row of items) {
      expect(row.currency).toBe('IRR');
      expect(row.differenceAmount).toMatch(/^\d+\.\d{2}$/);
      expect(Number(row.previousComparableAmount)).toBeGreaterThan(Number(row.currentAmount));
    }

    const foreign = await request(app.getHttpServer())
      .get('/intelligence/revenue-drops')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    const foreignIds = new Set(
      (listItems(foreign.body) as Array<{ customerId: string }>).map((row) => row.customerId),
    );
    expect(foreignIds.has(dropCustomer)).toBe(false);

    // Fixed asOf pagination: continue with nextCursor; asOf must match page1.
    if (page1.body.hasMore && page1.body.nextCursor) {
      const page2 = await request(app.getHttpServer())
        .get('/intelligence/revenue-drops')
        .query({ cursor: page1.body.nextCursor })
        .set('Authorization', `Bearer ${salonA.token}`)
        .expect(200);
      expect(page2.body.asOf).toBe(page1.body.asOf);
      expect(page2.body.currentWindow.startInclusive).toBe(page1.body.currentWindow.startInclusive);
      expect(page2.body.previousComparableWindow.startInclusive).toBe(
        page1.body.previousComparableWindow.startInclusive,
      );
    }
  });

  it('revenue-drops pagination with representative volume and EXPLAIN plans', async () => {
    const salon = await registerOwner(`rd-vol-${Date.now()}`);
    const serviceId = await createService(salon.token, `VolSvc ${Date.now()}`);
    const liveWindows = comparableJalaliMonthWindows(new Date());
    const prevMid = new Date(
      liveWindows.previousStart.getTime() +
        (liveWindows.previousEndExclusive.getTime() - liveWindows.previousStart.getTime()) / 2,
    );
    const curMid = new Date(
      liveWindows.currentStart.getTime() +
        Math.max(1, (liveWindows.now.getTime() - liveWindows.currentStart.getTime()) / 2),
    );

    const customerIds: string[] = [];
    const volume = REVENUE_DROP_PAGE_LIMIT + 5;
    for (let i = 0; i < volume; i += 1) {
      const customerId = await createCustomer(salon.token, `V${i}`, salon.tenantId);
      customerIds.push(customerId);
      const prevAmount = (1000 + i).toFixed(2);
      const curAmount = '10.00';
      await createCompletedTx({
        salonId: salon.tenantId,
        customerId,
        serviceId,
        amount: prevAmount,
        occurredAt: prevMid,
      });
      await createCompletedTx({
        salonId: salon.tenantId,
        customerId,
        serviceId,
        amount: curAmount,
        occurredAt: curMid,
      });
    }

    const page1 = await request(app.getHttpServer())
      .get('/intelligence/revenue-drops')
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(page1.body.hasMore).toBe(true);
    expect(listItems(page1.body)).toHaveLength(REVENUE_DROP_PAGE_LIMIT);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app.getHttpServer())
      .get('/intelligence/revenue-drops')
      .query({ cursor: page1.body.nextCursor })
      .set('Authorization', `Bearer ${salon.token}`)
      .expect(200);
    expect(page2.body.asOf).toBe(page1.body.asOf);
    const page1Ids = new Set(
      (listItems(page1.body) as Array<{ customerId: string }>).map((row) => row.customerId),
    );
    const page2Items = listItems(page2.body) as Array<{ customerId: string }>;
    for (const row of page2Items) {
      expect(page1Ids.has(row.customerId)).toBe(false);
    }

    const explain = await prisma.client.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT t.customer_id, SUM(t.amount)
       FROM transactions t
       WHERE t.salon_id = $1::uuid
         AND t.status = 'COMPLETED'::"TransactionStatus"
         AND (
           (t.occurred_at >= $2::timestamptz AND t.occurred_at < $3::timestamptz)
           OR (t.occurred_at >= $4::timestamptz AND t.occurred_at <= $5::timestamptz)
         )
       GROUP BY t.customer_id
       ORDER BY 2 DESC
       LIMIT ${REVENUE_DROP_PAGE_LIMIT + 1}`,
      salon.tenantId,
      liveWindows.previousStart.toISOString(),
      liveWindows.previousEndExclusive.toISOString(),
      liveWindows.currentStart.toISOString(),
      liveWindows.now.toISOString(),
    );
    const planText = explain.map((row) => row['QUERY PLAN']).join('\n');
    expect(planText.length).toBeGreaterThan(20);
    // Representative size note for the report: volume customers × 2 txs in this salon.
    expect(customerIds.length).toBe(volume);
  });

  it('VIP history: revoked entitlement keeps history; other salon sees none; GET is read-only', async () => {
    const salonA = await registerOwner(`vip-a-${Date.now()}`);
    const salonB = await registerOwner(`vip-b-${Date.now()}`);
    const adminId = randomUUID();
    await prisma.client.platformAdmin.create({
      data: {
        id: adminId,
        name: 'Opp Admin',
        phone: syntheticMobile(),
        passwordHash: 'x',
        updatedAt: new Date(),
      },
    });

    const listId = randomUUID();
    const requestId = randomUUID();
    const now = new Date();
    await prisma.client.vipTargetList.create({
      data: {
        id: listId,
        name: `secret-list-${listId.slice(0, 8)}`,
        status: 'IN_USE',
        contactCount: 2,
        regionCode: '01',
        catalogMembership: 'ORIGINAL_TEHRAN',
        createdByAdminId: adminId,
        reservedBySalonId: salonA.tenantId,
        reservedAt: now,
        updatedAt: now,
      },
    });
    const contactPhones = [syntheticMobile(), syntheticMobile()];
    for (let i = 0; i < contactPhones.length; i += 1) {
      await prisma.client.vipTargetContact.create({
        data: {
          id: randomUUID(),
          listId,
          sortOrder: i + 1,
          displayName: `Hidden ${i}`,
          phoneNumber: contactPhones[i]!,
        },
      });
    }
    await prisma.client.vipRequest.create({
      data: {
        id: requestId,
        salonId: salonA.tenantId,
        listId,
        createdByUserId: salonA.userId,
        requestedCount: 30,
        geographicRange: 'تهران',
        status: 'SUBMITTED',
        reservedUntil: new Date(now.getTime() + 3_600_000),
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    const contacts = await prisma.client.vipTargetContact.findMany({
      where: { listId },
      orderBy: { sortOrder: 'asc' },
    });
    const recipientIds: string[] = [];
    for (const [index, contact] of contacts.entries()) {
      const recipientId = randomUUID();
      recipientIds.push(recipientId);
      await prisma.client.vipRequestRecipient.create({
        data: {
          id: recipientId,
          salonId: salonA.tenantId,
          vipRequestId: requestId,
          sourceContactId: contact.id,
          sortOrder: index + 1,
          displayName: contact.displayName,
          phoneNumber: contact.phoneNumber,
          messageText: 'VIP outreach body not for salon history disclosure',
        },
      });
    }
    const [recipientA, recipientB] = recipientIds;

    // Manual SENT for recipient A; still QUEUED (no delivery) for recipient B.
    const sentMessageId = randomUUID();
    const queuedMessageId = randomUUID();
    await prisma.client.messageRequest.create({
      data: {
        id: sentMessageId,
        salonId: salonA.tenantId,
        createdByUserId: salonA.userId,
        vipRequestId: requestId,
        recipientDisplayName: 'Hidden 0',
        recipientPhoneNumber: contactPhones[0]!,
        messageText: 'VIP outreach body not for salon history disclosure',
        requestedAt: now,
        messageBusinessDate: new Date('2026-10-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'SENT',
        updatedAt: now,
      },
    });
    await prisma.client.messageDelivery.create({
      data: {
        id: randomUUID(),
        salonId: salonA.tenantId,
        messageRequestId: sentMessageId,
        mode: 'MANUAL',
        channel: 'TEXT',
        status: 'SENT',
        providerRequestId: randomUUID(),
        createdBy: salonA.userId,
        submittedAt: now,
        updatedAt: now,
      },
    });
    await prisma.client.messageRequest.create({
      data: {
        id: queuedMessageId,
        salonId: salonA.tenantId,
        createdByUserId: salonA.userId,
        vipRequestId: requestId,
        recipientDisplayName: 'Hidden 1',
        recipientPhoneNumber: contactPhones[1]!,
        messageText: 'VIP outreach body not for salon history disclosure',
        requestedAt: now,
        messageBusinessDate: new Date('2026-10-01T00:00:00.000Z'),
        countsTowardDailyLimit: false,
        status: 'QUEUED',
        updatedAt: now,
      },
    });
    await prisma.client.vipRequestRecipient.update({
      where: { id: recipientA! },
      data: { messageRequestId: sentMessageId },
    });
    await prisma.client.vipRequestRecipient.update({
      where: { id: recipientB! },
      data: { messageRequestId: queuedMessageId },
    });

    // Admin-reported intention on recipient A, then link a real Visit (FK-verified).
    // A second intention on the same recipient after linking must still count once.
    const linkedCustomerId = await createCustomer(salonA.token, 'VipLink', salonA.tenantId);
    const linkedVisitId = createId();
    await prisma.client.visit.create({
      data: {
        id: linkedVisitId,
        salonId: salonA.tenantId,
        customerId: linkedCustomerId,
        visitedAt: now,
        updatedAt: now,
      },
    });
    const intentionLinkedId = randomUUID();
    await prisma.client.visitIntention.create({
      data: {
        id: intentionLinkedId,
        salonId: salonA.tenantId,
        subject: 'VIP_PROSPECT',
        vipRequestId: requestId,
        vipRequestRecipientId: recipientA!,
        timePrecision: 'UNKNOWN',
        reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
        contactBasis: 'WITHHELD',
        createdByPlatformAdminId: adminId,
        updatedByPlatformAdminId: adminId,
        linkedVisitId,
        linkedCustomerId,
        updatedAt: now,
      },
    });
    await prisma.client.visitIntention.create({
      data: {
        id: randomUUID(),
        salonId: salonA.tenantId,
        subject: 'VIP_PROSPECT',
        vipRequestId: requestId,
        vipRequestRecipientId: recipientA!,
        timePrecision: 'UNKNOWN',
        reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
        contactBasis: 'WITHHELD',
        createdByPlatformAdminId: adminId,
        updatedByPlatformAdminId: adminId,
        updatedAt: now,
      },
    });
    // Distinct second recipient with an open admin intention.
    await prisma.client.visitIntention.create({
      data: {
        id: randomUUID(),
        salonId: salonA.tenantId,
        subject: 'VIP_PROSPECT',
        vipRequestId: requestId,
        vipRequestRecipientId: recipientB!,
        timePrecision: 'UNKNOWN',
        reportChannel: 'REPORTED_DURING_MANUAL_HANDLING',
        contactBasis: 'WITHHELD',
        createdByPlatformAdminId: adminId,
        updatedByPlatformAdminId: adminId,
        updatedAt: now,
      },
    });
    // Salon-reported inbound (no recipient FK) must not invent a recipient count bump.
    await prisma.client.visitIntention.create({
      data: {
        id: randomUUID(),
        salonId: salonA.tenantId,
        subject: 'VIP_PROSPECT',
        vipRequestId: requestId,
        timePrecision: 'UNKNOWN',
        reportChannel: 'INBOUND_TO_SALON',
        contactBasis: 'SALON_SUPPLIED',
        disclosedDisplayName: 'مریم سالن',
        createdByUserId: salonA.userId,
        updatedByUserId: salonA.userId,
        updatedAt: now,
      },
    });

    // Cancelled draft without recipients → UNAVAILABLE metrics.
    // Reuse listId FK only; no recipient snapshot rows for this request.
    const cancelledDraftId = randomUUID();
    await prisma.client.vipRequest.create({
      data: {
        id: cancelledDraftId,
        salonId: salonA.tenantId,
        listId,
        createdByUserId: salonA.userId,
        requestedCount: 30,
        geographicRange: 'تهران',
        status: 'CANCELLED',
        reservedUntil: new Date(now.getTime() - 60_000),
        submittedAt: null,
        cancelledAt: now,
        createdAt: new Date(now.getTime() - 120_000),
        updatedAt: now,
      },
    });

    // Entitlement then revoke
    const entitlementId = randomUUID();
    await prisma.client.vipSalonEntitlement.create({
      data: {
        id: entitlementId,
        salonId: salonA.tenantId,
        grantedByAdminId: adminId,
        grantedAt: now,
        updatedAt: now,
      },
    });
    await prisma.client.vipSalonEntitlement.update({
      where: { id: entitlementId },
      data: { revokedAt: new Date(), revokedByAdminId: adminId, updatedAt: new Date() },
    });

    const beforeStatuses = await prisma.client.vipRequest.findMany({
      where: { salonId: salonA.tenantId },
      select: { id: true, status: true, reservedUntil: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });

    const history = await request(app.getHttpServer())
      .get('/vip/requests')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(history.body.entitled).toBe(false);
    expect(history.body.consistency).toBe('LIVE_READ');
    const items = listItems(history.body) as Array<Record<string, unknown>>;
    const submitted = items.find((row) => row.id === requestId)!;
    const cancelled = items.find((row) => row.id === cancelledDraftId)!;
    expect(submitted).toBeTruthy();
    expect(cancelled).toBeTruthy();
    expect(submitted.listName).toBe(`secret-list-${listId.slice(0, 8)}`);
    expect(submitted.metricsAvailability).toBe('AVAILABLE');
    expect(submitted.recipientDenominator).toBe(2);
    expect(submitted.recordedSendCount).toBe(1);
    expect(submitted.manualRecordedSendCount).toBe(1);
    expect(submitted.stillQueuedOrInProgressCount).toBeGreaterThanOrEqual(1);
    expect(submitted.intentionRecipientCount).toBe(2);
    expect(submitted.visitedRecipientCount).toBe(1);
    expect(submitted.sentMeans).toBe('RECORDED_SEND_NOT_CONFIRMED_DELIVERY');
    expect(cancelled.metricsAvailability).toBe('UNAVAILABLE');
    expect(cancelled.intentionRecipientCount).toBeNull();
    expect(cancelled.visitedRecipientCount).toBeNull();
    expect(cancelled.recipientDenominator).toBeNull();

    // FK integrity: linked visit belongs to this salon and customer.
    const linked = await prisma.client.visitIntention.findUniqueOrThrow({
      where: { id: intentionLinkedId },
      select: {
        linkedVisitId: true,
        linkedCustomerId: true,
        salonId: true,
        vipRequestId: true,
        vipRequestRecipientId: true,
        linkedVisit: { select: { id: true, salonId: true, customerId: true } },
      },
    });
    expect(linked.salonId).toBe(salonA.tenantId);
    expect(linked.vipRequestId).toBe(requestId);
    expect(linked.vipRequestRecipientId).toBe(recipientA);
    expect(linked.linkedVisitId).toBe(linkedVisitId);
    expect(linked.linkedVisit?.salonId).toBe(salonA.tenantId);
    expect(linked.linkedVisit?.customerId).toBe(linkedCustomerId);

    const bodyText = JSON.stringify(history.body);
    for (const phone of contactPhones) {
      expect(bodyText).not.toContain(phone);
    }
    expect(bodyText).not.toContain('Hidden 0');
    expect(bodyText).not.toContain('VIP outreach body');
    expect(bodyText).not.toContain('مریم سالن');

    const afterStatuses = await prisma.client.vipRequest.findMany({
      where: { salonId: salonA.tenantId },
      select: { id: true, status: true, reservedUntil: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });
    expect(afterStatuses).toEqual(beforeStatuses);

    const other = await request(app.getHttpServer())
      .get('/vip/requests')
      .set('Authorization', `Bearer ${salonB.token}`)
      .expect(200);
    const otherItems = listItems(other.body) as Array<{ id: string }>;
    expect(otherItems.some((row) => row.id === requestId)).toBe(false);
    expect(otherItems.some((row) => row.id === cancelledDraftId)).toBe(false);

    // New VIP action still blocked when revoked
    await request(app.getHttpServer())
      .get('/vip/regions')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(403);

    const explainVip = await prisma.client.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT
         vi.vip_request_id,
         COUNT(DISTINCT vi.vip_request_recipient_id)::int AS intention_recipients,
         COUNT(DISTINCT vi.vip_request_recipient_id) FILTER (
           WHERE vi.linked_visit_id IS NOT NULL
         )::int AS visited_recipients
       FROM visit_intentions vi
       INNER JOIN vip_request_recipients vrr
         ON vrr.id = vi.vip_request_recipient_id
         AND vrr.salon_id = vi.salon_id
         AND vrr.vip_request_id = vi.vip_request_id
       WHERE vi.salon_id = $1::uuid
         AND vi.subject = 'VIP_PROSPECT'::"VisitIntentionSubject"
         AND vi.vip_request_id = $2::uuid
         AND vi.vip_request_recipient_id IS NOT NULL
       GROUP BY vi.vip_request_id`,
      salonA.tenantId,
      requestId,
    );
    expect(explainVip.map((row) => row['QUERY PLAN']).join('\n').length).toBeGreaterThan(20);
  });

  it('ordinary message history: non-VIP only, no body, tenant isolation, stable order', async () => {
    const salonA = await registerOwner(`msg-a-${Date.now()}`);
    const salonB = await registerOwner(`msg-b-${Date.now()}`);
    const customerA = await createCustomer(salonA.token, 'MsgA', salonA.tenantId);
    const customerB = await createCustomer(salonB.token, 'MsgB', salonB.tenantId);

    const older = await request(app.getHttpServer())
      .post(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', createId())
      .send({ text: 'SECRET_BODY_OLDER_SHOULD_NOT_LEAK' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 20));
    const newer = await request(app.getHttpServer())
      .post(`/customers/${customerA}/messages`)
      .set('Authorization', `Bearer ${salonA.token}`)
      .set('Idempotency-Key', createId())
      // May 409 daily limit — if so, still assert history of the first
      .send({ text: 'SECRET_BODY_NEWER_SHOULD_NOT_LEAK' });

    const foreign = await request(app.getHttpServer())
      .post(`/customers/${customerB}/messages`)
      .set('Authorization', `Bearer ${salonB.token}`)
      .set('Idempotency-Key', createId())
      .send({ text: 'FOREIGN_SECRET' })
      .expect(201);

    const history = await request(app.getHttpServer())
      .get('/messages/history')
      .set('Authorization', `Bearer ${salonA.token}`)
      .expect(200);
    expect(history.body.consistency).toBe('LIVE_READ');
    const items = listItems(history.body) as Array<{
      id: string;
      customerId: string;
      displayStatus: string;
      requestStatus: string;
    }>;
    const ids = items.map((row) => row.id);
    expect(ids).toContain(older.body.id);
    expect(ids).not.toContain(foreign.body.id);
    if (newer.status === 201) {
      expect(ids.indexOf(newer.body.id)).toBeLessThan(ids.indexOf(older.body.id));
    }
    const serialized = JSON.stringify(history.body);
    expect(serialized).not.toContain('SECRET_BODY');
    expect(serialized).not.toContain('FOREIGN_SECRET');
    expect(serialized).not.toMatch(/messageText|\"text\":/);
    for (const row of items) {
      expect(['QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED']).toContain(row.displayStatus);
      expect(row.customerId).toBeTruthy();
    }
  });
});

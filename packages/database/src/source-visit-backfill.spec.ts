import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createPrismaClient } from './client';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const repairSql = readFileSync(
  path.join(
    __dirname,
    '../prisma/migrations/20260911150000_opportunity_action_source_visit_repair/migration.sql',
  ),
  'utf8',
);

describeIfDb('opportunity_actions sourceVisitId backfill', () => {
  const prisma = createPrismaClient(databaseUrl as string);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reconstructs the visit that existed at action time and never fabricates visit ids', async () => {
    const salonId = randomUUID();
    const otherSalonId = randomUUID();
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const customerId = randomUUID();
    const noVisitCustomerId = randomUUID();
    const otherCustomerId = randomUUID();
    const visit1 = randomUUID();
    const visit2 = randomUUID();
    const actionAfterVisit1 = randomUUID();
    const actionAfterVisit2 = randomUUID();
    const collidingLater = randomUUID();
    const dismissedSameType = randomUUID();
    const noVisitAction = randomUUID();
    const otherTenantAction = randomUUID();
    const auditId = randomUUID();
    const outboxId = randomUUID();

    const visit1Created = new Date('2026-06-01T10:00:00.000Z');
    const action1Created = new Date('2026-06-10T10:00:00.000Z');
    const visit2Created = new Date('2026-07-01T10:00:00.000Z');
    const action2Created = new Date('2026-07-10T10:00:00.000Z');
    const collideCreated = new Date('2026-06-15T10:00:00.000Z');

    await prisma.salon.createMany({
      data: [
        { id: salonId, name: 'Backfill A', updatedAt: new Date() },
        { id: otherSalonId, name: 'Backfill B', updatedAt: new Date() },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: userId,
          salonId,
          name: 'Owner',
          email: `act-bf-${Date.now()}@example.test`,
          passwordHash: 'hash',
          role: 'OWNER',
          updatedAt: new Date(),
        },
        {
          id: otherUserId,
          salonId: otherSalonId,
          name: 'Other',
          email: `act-bf-b-${Date.now()}@example.test`,
          passwordHash: 'hash',
          role: 'OWNER',
          updatedAt: new Date(),
        },
      ],
    });
    await prisma.customer.createMany({
      data: [
        {
          id: customerId,
          salonId,
          firstName: 'Sara',
          lastName: 'A',
          phoneNumber: `0920${Date.now().toString().slice(-7)}`,
          updatedAt: new Date(),
        },
        {
          id: noVisitCustomerId,
          salonId,
          firstName: 'Neda',
          lastName: 'None',
          phoneNumber: `0921${Date.now().toString().slice(-7)}`,
          updatedAt: new Date(),
        },
        {
          id: otherCustomerId,
          salonId: otherSalonId,
          firstName: 'Other',
          lastName: 'Salon',
          phoneNumber: `0922${Date.now().toString().slice(-7)}`,
          updatedAt: new Date(),
        },
      ],
    });
    await prisma.visit.create({
      data: {
        id: visit1,
        salonId,
        customerId,
        visitedAt: new Date('2026-05-01T10:00:00.000Z'),
        createdAt: visit1Created,
        updatedAt: visit1Created,
      },
    });
    await prisma.visit.create({
      data: {
        id: visit2,
        salonId,
        customerId,
        visitedAt: new Date('2026-06-20T10:00:00.000Z'),
        createdAt: visit2Created,
        updatedAt: visit2Created,
      },
    });

    await prisma.opportunityAction.create({
      data: {
        id: actionAfterVisit1,
        salonId,
        customerId,
        opportunityType: 'REACTIVATION',
        status: 'COMPLETED',
        createdBy: userId,
        createdAt: action1Created,
        updatedAt: action1Created,
        completedAt: action1Created,
        sourceVisitId: visit2,
      },
    });
    await prisma.opportunityAction.create({
      data: {
        id: collidingLater,
        salonId,
        customerId,
        opportunityType: 'REACTIVATION',
        status: 'COMPLETED',
        createdBy: userId,
        createdAt: collideCreated,
        updatedAt: collideCreated,
        completedAt: collideCreated,
        sourceVisitId: collidingLater,
      },
    });
    await prisma.opportunityAction.create({
      data: {
        id: actionAfterVisit2,
        salonId,
        customerId,
        opportunityType: 'REACTIVATION',
        status: 'COMPLETED',
        createdBy: userId,
        createdAt: action2Created,
        updatedAt: action2Created,
        completedAt: action2Created,
        sourceVisitId: actionAfterVisit2,
      },
    });
    await prisma.opportunityAction.create({
      data: {
        id: dismissedSameType,
        salonId,
        customerId,
        opportunityType: 'CUSTOMER_RETURN',
        status: 'DISMISSED',
        createdBy: userId,
        createdAt: action2Created,
        updatedAt: action2Created,
        dismissedAt: action2Created,
        sourceVisitId: visit2,
      },
    });
    await prisma.opportunityAction.create({
      data: {
        id: noVisitAction,
        salonId,
        customerId: noVisitCustomerId,
        opportunityType: 'REVENUE_DECLINE',
        status: 'COMPLETED',
        createdBy: userId,
        createdAt: action1Created,
        updatedAt: action1Created,
        completedAt: action1Created,
        sourceVisitId: noVisitAction,
      },
    });
    await prisma.opportunityAction.create({
      data: {
        id: otherTenantAction,
        salonId: otherSalonId,
        customerId: otherCustomerId,
        opportunityType: 'REACTIVATION',
        status: 'OPEN',
        createdBy: otherUserId,
        updatedAt: new Date(),
        sourceVisitId: null,
      },
    });
    await prisma.auditLog.create({
      data: {
        id: auditId,
        tenantId: salonId,
        actorId: userId,
        action: 'ACTION_COMPLETED',
        resource: 'opportunity_action',
        resourceId: actionAfterVisit1,
        result: 'SUCCESS',
        metadata: {},
      },
    });
    await prisma.outboxEvent.create({
      data: {
        id: outboxId,
        tenantId: salonId,
        eventType: 'ActionCompleted',
        payload: { actionId: actionAfterVisit1 },
      },
    });

    const statements = repairSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }

    const after = await prisma.opportunityAction.findMany({
      where: { id: { in: [actionAfterVisit1, collidingLater, actionAfterVisit2, dismissedSameType, noVisitAction, otherTenantAction] } },
    });
    const byId = Object.fromEntries(after.map((row) => [row.id, row]));

    expect(byId[actionAfterVisit1]?.sourceVisitId).toBe(visit1);
    expect(byId[actionAfterVisit1]?.status).toBe('COMPLETED');
    expect(byId[actionAfterVisit1]?.salonId).toBe(salonId);
    expect(byId[actionAfterVisit1]?.customerId).toBe(customerId);

    expect(byId[collidingLater]?.sourceVisitId).toBeNull();
    expect(byId[collidingLater]?.status).toBe('COMPLETED');
    expect(byId[collidingLater]?.id).toBe(collidingLater);

    expect(byId[actionAfterVisit2]?.sourceVisitId).toBe(visit2);
    expect(byId[dismissedSameType]?.sourceVisitId).toBe(visit2);
    expect(byId[dismissedSameType]?.status).toBe('DISMISSED');

    expect(byId[noVisitAction]?.sourceVisitId).toBeNull();
    expect(byId[noVisitAction]?.id).not.toBe(byId[noVisitAction]?.sourceVisitId);

    expect(byId[otherTenantAction]?.salonId).toBe(otherSalonId);
    expect(byId[otherTenantAction]?.customerId).toBe(otherCustomerId);

    expect(await prisma.opportunityAction.count({ where: { salonId, customerId } })).toBe(4);
    expect(await prisma.auditLog.findUnique({ where: { id: auditId } })).toMatchObject({
      resourceId: actionAfterVisit1,
      action: 'ACTION_COMPLETED',
    });
    expect(await prisma.outboxEvent.findUnique({ where: { id: outboxId } })).toMatchObject({
      eventType: 'ActionCompleted',
    });
    expect(after.every((row) => row.sourceVisitId !== row.id)).toBe(true);
  });
});

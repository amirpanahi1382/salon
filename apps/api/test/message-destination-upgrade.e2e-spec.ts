import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createPrismaClient, Prisma } from '@salon/database';
import { SelectMessageDeliveryModeUseCase } from '../src/messaging/admin-message.use-cases';
import { observedReturnCtes } from '../src/recovery-outcomes/eligible-message-evidence.sql';
import { SendCustomerMessageHandler } from '../../worker/src/messaging/send-customer-message.handler';

// Explicit opt-in. This test creates and drops a database on a disposable local instance.
const isolatedUrl = process.env.PHASE3_ISOLATED_DATABASE_URL;
const describeIsolated = isolatedUrl ? describe : describe.skip;

describeIsolated('Phase 3 historical destination upgrade', () => {
  const base = new URL(isolatedUrl ?? 'postgresql://unused/phase3_unused');
  if (isolatedUrl && (base.hostname !== '127.0.0.1' || !base.pathname.startsWith('/phase3_'))) {
    throw new Error('PHASE3_ISOLATED_DATABASE_URL must name a loopback phase3_ disposable database');
  }
  const admin = createPrismaClient(isolatedUrl ?? 'postgresql://unused/phase3_unused');
  const databaseName = `phase3_history_${randomUUID().replaceAll('-', '')}`;
  const historyUrl = new URL(base);
  historyUrl.pathname = `/${databaseName}`;
  const db = createPrismaClient(historyUrl.toString());
  let temp: string;
  const migrations = resolve(__dirname, '../../../packages/database/prisma/migrations');
  const schema = resolve(__dirname, '../../../packages/database/prisma/schema.prisma');

  function deploy() {
    const result = spawnSync('pnpm', ['--filter', '@salon/database', 'exec', 'prisma', 'migrate', 'deploy', '--schema', join(temp, 'schema.prisma')], {
      cwd: resolve(__dirname, '../../..'),
      env: { ...process.env, DATABASE_URL: historyUrl.toString() },
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`Isolated migration failed: ${(result.stderr + result.stdout).replaceAll(historyUrl.toString(), '[isolated URL]')}`);
  }

  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    temp = mkdtempSync(join(tmpdir(), 'salon-phase3-upgrade-'));
    writeFileSync(join(temp, 'schema.prisma'), readFileSync(schema));
    cpSync(join(migrations, 'migration_lock.toml'), join(temp, 'migrations', 'migration_lock.toml'), { recursive: true });
    const names = readdirSync(migrations).filter((name) => /^\d/.test(name)).sort();
    expect(names.at(-1)).toBe('20260924120000_message_request_destination_snapshot');
    expect(names.at(-2)).toBe('20260924100000_messaging_execution_ownership');
    for (const name of names.slice(0, -1)) cpSync(join(migrations, name), join(temp, 'migrations', name), { recursive: true });
    deploy();
  });

  afterAll(async () => {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.$disconnect();
    if (temp) rmSync(temp, { recursive: true, force: true });
  });

  it('preserves unknown ordinary history, exact VIP provenance, and safe legacy execution', async () => {
    const salonId = randomUUID(), userId = randomUUID(), customerId = randomUUID();
    const queuedId = randomUUID(), sentId = randomUUID(), baleId = randomUUID(), deliveryId = randomUUID();
    const vipRequestId = randomUUID(), vipMessageId = randomUUID();
    const oldPhone = '09121111111', newPhone = '09129999999', vipPhone = '09123333333';
    await db.salon.create({ data: { id: salonId, name: 'Historical destination fixture' } });
    await db.user.create({ data: { id: userId, salonId, name: 'Owner', email: `${userId}@example.test`, passwordHash: 'unused', role: 'OWNER' } });
    await db.customer.create({ data: { id: customerId, salonId, firstName: 'Sara', lastName: 'A', phoneNumber: oldPhone } });
    for (const [id, status, date] of [
      [queuedId, 'QUEUED', '2026-09-01'], [sentId, 'SENT', '2026-09-02'], [baleId, 'DISPATCHED', '2026-09-03'],
    ] as const) {
      await db.messageRequest.create({ data: {
        id, salonId, customerId, createdByUserId: userId, messageText: 'Historical intent',
        recipientPhoneNumber: null, messageBusinessDate: new Date(date), countsTowardDailyLimit: false, status,
      } });
    }
    const sentDeliveryId = randomUUID();
    await db.messageDelivery.create({ data: {
      id: sentDeliveryId, salonId, customerId, messageRequestId: sentId, createdBy: userId,
      mode: 'MANUAL', channel: 'TEXT', status: 'SENT', providerRequestId: sentDeliveryId,
      submittedAt: new Date('2026-09-02T12:00:00Z'),
    } });
    await db.messageDelivery.create({ data: {
      id: deliveryId, salonId, customerId, messageRequestId: baleId, createdBy: userId,
      mode: 'BALE', provider: 'BALE_SAFIR', channel: 'TEXT', status: 'PENDING', providerRequestId: deliveryId,
    } });

    const platformAdminId = randomUUID(), listId = randomUUID(), contactId = randomUUID(), recipientId = randomUUID();
    await db.platformAdmin.create({ data: { id: platformAdminId, email: `${platformAdminId}@example.test`, name: 'Admin', passwordHash: 'unused' } });
    await db.vipTargetList.create({ data: {
      id: listId, name: 'Historical VIP list', status: 'IN_USE', contactCount: 30,
      createdByAdminId: platformAdminId, reservedBySalonId: salonId, reservedAt: new Date(),
    } });
    await db.vipTargetContact.create({ data: { id: contactId, listId, sortOrder: 1, phoneNumber: vipPhone } });
    await db.vipRequest.create({ data: {
      id: vipRequestId, salonId, listId, createdByUserId: userId, requestedCount: 30,
      geographicRange: 'ونک', status: 'SUBMITTED', reservedUntil: new Date(), submittedAt: new Date(),
    } });
    await db.messageRequest.create({ data: {
      id: vipMessageId, salonId, customerId: null, createdByUserId: userId, vipRequestId,
      recipientDisplayName: 'VIP historical recipient', recipientPhoneNumber: vipPhone, messageText: 'VIP historical intent',
      messageBusinessDate: new Date('2026-09-04'), countsTowardDailyLimit: false, status: 'QUEUED',
    } });
    await expect(db.messageRequest.create({ data: {
      id: randomUUID(), salonId, customerId: null, createdByUserId: userId, vipRequestId,
      recipientDisplayName: 'Impossible missing VIP destination', recipientPhoneNumber: null,
      messageText: 'Predecessor CHECK proof', messageBusinessDate: new Date('2026-09-05'),
      countsTowardDailyLimit: false, status: 'QUEUED',
    } })).rejects.toThrow(/message_requests_recipient_origin_consistent/);
    await db.vipRequestRecipient.create({ data: {
      id: recipientId, vipRequestId, salonId, sortOrder: 1, sourceContactId: contactId,
      phoneNumber: vipPhone, messageText: 'VIP historical intent', messageRequestId: vipMessageId,
    } });

    await db.customer.update({ where: { id: customerId }, data: { phoneNumber: newPhone } });
    await db.vipTargetContact.update({ where: { id: contactId }, data: { phoneNumber: '09124444444' } });
    const before = {
      requests: await db.messageRequest.count({ where: { salonId } }),
      deliveries: await db.messageDelivery.count({ where: { salonId } }),
      recipients: await db.vipRequestRecipient.count({ where: { vipRequestId } }),
    };
    cpSync(join(migrations, '20260924120000_message_request_destination_snapshot'), join(temp, 'migrations', '20260924120000_message_request_destination_snapshot'), { recursive: true });
    deploy();

    expect(await db.messageRequest.count({ where: { salonId } })).toBe(before.requests);
    expect(await db.messageDelivery.count({ where: { salonId } })).toBe(before.deliveries);
    expect(await db.vipRequestRecipient.count({ where: { vipRequestId } })).toBe(before.recipients);
    for (const id of [queuedId, sentId, baleId]) {
      expect((await db.messageRequest.findUniqueOrThrow({ where: { id } })).recipientPhoneNumber).toBeNull();
    }
    expect((await db.messageRequest.findUniqueOrThrow({ where: { id: vipMessageId } })).recipientPhoneNumber).toBe(vipPhone);
    expect((await db.vipRequestRecipient.findUniqueOrThrow({ where: { id: recipientId } })).messageRequestId).toBe(vipMessageId);
    expect((await db.messageDelivery.findUniqueOrThrow({ where: { id: sentDeliveryId } })).submittedAt?.toISOString()).toBe('2026-09-02T12:00:00.000Z');
    const historicalVisitId = randomUUID();
    await db.visit.create({ data: {
      id: historicalVisitId, salonId, customerId,
      visitedAt: new Date('2026-09-03T10:00:00.000Z'),
    } });
    const historicalEvidence = await db.$queryRaw<Array<{ visitId: string; deliveryId: string }>>(Prisma.sql`
      WITH ${observedReturnCtes(salonId)}
      SELECT visit_id AS "visitId", delivery_id AS "deliveryId" FROM observed
    `);
    expect(historicalEvidence).toEqual([{ visitId: historicalVisitId, deliveryId: sentDeliveryId }]);
    await expect(db.messageRequest.create({ data: {
      id: randomUUID(), salonId, customerId, createdByUserId: userId, messageText: 'Missing destination',
      recipientPhoneNumber: null, messageBusinessDate: new Date('2026-09-05'), countsTowardDailyLimit: false, status: 'QUEUED',
    } })).rejects.toThrow(/Message destination snapshot is required/);

    const selectManual = new SelectMessageDeliveryModeUseCase({ client: db } as never, {} as never, { values: {} } as never);
    await expect(selectManual.execute({ adminId: platformAdminId } as never, queuedId, 'MANUAL'))
      .rejects.toThrow(/Message destination cannot be verified/);
    const event = await db.outboxEvent.create({ data: {
      id: randomUUID(), tenantId: salonId, eventType: 'MessageDeliveryActivated',
      payload: { messageDeliveryId: deliveryId, executionGeneration: 0 }, status: 'PROCESSING',
      claimGeneration: 1n, attemptCount: 1, lockedAt: new Date(), lockedUntil: new Date(Date.now() + 30_000),
    } });
    const sendText = jest.fn(async () => ({ outcome: 'sent' as const, providerMessageId: 'should-not-send' }));
    const handler = new SendCustomerMessageHandler({ client: db } as never, { sendText } as never);
    expect(await handler.handle(event, 8)).toEqual({ outcome: 'terminal_failure' });
    expect(sendText).not.toHaveBeenCalled();
    expect((await db.messageRequest.findUniqueOrThrow({ where: { id: baleId } })).status).toBe('FAILED');
    expect((await db.messageDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).failureCode).toBe('DESTINATION_UNVERIFIED');
    expect(await db.outboxEvent.count({ where: { tenantId: salonId, eventType: 'MessageSent' } })).toBe(0);
    const failedEvent = await db.outboxEvent.findFirstOrThrow({ where: { tenantId: salonId, eventType: 'MessageFailed' } });
    const failedAudit = await db.auditLog.findFirstOrThrow({ where: { tenantId: salonId, action: 'MESSAGE_FAILED', resourceId: deliveryId } });
    for (const evidence of [failedEvent.payload, failedAudit.metadata]) {
      expect(JSON.stringify(evidence)).not.toContain(oldPhone);
      expect(JSON.stringify(evidence)).not.toContain(newPhone);
      expect(JSON.stringify(evidence)).not.toContain('Historical intent');
    }
  });
});

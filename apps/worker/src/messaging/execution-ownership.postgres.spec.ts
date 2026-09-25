import { randomUUID } from 'node:crypto';
import { claimOutboxEvents, createPrismaClient } from '@salon/database';
import pino from 'pino';
import { OutboxProcessor } from '../outbox/outbox.processor';
import { SendCustomerMessageHandler } from './send-customer-message.handler';
import type { SendTextCommand, SendTextResult } from './message-sender';

// Explicit opt-in: never fall back to the application's DATABASE_URL.
const isolatedUrl = process.env.PHASE2_ISOLATED_DATABASE_URL;
const describeIsolated = isolatedUrl ? describe : describe.skip;

describeIsolated('PostgreSQL delivery execution ownership', () => {
  const db = createPrismaClient(isolatedUrl ?? 'postgresql://unused');
  const tenants: string[] = [];
  const config = { values: {
    OUTBOX_BATCH_SIZE: 2, OUTBOX_LEASE_MS: 30_000, OUTBOX_MAX_ATTEMPTS: 8,
    OUTBOX_BACKOFF_BASE_MS: 1, OUTBOX_BACKOFF_CAP_MS: 10,
  } };

  afterAll(async () => {
    for (const salonId of tenants) {
      await db.outboxEvent.deleteMany({ where: { tenantId: salonId } });
      await db.auditLog.deleteMany({ where: { tenantId: salonId } });
      await db.messageDelivery.deleteMany({ where: { salonId } });
      await db.messageRequest.deleteMany({ where: { salonId } });
      await db.customer.deleteMany({ where: { salonId } });
      await db.user.deleteMany({ where: { salonId } });
      await db.salon.delete({ where: { id: salonId } });
    }
    await db.$disconnect();
  });

  async function fixture() {
    const salonId = randomUUID(), userId = randomUUID(), customerId = randomUUID();
    const requestId = randomUUID(), deliveryId = randomUUID(), eventId = randomUUID();
    await db.salon.create({ data: { id: salonId, name: 'isolated ownership test' } });
    tenants.push(salonId);
    await db.user.create({ data: { id: userId, salonId, name: 'test', email: `${userId}@example.test`, passwordHash: 'not-used', role: 'OWNER' } });
    await db.customer.create({ data: { id: customerId, salonId, firstName: 'test', lastName: 'test', phoneNumber: '09123456789' } });
    await db.messageRequest.create({ data: {
      id: requestId, salonId, customerId, createdByUserId: userId, messageText: 'isolated fixture',
      recipientPhoneNumber: '09123456789',
      messageBusinessDate: new Date('2026-09-24'), status: 'DISPATCHED',
    } });
    await db.messageDelivery.create({ data: {
      id: deliveryId, salonId, customerId, messageRequestId: requestId, createdBy: userId,
      mode: 'BALE', provider: 'BALE_SAFIR', channel: 'TEXT', status: 'PENDING', providerRequestId: deliveryId,
    } });
    const oldest = await db.outboxEvent.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    await db.outboxEvent.create({ data: {
      id: eventId, tenantId: salonId, eventType: 'MessageDeliveryActivated',
      payload: { messageDeliveryId: deliveryId, executionGeneration: 0 },
      availableAt: new Date(0),
      createdAt: new Date((oldest?.createdAt.getTime() ?? 0) - 1_000),
    } });
    const [event] = await claimOutboxEvents(db, 1, 30_000);
    if (!event) throw new Error('Fixture event was not claimed');
    expect(event.id).toBe(eventId);
    return { salonId, requestId, deliveryId, event };
  }

  function processor(sendText: (command: SendTextCommand) => Promise<SendTextResult>) {
    const prisma = { client: db };
    const handler = new SendCustomerMessageHandler(prisma as never, { sendText } as never);
    return new OutboxProcessor(prisma as never, config as never, handler, pino({ level: 'silent' }));
  }

  async function expire(eventId: string, deliveryId: string) {
    await db.$transaction([
      db.outboxEvent.update({ where: { id: eventId }, data: { lockedUntil: new Date(0) } }),
      db.messageDelivery.update({ where: { id: deliveryId }, data: { executionLockedUntil: new Date(0) } }),
    ]);
  }

  it.each([
    ['sent', 'before'], ['failed', 'before'], ['sent', 'after'], ['failed', 'after'],
  ] as const)('rejects stale %s completion %s the new owner completes', async (outcome, order) => {
    const f = await fixture();
    let started!: () => void, finish!: (result: SendTextResult) => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const sender = jest.fn(async (_command: SendTextCommand): Promise<SendTextResult> => {
      started();
      return new Promise((resolve) => { finish = resolve; });
    });
    const oldWork = processor(sender).processOne(f.event);
    await entered;
    await expire(f.event.id, f.deliveryId);
    const [current] = await claimOutboxEvents(db, 1, 30_000);
    if (!current) throw new Error('Expired event was not reclaimed');
    expect(current.claimGeneration).toBe(f.event.claimGeneration + 1n);
    const newSender = jest.fn(async (): Promise<SendTextResult> => ({ outcome: 'sent', providerMessageId: 'current-owner' }));
    if (order === 'after') await processor(newSender).processOne(current);
    finish(outcome === 'sent' ? { outcome, providerMessageId: 'stale-owner' } : { outcome, code: 'PROVIDER_INVALID_REQUEST' });
    await oldWork;
    if (order === 'before') {
      expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: f.event.id } })).status).toBe('PROCESSING');
      expect(await db.auditLog.count({ where: { tenantId: f.salonId } })).toBe(0);
      await processor(newSender).processOne(current);
    }
    const delivery = await db.messageDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } });
    expect(delivery.status).toBe('SENT');
    expect(delivery.providerMessageId).toBe('current-owner');
    const outbox = await db.outboxEvent.findUniqueOrThrow({ where: { id: f.event.id } });
    expect(outbox.status).toBe('PROCESSED');
    expect(outbox.claimGeneration).toBe(current.claimGeneration);
    expect(await db.auditLog.count({ where: { tenantId: f.salonId, action: { in: ['MESSAGE_SENT', 'MESSAGE_FAILED'] } } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { tenantId: f.salonId, eventType: { in: ['MessageSent', 'MessageFailed'] } } })).toBe(1);
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ requestId: f.deliveryId }));
    expect(newSender).toHaveBeenCalledWith(expect.objectContaining({ requestId: f.deliveryId }));
  });

  it('leaves an expired unfinished delivery reclaimable without acknowledging it', async () => {
    const f = await fixture();
    const sender = jest.fn(async (): Promise<SendTextResult> => {
      await expire(f.event.id, f.deliveryId);
      return { outcome: 'sent', providerMessageId: 'expired' };
    });
    await processor(sender).processOne(f.event);
    expect((await db.messageDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).status).toBe('PROCESSING');
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: f.event.id } })).status).toBe('PROCESSING');
    expect(await db.auditLog.count({ where: { tenantId: f.salonId } })).toBe(0);
    const [current] = await claimOutboxEvents(db, 1, 30_000);
    if (!current) throw new Error('Expired event was not reclaimed');
    expect(current.id).toBe(f.event.id);
    await processor(async () => ({ outcome: 'sent', providerMessageId: 'recovered' })).processOne(current);
    expect((await db.messageDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).status).toBe('SENT');
  });

  it('rolls back request terminal state when the delivery token conditional update affects zero rows', async () => {
    const f = await fixture();
    await processor(async () => {
      await db.messageDelivery.update({ where: { id: f.deliveryId }, data: { executionToken: 'other-owner' } });
      return { outcome: 'sent', providerMessageId: 'stale' };
    }).processOne(f.event);
    expect((await db.messageRequest.findUniqueOrThrow({ where: { id: f.requestId } })).status).toBe('DISPATCHED');
    expect((await db.messageDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).status).toBe('PROCESSING');
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: f.event.id } })).status).toBe('PROCESSING');
    expect(await db.auditLog.count({ where: { tenantId: f.salonId } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { tenantId: f.salonId, eventType: { in: ['MessageSent', 'MessageFailed'] } } })).toBe(0);
  });
});

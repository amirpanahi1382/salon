import { randomUUID } from 'node:crypto';
import {
  blockUnsentMessagesForPhone,
  createPrismaClient,
  isActivePlatformMessageStop,
  lockPlatformMessagePhone,
  PLATFORM_MESSAGE_STOP_REASON,
} from '@salon/database';
import { SendCustomerMessageHandler } from './send-customer-message.handler';
import type { SendTextResult } from './message-sender';

const expectedName = process.env.MESSAGE_STOP_E2E_DATABASE_NAME ?? '';
const expectedPort = process.env.MESSAGE_STOP_E2E_HOST_PORT ?? '';
const expectedSystemIdentifier = process.env.MESSAGE_STOP_E2E_SYSTEM_IDENTIFIER ?? '';
const expectedComment = process.env.MESSAGE_STOP_E2E_DATABASE_COMMENT ?? '';
const proofRequested = Boolean(expectedName && expectedPort && expectedSystemIdentifier && expectedComment);
const FORBIDDEN_PORTS = new Set(['5432', '15442']);

function databaseTarget(): { url: string; name: string; port: string } {
  const raw = process.env.MESSAGE_STOP_DISPOSABLE_DATABASE_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('message-stop worker spec refused an unreadable database target');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, '').split('?')[0] ?? '');
  const port = url.port;
  const host = url.hostname;
  if (name === 'salon' || name === 'salon_preview') {
    throw new Error('message-stop worker spec refused a persistent database name');
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('message-stop worker spec refused a non-loopback database host');
  }
  if (!port || FORBIDDEN_PORTS.has(port)) {
    throw new Error('message-stop worker spec refused a persistent or preview database port');
  }
  if (!name.startsWith('salon_message_stop_') || name !== expectedName || port !== expectedPort) {
    throw new Error('message-stop worker spec database target does not match the explicit disposable proof');
  }
  return { url: raw, name, port };
}

if (proofRequested) {
  databaseTarget();
}

async function proveDisposableIdentity(): Promise<string> {
  const target = databaseTarget();
  const db = createPrismaClient(target.url);
  try {
    const rows = await db.$queryRaw<Array<{ current: string; sid: bigint; comment: string | null }>>`
      SELECT current_database() AS current,
             (SELECT system_identifier FROM pg_control_system()) AS sid,
             (
               SELECT shobj_description(d.oid, 'pg_database')
               FROM pg_database d
               WHERE d.datname = current_database()
             ) AS comment
    `;
    const row = rows[0];
    if (!row || row.current !== expectedName) {
      throw new Error('message-stop worker spec connected database does not match the explicit name');
    }
    if (String(row.sid) !== expectedSystemIdentifier || row.comment !== expectedComment) {
      throw new Error('message-stop worker spec database identity proof did not match');
    }
  } finally {
    await db.$disconnect();
  }
  return target.url;
}

const describeStop = proofRequested ? describe : describe.skip;

describeStop('platform message stop before provider call', () => {
  let db!: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    db = createPrismaClient(await proveDisposableIdentity());
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function delivery(phone: string) {
    const salonId = randomUUID();
    const userId = randomUUID();
    const customerId = randomUUID();
    const requestId = randomUUID();
    const deliveryId = randomUUID();
    const eventId = randomUUID();
    const adminId = randomUUID();
    await db.platformAdmin.create({
      data: {
        id: adminId,
        email: `${adminId}@example.test`,
        name: 'stop',
        passwordHash: 'not-used',
        updatedAt: new Date(),
      },
    });
    await db.salon.create({ data: { id: salonId, name: 'stop salon', updatedAt: new Date() } });
    await db.user.create({
      data: {
        id: userId,
        salonId,
        name: 'owner',
        email: `${userId}@example.test`,
        passwordHash: 'not-used',
        role: 'OWNER',
        updatedAt: new Date(),
      },
    });
    await db.customer.create({
      data: { id: customerId, salonId, firstName: 'a', lastName: 'b', phoneNumber: phone },
    });
    await db.messageRequest.create({
      data: {
        id: requestId,
        salonId,
        customerId,
        createdByUserId: userId,
        messageText: 'fixture',
        recipientPhoneNumber: phone,
        messageBusinessDate: new Date('2026-10-12'),
        status: 'DISPATCHED',
        updatedAt: new Date(),
      },
    });
    await db.messageDelivery.create({
      data: {
        id: deliveryId,
        salonId,
        customerId,
        messageRequestId: requestId,
        createdBy: userId,
        mode: 'BALE',
        provider: 'BALE_SAFIR',
        channel: 'TEXT',
        status: 'PENDING',
        providerRequestId: deliveryId,
        updatedAt: new Date(),
      },
    });
    await db.outboxEvent.create({
      data: {
        id: eventId,
        tenantId: salonId,
        eventType: 'MessageDeliveryActivated',
        payload: { messageDeliveryId: deliveryId, messageRequestId: requestId, executionGeneration: 0 },
        status: 'PROCESSING',
        claimGeneration: 1n,
        lockedUntil: new Date(Date.now() + 30_000),
        availableAt: new Date(),
      },
    });
    const event = await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    return { adminId, phone, requestId, deliveryId, event };
  }

  async function register(adminId: string, phone: string) {
    const now = new Date();
    await db.$transaction(async (tx) => {
      await lockPlatformMessagePhone(tx, phone);
      const stop = await tx.platformMessageStop.create({
        data: {
          id: randomUUID(),
          phoneNumber: phone,
          active: true,
          reasonCode: PLATFORM_MESSAGE_STOP_REASON,
          registeredByAdminId: adminId,
          registeredAt: now,
          updatedAt: now,
        },
      });
      await tx.platformMessageStopEvent.create({
        data: {
          id: randomUUID(),
          stopId: stop.id,
          phoneNumber: phone,
          action: 'REGISTERED',
          reasonCode: PLATFORM_MESSAGE_STOP_REASON,
          actorAdminId: adminId,
          createdAt: now,
        },
      });
      await blockUnsentMessagesForPhone(tx, phone, now);
    });
  }

  it('does not call the provider when the stop is already committed', async () => {
    const fixture = await delivery(`0916${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`);
    const now = new Date();
    await db.platformMessageStop.create({
      data: {
        id: randomUUID(),
        phoneNumber: fixture.phone,
        active: true,
        reasonCode: PLATFORM_MESSAGE_STOP_REASON,
        registeredByAdminId: fixture.adminId,
        registeredAt: now,
        updatedAt: now,
      },
    });
    const sendText = jest.fn(async (): Promise<SendTextResult> => ({ outcome: 'sent', providerMessageId: 'p' }));
    const handler = new SendCustomerMessageHandler({ client: db } as never, { sendText } as never);
    const result = await handler.handle(fixture.event, 8);
    expect(result.outcome).toBe('blocked');
    expect(sendText).not.toHaveBeenCalled();
    const request = await db.messageRequest.findUniqueOrThrow({ where: { id: fixture.requestId } });
    const row = await db.messageDelivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });
    expect(request.status).toBe('CANCELLED');
    expect(row.status).not.toBe('SENT');
    expect(row.submittedAt).toBeNull();
  });

  it('keeps SENT when the provider call started before the stop could take the lock', async () => {
    const fixture = await delivery(`0917${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const sendText = jest.fn(async (): Promise<SendTextResult> => {
      entered();
      await gate;
      return { outcome: 'sent', providerMessageId: 'accepted' };
    });
    const handler = new SendCustomerMessageHandler({ client: db } as never, { sendText } as never);
    const running = handler.handle(fixture.event, 8);
    await started;
    const stopping = register(fixture.adminId, fixture.phone);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await isActivePlatformMessageStop(db, fixture.phone)).toBe(false);
    release();
    await running;
    await stopping;
    const request = await db.messageRequest.findUniqueOrThrow({ where: { id: fixture.requestId } });
    const row = await db.messageDelivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });
    expect(request.status).toBe('SENT');
    expect(row.status).toBe('SENT');
    expect(row.submittedAt).not.toBeNull();
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('lets a committed stop win over a waiting manual action without deadlock', async () => {
    const fixture = await delivery(`0918${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`);
    let holding!: () => void;
    const held = new Promise<void>((resolve) => { holding = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const now = new Date();
    const stopping = db.$transaction(async (tx) => {
      await lockPlatformMessagePhone(tx, fixture.phone);
      await tx.platformMessageStop.create({
        data: {
          id: randomUUID(),
          phoneNumber: fixture.phone,
          active: true,
          reasonCode: PLATFORM_MESSAGE_STOP_REASON,
          registeredByAdminId: fixture.adminId,
          registeredAt: now,
          updatedAt: now,
        },
      });
      await blockUnsentMessagesForPhone(tx, fixture.phone, now);
      holding();
      await gate;
    }, { timeout: 15_000 });
    await held;
    const manual = db.$transaction(async (tx) => {
      await lockPlatformMessagePhone(tx, fixture.phone);
      const active = await isActivePlatformMessageStop(tx, fixture.phone);
      await tx.$queryRaw`SELECT id FROM message_requests WHERE id = ${fixture.requestId}::uuid FOR UPDATE`;
      const request = await tx.messageRequest.findUniqueOrThrow({ where: { id: fixture.requestId } });
      return { active, status: request.status };
    }, { timeout: 15_000 });
    release();
    await stopping;
    await expect(manual).resolves.toEqual({ active: true, status: 'CANCELLED' });
    const row = await db.messageDelivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });
    expect(row.status).not.toBe('SENT');
    expect(row.submittedAt).toBeNull();
  });

  it('does not include a stop that commits only after an export-style phone lock', async () => {
    const phone = `0919${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`;
    const adminId = randomUUID();
    await db.platformAdmin.create({
      data: { id: adminId, email: `${adminId}@example.test`, name: 'stop', passwordHash: 'not-used', updatedAt: new Date() },
    });
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => { locked = resolve; });
    let readNow!: () => void;
    const readGate = new Promise<void>((resolve) => { readNow = resolve; });
    const exporting = db.$transaction(async (tx) => {
      await lockPlatformMessagePhone(tx, phone);
      locked();
      await readGate;
      return isActivePlatformMessageStop(tx, phone);
    }, { timeout: 15_000 });
    await hasLock;
    const stopping = register(adminId, phone);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await isActivePlatformMessageStop(db, phone)).toBe(false);
    readNow();
    await expect(exporting).resolves.toBe(false);
    await stopping;
    expect(await isActivePlatformMessageStop(db, phone)).toBe(true);
  });

  it('aborts a slow provider inside the lease budget and then accepts the stop', async () => {
    const fixture = await delivery(`0912${Math.floor(Math.random() * 1_000_0000).toString().padStart(7, '0')}`);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const sendText = jest.fn(async (input: { signal?: AbortSignal }): Promise<SendTextResult> => {
      entered();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 10_000);
        input.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('provider-aborted'));
        });
      });
      return { outcome: 'sent', providerMessageId: 'late' };
    });
    const handler = new SendCustomerMessageHandler(
      { client: db } as never,
      { sendText } as never,
      { values: { OUTBOX_LEASE_MS: 8_000, BALE_SAFIR_TIMEOUT_MS: 60_000 } } as never,
    );
    const running = handler.handle(fixture.event, 8);
    await started;
    const stopping = register(fixture.adminId, fixture.phone);
    await expect(running).rejects.toThrow('provider-aborted');
    await stopping;
    const request = await db.messageRequest.findUniqueOrThrow({ where: { id: fixture.requestId } });
    const row = await db.messageDelivery.findUniqueOrThrow({ where: { id: fixture.deliveryId } });
    expect(request.status).toBe('CANCELLED');
    expect(row.status).not.toBe('SENT');
    expect(row.submittedAt).toBeNull();
    expect(sendText).toHaveBeenCalledTimes(1);
  }, 15_000);
});

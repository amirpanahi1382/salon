import type { OutboxEvent } from '@salon/database';
import { DOMAIN_EVENT_TYPES } from '@salon/shared';
import { SendCustomerMessageHandler } from './send-customer-message.handler';

type DeliveryRow = {
  id: string;
  salonId: string;
  mode: 'BALE' | 'MANUAL';
  messageRequestId: string;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  executionGeneration: number;
  executionToken: string | null;
  executionLockedUntil: Date | null;
  failedAt: Date | null;
  failureCode: string | null;
  submittedAt: Date | null;
  providerMessageId?: string | null;
  updatedAt: Date;
  providerRequestId: string;
  createdBy: string;
  customer: { phoneNumber: string };
  messageRequest: { id: string; messageText: string; recipientPhoneNumber: string | null; vipRequestId?: string | null; status?: string };
};

function fakePrisma(rows: DeliveryRow[]) {
  const ownerLock = jest.fn(async (): Promise<Array<{ id: string }>> => [{ id: 'event' }]);
  const messageDelivery = {
    findFirst: async ({ where }: { where: { id: string; salonId: string } }) =>
      rows.find((row) => row.id === where.id && row.salonId === where.salonId) ?? null,
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; salonId: string; status?: string | { in?: string[] }; mode?: string; executionToken?: string; executionGeneration?: number; OR?: Array<Record<string, unknown>> };
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const row of rows) {
        if (row.id !== where.id || row.salonId !== where.salonId) {
          continue;
        }
        if (where.mode && row.mode !== where.mode) {
          continue;
        }
        if (typeof where.status !== 'string' && where.status?.in && !where.status.in.includes(row.status)) {
          continue;
        }
        if (typeof where.status === 'string' && row.status !== where.status) continue;
        if (where.executionToken && row.executionToken !== where.executionToken) continue;
        if (where.executionGeneration !== undefined && row.executionGeneration !== where.executionGeneration) continue;
        const currentTokenOwns = where.OR?.some((clause) => clause.executionToken === row.executionToken) ?? false;
        if (where.OR && row.status === 'PROCESSING' && !currentTokenOwns && row.executionLockedUntil && row.executionLockedUntil >= new Date()) continue;
        if (where.OR && row.status !== 'PENDING' && row.status !== 'PROCESSING') continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
  };
  const messageRequest = {
    updateMany: async () => ({ count: 1 }),
  };
  const extras = {
    outboxEvent: { findFirst: jest.fn(async () => ({ id: 'event' })), create: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const client = {
    messageDelivery,
    messageRequest,
    ...extras,
    $transaction: async (
      fn: (tx: {
        messageDelivery: typeof messageDelivery;
        messageRequest: typeof messageRequest;
        $queryRaw: () => Promise<Array<{ id: string }>>;
        outboxEvent: { findFirst: () => Promise<unknown>; create: () => Promise<unknown> };
        auditLog: { create: () => Promise<unknown> };
      }) => Promise<unknown>,
    ) => fn({ messageDelivery, messageRequest, $queryRaw: ownerLock, ...extras }),
  };
  return { client, ownerLock };
}

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    eventType: DOMAIN_EVENT_TYPES.MessageSendRequested,
    dedupeKey: null,
    payload: { messageDeliveryId: 'm1' },
    status: 'PROCESSING',
    attemptCount: 1,
    claimGeneration: 1n,
    availableAt: new Date(),
    lockedAt: new Date(),
    lockedUntil: new Date(Date.now() + 30_000),
    processedAt: null,
    lastError: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function row(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: 'm1',
    salonId: event().tenantId!,
    status: 'PENDING',
    executionGeneration: 0,
    executionToken: null,
    executionLockedUntil: null,
    failedAt: null,
    failureCode: null,
    submittedAt: null,
    providerMessageId: null,
    updatedAt: new Date(0),
    providerRequestId: 'm1',
    createdBy: '33333333-3333-4333-8333-333333333333',
    customer: { phoneNumber: '09123456789' },
    mode: 'BALE',
    messageRequestId: 'r1',
    messageRequest: { id: 'r1', messageText: 'hello', recipientPhoneNumber: '09123456789', status: 'DISPATCHED' },
    ...overrides,
  };
}

describe('SendCustomerMessageHandler.abandonIfInFlight', () => {
  it('transitions PENDING to FAILED with failedAt', async () => {
    const delivery = row({ status: 'PENDING' });
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, {} as never);
    await handler.abandonIfInFlight(event(), 'PROVIDER_UNKNOWN');
    expect(delivery.status).toBe('FAILED');
    expect(delivery.failureCode).toBe('PROVIDER_UNKNOWN');
    expect(delivery.failedAt).toBeInstanceOf(Date);
  });

  it('does not change SENT deliveries', async () => {
    const sentAt = new Date('2026-01-01T00:00:00.000Z');
    const delivery = row({ status: 'SENT', submittedAt: sentAt });
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, {} as never);
    await handler.abandonIfInFlight(event(), 'PROVIDER_UNKNOWN');
    expect(delivery.status).toBe('SENT');
    expect(delivery.failedAt).toBeNull();
    expect(delivery.failureCode).toBeNull();
    expect(delivery.submittedAt).toBe(sentAt);
  });

  it('does not change already FAILED deliveries', async () => {
    const failedAt = new Date('2026-01-02T00:00:00.000Z');
    const delivery = row({
      status: 'FAILED',
      failedAt,
      failureCode: 'PROVIDER_AUTH',
    });
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, {} as never);
    await handler.abandonIfInFlight(event(), 'PROVIDER_UNKNOWN');
    expect(delivery.status).toBe('FAILED');
    expect(delivery.failureCode).toBe('PROVIDER_AUTH');
    expect(delivery.failedAt).toBe(failedAt);
  });

  it('does not modify another tenant MessageDelivery', async () => {
    const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const delivery = row({ salonId: tenantB, status: 'PROCESSING' });
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, {} as never);
    await handler.abandonIfInFlight(event(), 'PROVIDER_UNKNOWN');
    expect(delivery.status).toBe('PROCESSING');
    expect(delivery.failedAt).toBeNull();
  });
});

describe('SendCustomerMessageHandler.handle races', () => {
  it('sends to the immutable request destination after the Customer phone changes', async () => {
    const delivery = row({
      customer: { phoneNumber: '09129999999' },
      messageRequest: { id: 'r1', messageText: 'hello', recipientPhoneNumber: '09121111111', status: 'DISPATCHED' },
    });
    const sender = { sendText: jest.fn().mockResolvedValue({ outcome: 'sent', providerMessageId: 'p1' }) };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    await expect(handler.handle(event(), 8)).resolves.toEqual({ outcome: 'completed' });
    expect(sender.sendText).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumber: '09121111111', requestId: delivery.providerRequestId,
    }));
    expect(sender.sendText).not.toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: '09129999999' }));
  });

  it('fails an unverified historical destination without contacting the provider', async () => {
    const delivery = row({ messageRequest: {
      id: 'r1', messageText: 'hello', recipientPhoneNumber: null, status: 'DISPATCHED',
    } });
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    await expect(handler.handle(event(), 8)).resolves.toEqual({ outcome: 'terminal_failure' });
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(delivery.status).toBe('FAILED');
    expect(delivery.failureCode).toBe('DESTINATION_UNVERIFIED');
  });
  it('does not send again when the delivery is already SENT', async () => {
    const delivery = row({ status: 'SENT', submittedAt: new Date() });
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    await handler.handle(event(), 8);
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(delivery.status).toBe('SENT');
  });

  it('does not call Safir for a VIP MessageRequest', async () => {
    const delivery = row({
      status: 'PENDING',
      messageRequest: { id: 'r1', messageText: 'vip', recipientPhoneNumber: '09123456789', vipRequestId: 'v1' },
    });
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    await handler.handle(event(), 8);
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(delivery.status).toBe('FAILED');
  });

  it('does not send again when the delivery is already FAILED', async () => {
    const delivery = row({
      status: 'FAILED',
      failedAt: new Date(),
      failureCode: 'PROVIDER_UNKNOWN',
    });
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    await handler.handle(event(), 8);
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(delivery.status).toBe('FAILED');
  });

  it('retries a genuine retryable failure without failing the delivery', async () => {
    const delivery = row({ status: 'PENDING' });
    const sender = {
      sendText: jest.fn().mockResolvedValue({ outcome: 'retryable', code: 'PROVIDER_TEMPORARY' }),
    };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    await expect(handler.handle(event({ attemptCount: 1 }), 8)).rejects.toMatchObject({
      code: 'PROVIDER_TEMPORARY',
    });
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(delivery.status).toBe('PENDING');
    expect(delivery.failedAt).toBeNull();
  });

  it('records SENT when the provider accepts after a delayed response', async () => {
    const delivery = row({ status: 'PENDING' });
    let resolveSend: ((value: { outcome: 'sent'; providerMessageId: string }) => void) | undefined;
    const sender = {
      sendText: jest.fn(
        () =>
          new Promise<{ outcome: 'sent'; providerMessageId: string }>((resolve) => {
            resolveSend = resolve;
          }),
      ),
    };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    const pending = handler.handle(event(), 8);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(delivery.status).toBe('PROCESSING');
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    resolveSend?.({ outcome: 'sent', providerMessageId: 'p-1' });
    await pending;
    expect(delivery.status).toBe('SENT');
    expect(delivery.submittedAt).toBeInstanceOf(Date);
  });

  it('does not apply a late sent result after FAILED', async () => {
    const delivery = row({ status: 'PENDING' });
    let resolveSend: ((value: { outcome: 'sent'; providerMessageId: string }) => void) | undefined;
    const sender = {
      sendText: jest.fn(
        () =>
          new Promise<{ outcome: 'sent'; providerMessageId: string }>((resolve) => {
            resolveSend = resolve;
          }),
      ),
    };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    const pending = handler.handle(event(), 8);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await handler.abandonIfInFlight(event(), 'PROVIDER_UNKNOWN');
    expect(delivery.status).toBe('FAILED');
    resolveSend?.({ outcome: 'sent', providerMessageId: 'p-late' });
    await pending;
    expect(delivery.status).toBe('FAILED');
    expect(delivery.failureCode).toBe('PROVIDER_UNKNOWN');
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });

  it('does not call the provider when PROCESSING cannot be claimed', async () => {
    const delivery = row({ status: 'PENDING' });
    const prisma = fakePrisma([delivery]);
    prisma.client.messageDelivery.updateMany = async () => ({ count: 0 });
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(prisma as never, sender as never);
    await expect(handler.handle(event(), 8)).resolves.toEqual({ outcome: 'stale' });
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  it('does not send when the MessageRequest is already CANCELLED', async () => {
    const delivery = row({
      status: 'PENDING',
      messageRequest: { id: 'r1', messageText: 'hello', recipientPhoneNumber: '09123456789', status: 'CANCELLED' },
    });
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(
      fakePrisma([delivery]) as never,
      sender as never,
    );
    await handler.handle(event(), 8);
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(delivery.status).toBe('PENDING');
  });

  it('treats timeout abort as retryable and keeps PROCESSING', async () => {
    const abort = new AbortController();
    abort.abort();
    const delivery = row({ status: 'PENDING' });
    const sender = {
      sendText: jest.fn().mockResolvedValue({
        outcome: 'retryable',
        code: 'PROVIDER_TEMPORARY',
      }),
    };
    const handler = new SendCustomerMessageHandler(
      fakePrisma([delivery]) as never,
      sender as never,
    );
    await expect(
      handler.handle(event({ attemptCount: 1 }), 8, abort.signal),
    ).rejects.toMatchObject({
      code: 'PROVIDER_UNKNOWN',
    });
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(delivery.status).toBe('PROCESSING');
    expect(delivery.failedAt).toBeNull();
  });

  it('retries a PROCESSING delivery after a timeout without creating a new send', async () => {
    const delivery = row({ status: 'PROCESSING', executionLockedUntil: new Date(Date.now() - 1_000) });
    const sender = {
      sendText: jest.fn().mockResolvedValue({
        outcome: 'retryable',
        code: 'PROVIDER_TEMPORARY',
      }),
    };
    const handler = new SendCustomerMessageHandler(
      fakePrisma([delivery]) as never,
      sender as never,
    );
    await expect(handler.handle(event({ attemptCount: 2 }), 8)).rejects.toMatchObject({
      code: 'PROVIDER_TEMPORARY',
    });
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(sender.sendText.mock.calls[0][0].requestId).toBe(delivery.providerRequestId);
    expect(delivery.status).toBe('PENDING');
  });

  it('replays a duplicate handle after SENT without sending again', async () => {
    const delivery = row({
      status: 'SENT',
      submittedAt: new Date(),
      providerMessageId: 'p-1',
    });
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(
      fakePrisma([delivery]) as never,
      sender as never,
    );
    await handler.handle(event(), 8);
    await handler.handle(event(), 8);
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(delivery.status).toBe('SENT');
  });

  it('does not call Bale for MANUAL deliveries', async () => {
    const delivery = row({ mode: 'MANUAL' });
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    await handler.handle(event(), 8);
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(delivery.status).toBe('PENDING');
  });

  it('allows only one simultaneous handler to claim and call the provider', async () => {
    const delivery = row({ status: 'PENDING' });
    const sender = {
      sendText: jest.fn().mockResolvedValue({ outcome: 'sent', providerMessageId: 'provider-1' }),
    };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    const results = await Promise.allSettled([handler.handle(event(), 8), handler.handle(event(), 8)]);
    expect(results).toEqual(expect.arrayContaining([
      { status: 'fulfilled', value: { outcome: 'completed' } },
      { status: 'fulfilled', value: { outcome: 'stale' } },
    ]));
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(sender.sendText).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'm1' }));
    expect(delivery.status).toBe('SENT');
  });

  it('does not call the provider after the outbox claim is stale', async () => {
    const delivery = row({ status: 'PENDING' });
    const prisma = fakePrisma([delivery]);
    prisma.client.outboxEvent.findFirst.mockResolvedValue(null as never);
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(prisma as never, sender as never);
    await expect(handler.handle(event(), 8)).resolves.toEqual({ outcome: 'stale' });
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  it('writes no terminal evidence after losing delivery ownership', async () => {
    const delivery = row({ status: 'PENDING' });
    const prisma = fakePrisma([delivery]);
    const sender = {
      sendText: jest.fn().mockImplementation(async () => {
        delivery.executionToken = 'reclaimed-owner';
        return { outcome: 'sent', providerMessageId: 'late-provider-result' };
      }),
    };
    const handler = new SendCustomerMessageHandler(prisma as never, sender as never);
    await expect(handler.handle(event(), 8)).resolves.toEqual({ outcome: 'stale' });
    expect(delivery.status).toBe('PROCESSING');
    expect(delivery.submittedAt).toBeNull();
    expect(prisma.client.outboxEvent.create).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['sent', 'failed'] as const)('returns stale without %s evidence when the lease expires during the provider call', async (outcome) => {
    const delivery = row({ status: 'PENDING' });
    const prisma = fakePrisma([delivery]);
    const sender = { sendText: jest.fn(async () => {
      prisma.ownerLock.mockResolvedValue([]);
      return outcome === 'sent'
        ? { outcome, providerMessageId: 'late-result' }
        : { outcome, code: 'PROVIDER_INVALID_REQUEST' };
    }) };
    const handler = new SendCustomerMessageHandler(prisma as never, sender as never);
    await expect(handler.handle(event(), 8)).resolves.toEqual({ outcome: 'stale' });
    expect(delivery.status).toBe('PROCESSING');
    expect(prisma.client.outboxEvent.create).not.toHaveBeenCalled();
    expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('keeps the reclaimed owner authoritative when the original provider call returns late', async () => {
    const delivery = row({ status: 'PENDING' });
    const prisma = fakePrisma([delivery]);
    let finishOld!: (value: unknown) => void;
    const sender = { sendText: jest.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValue({ outcome: 'sent', providerMessageId: 'new-owner-result' }) };
    const handler = new SendCustomerMessageHandler(prisma as never, sender as never);
    const old = handler.handle(event(), 8);
    await new Promise<void>((resolve) => setImmediate(resolve));
    delivery.executionLockedUntil = new Date(0);
    await expect(handler.handle(event({ claimGeneration: 2n }), 8)).resolves.toEqual({ outcome: 'completed' });
    prisma.ownerLock.mockResolvedValue([]);
    finishOld({ outcome: 'sent', providerMessageId: 'old-owner-result' });
    await expect(old).resolves.toEqual({ outcome: 'stale' });
    expect(delivery.providerMessageId).toBe('new-owner-result');
    expect(delivery.status).toBe('SENT');
    expect(prisma.client.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
    expect(sender.sendText.mock.calls.map(([command]) => command.requestId)).toEqual(['m1', 'm1']);
  });
});

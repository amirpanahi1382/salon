import type { OutboxEvent } from '@salon/database';
import { DOMAIN_EVENT_TYPES } from '@salon/shared';
import { SendCustomerMessageHandler } from './send-customer-message.handler';

type DeliveryRow = {
  id: string;
  salonId: string;
  mode: 'BALE' | 'MANUAL';
  messageRequestId: string;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  failedAt: Date | null;
  failureCode: string | null;
  submittedAt: Date | null;
  providerMessageId?: string | null;
  updatedAt: Date;
  providerRequestId: string;
  createdBy: string;
  customer: { phoneNumber: string };
  messageRequest: { id: string; messageText: string };
};

function fakePrisma(rows: DeliveryRow[]) {
  const messageDelivery = {
    findFirst: async ({ where }: { where: { id: string; salonId: string } }) =>
      rows.find((row) => row.id === where.id && row.salonId === where.salonId) ?? null,
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; salonId: string; status?: { in: string[] }; mode?: string };
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
        if (where.status?.in && !where.status.in.includes(row.status)) {
          continue;
        }
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
    outboxEvent: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
  };
  const client = {
    messageDelivery,
    messageRequest,
    ...extras,
    $transaction: async (
      fn: (tx: {
        messageDelivery: typeof messageDelivery;
        messageRequest: typeof messageRequest;
        outboxEvent: { create: () => Promise<unknown> };
        auditLog: { create: () => Promise<unknown> };
      }) => Promise<unknown>,
    ) => fn({ messageDelivery, messageRequest, ...extras }),
  };
  return { client };
}

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    eventType: DOMAIN_EVENT_TYPES.MessageSendRequested,
    payload: { messageDeliveryId: 'm1' },
    status: 'PROCESSING',
    attemptCount: 1,
    availableAt: new Date(),
    lockedAt: new Date(),
    lockedUntil: new Date(),
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
    messageRequest: { id: 'r1', messageText: 'hello' },
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
  it('does not send again when the delivery is already SENT', async () => {
    const delivery = row({ status: 'SENT', submittedAt: new Date() });
    const sender = { sendText: jest.fn() };
    const handler = new SendCustomerMessageHandler(fakePrisma([delivery]) as never, sender as never);
    await handler.handle(event(), 8);
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(delivery.status).toBe('SENT');
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
    expect(delivery.status).toBe('PROCESSING');
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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
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
    await handler.handle(event(), 8);
    expect(sender.sendText).not.toHaveBeenCalled();
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
    const delivery = row({ status: 'PROCESSING' });
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
    expect(delivery.status).toBe('PROCESSING');
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
});

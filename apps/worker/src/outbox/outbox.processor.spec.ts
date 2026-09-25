import {
  claimOutboxEvents,
  markOutboxDeadLetter,
  markOutboxProcessed,
  markOutboxRetry,
  type OutboxEvent,
} from '@salon/database';
import { DOMAIN_EVENT_TYPES } from '@salon/shared';
import type { AppConfig } from '@salon/config';
import pino from 'pino';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RetryableMessageSendError } from '../messaging/message-sender';
import { SendCustomerMessageHandler } from '../messaging/send-customer-message.handler';
import { handlerTimeoutMs, OutboxProcessor } from './outbox.processor';

jest.mock('@salon/database', () => ({
  claimOutboxEvents: jest.fn(),
  markOutboxDeadLetter: jest.fn(),
  markOutboxProcessed: jest.fn(),
  markOutboxRetry: jest.fn(),
}));

const claim = claimOutboxEvents as jest.MockedFunction<typeof claimOutboxEvents>;
const deadLetter = markOutboxDeadLetter as jest.MockedFunction<typeof markOutboxDeadLetter>;
const processed = markOutboxProcessed as jest.MockedFunction<typeof markOutboxProcessed>;
const retry = markOutboxRetry as jest.MockedFunction<typeof markOutboxRetry>;

beforeEach(() => {
  deadLetter.mockResolvedValue(true);
  processed.mockResolvedValue(true);
  retry.mockResolvedValue(true);
});

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    eventType: DOMAIN_EVENT_TYPES.VisitCompleted,
    dedupeKey: null,
    payload: { visitId: 'v1' },
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

describe('OutboxProcessor', () => {
  const logger = pino({ level: 'silent' });
  const prisma = { client: {} } as PrismaService;
  const config = {
    values: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      OUTBOX_BATCH_SIZE: 10,
      OUTBOX_LEASE_MS: 30_000,
      OUTBOX_MAX_ATTEMPTS: 2,
      OUTBOX_BACKOFF_BASE_MS: 10,
      OUTBOX_BACKOFF_CAP_MS: 20,
      OUTBOX_POLL_INTERVAL_MS: 60_000,
    } as AppConfig,
  } as AppConfigService;

  let processor: OutboxProcessor;
  const sendCustomerMessage = {
    handle: jest.fn().mockResolvedValue({ outcome: 'completed' }),
    abandonIfInFlight: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    deadLetter.mockResolvedValue(true);
    processed.mockResolvedValue(true);
    retry.mockResolvedValue(true);
    sendCustomerMessage.handle.mockReset().mockResolvedValue({ outcome: 'completed' });
    processor = new OutboxProcessor(
      prisma,
      config,
      sendCustomerMessage as never,
      logger,
    );
  });

  it('dead-letters unknown event types instead of marking them processed', async () => {
    await processor.processOne(event({ eventType: 'NotARealEvent' }));
    expect(deadLetter).toHaveBeenCalledWith(prisma.client, event().id, 1n, 'UNKNOWN_EVENT_TYPE');
    expect(processed).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('marks known events processed', async () => {
    await processor.processOne(event());
    expect(processed).toHaveBeenCalledWith(prisma.client, event().id, 1n);
    expect(deadLetter).not.toHaveBeenCalled();
    expect(sendCustomerMessage.handle).not.toHaveBeenCalled();
  });

  it('routes MessageSendRequested to the messaging handler', async () => {
    await processor.processOne(
      event({ eventType: DOMAIN_EVENT_TYPES.MessageSendRequested, payload: { messageDeliveryId: 'm1' } }),
    );
    expect(sendCustomerMessage.handle).toHaveBeenCalled();
    expect(processed).toHaveBeenCalled();
  });

  it('routes MessageDeliveryActivated to the messaging handler', async () => {
    await processor.processOne(
      event({
        eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated,
        payload: { messageDeliveryId: 'm1' },
      }),
    );
    expect(sendCustomerMessage.handle).toHaveBeenCalled();
    expect(processed).toHaveBeenCalled();
  });

  it.each(['success', 'retry', 'destination_rejected'] as const)(
    'does not log destination PII for %s execution', async (outcome) => {
      const logs: string[] = [];
      const capturedLogger = pino({ level: 'trace' }, { write: (line: string) => { logs.push(line); } } as never);
      const captured = new OutboxProcessor(prisma, config, sendCustomerMessage as never, capturedLogger);
      if (outcome === 'retry') {
        sendCustomerMessage.handle.mockRejectedValueOnce(new RetryableMessageSendError('PROVIDER_TEMPORARY'));
      } else {
        sendCustomerMessage.handle.mockResolvedValueOnce({
          outcome: outcome === 'success' ? 'completed' : 'terminal_failure',
        });
      }
      await captured.processOne(event({ eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated,
        payload: { messageDeliveryId: 'm1', executionGeneration: 0, recipientPhoneNumber: '09121111111', messageText: 'private message body' },
      }));
      const serialized = logs.join('');
      expect(serialized).not.toContain('09121111111');
      expect(serialized).not.toContain('private message body');
      expect(serialized).toContain('outbox.consume');
      if (outcome === 'retry') expect(retry).toHaveBeenCalled();
    },
  );

  it('retries handler failures below max attempts', async () => {
    jest.spyOn(processor as never, 'consume').mockRejectedValue(new Error('boom') as never);
    await processor.processOne(event({ attemptCount: 1 }));
    expect(retry).toHaveBeenCalled();
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it('dead-letters after max attempts', async () => {
    jest.spyOn(processor as never, 'consume').mockRejectedValue(new Error('boom') as never);
    await processor.processOne(event({ attemptCount: 2 }));
    expect(deadLetter).toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('does not claim new events after shutdown', async () => {
    await processor.onModuleDestroy();
    await processor.tick();
    expect(claim).not.toHaveBeenCalled();
  });

  it('uses a handler timeout below the lease duration', () => {
    expect(handlerTimeoutMs(30_000)).toBe(24_000);
    expect(handlerTimeoutMs(30_000)).toBeLessThan(30_000);
  });

  it('leaves an unfinished stale delivery event reclaimable, even on the last attempt', async () => {
    sendCustomerMessage.handle.mockResolvedValue({ outcome: 'stale' });
    await processor.processOne(event({ eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated, attemptCount: 2 }));
    expect(processed).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(deadLetter).not.toHaveBeenCalled();
    expect(sendCustomerMessage.abandonIfInFlight).not.toHaveBeenCalled();
  });

  it('cannot acknowledge a late stale handler after the new owner completes', async () => {
    let finishOld!: (value: { outcome: string }) => void;
    sendCustomerMessage.handle.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const old = processor.processOne(event({ eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated }));
    const newProcessor = new OutboxProcessor(prisma, config, sendCustomerMessage as never, logger);
    await newProcessor.processOne(event({ eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated, claimGeneration: 2n }));
    finishOld({ outcome: 'stale' });
    await old;
    expect(processed).toHaveBeenCalledTimes(1);
    expect(processed).toHaveBeenCalledWith(prisma.client, event().id, 2n);
    expect(deadLetter).not.toHaveBeenCalled();
  });

  it('drains every sibling after one fails before another claim or provider execution', async () => {
    const first = event({ eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated });
    const second = event({ id: 'second', eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated });
    claim.mockResolvedValueOnce([first, second]).mockResolvedValue([]);
    let finishSibling!: () => void;
    const providerCall = jest.fn();
    const evidence = jest.fn();
    sendCustomerMessage.handle.mockImplementation(async (item: OutboxEvent) => {
      providerCall(item.id);
      if (item.id === first.id) throw new Error('handler failed');
      await new Promise<void>((resolve) => { finishSibling = resolve; });
      evidence(item.id);
      return { outcome: 'completed' };
    });
    retry.mockRejectedValueOnce(new Error('retry persistence failed'));
    const batch = processor.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await processor.tick();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(providerCall).toHaveBeenCalledTimes(2);
    expect(evidence).not.toHaveBeenCalled();
    finishSibling();
    await batch;
    await processor.tick();
    expect(claim).toHaveBeenCalledTimes(2);
    expect(providerCall).toHaveBeenCalledTimes(2);
    expect(evidence).toHaveBeenCalledTimes(1);
    expect(processed).toHaveBeenCalledTimes(1);
  });

  it('waits for a timed-out handler to settle after abort before another batch', async () => {
    jest.useFakeTimers();
    let finish!: (value: { outcome: string }) => void;
    let observedSignal: AbortSignal | undefined;
    claim.mockResolvedValueOnce([event({ eventType: DOMAIN_EVENT_TYPES.MessageDeliveryActivated })]).mockResolvedValue([]);
    sendCustomerMessage.handle.mockImplementation((_event, _max, signal) => {
      observedSignal = signal;
      return new Promise((resolve) => { finish = resolve; });
    });
    try {
      const batch = processor.tick();
      await jest.advanceTimersByTimeAsync(handlerTimeoutMs(config.values.OUTBOX_LEASE_MS));
      expect(observedSignal?.aborted).toBe(true);
      await processor.tick();
      expect(claim).toHaveBeenCalledTimes(1);
      finish({ outcome: 'stale' });
      await batch;
      expect(processed).not.toHaveBeenCalled();
      expect(deadLetter).not.toHaveBeenCalled();
      await processor.tick();
      expect(claim).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

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
  updatedAt: Date;
  providerRequestId: string;
  createdBy: string;
  customer: { phoneNumber: string };
  messageRequest: { id: string; messageText: string; recipientPhoneNumber: string };
};

function deliveryRow(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: 'm1',
    salonId: '22222222-2222-4222-8222-222222222222',
    mode: 'BALE',
    messageRequestId: 'r1',
    status: 'PENDING',
    executionGeneration: 0,
    executionToken: null,
    executionLockedUntil: null,
    failedAt: null,
    failureCode: null,
    submittedAt: null,
    updatedAt: new Date(0),
    providerRequestId: 'req-1',
    createdBy: '33333333-3333-4333-8333-333333333333',
    customer: { phoneNumber: '09123456789' },
    messageRequest: { id: 'r1', messageText: 'hello', recipientPhoneNumber: '09123456789' },
    ...overrides,
  };
}

type FakePrismaClient = {
  messageDelivery: {
    findFirst: (args: { where: { id: string; salonId: string } }) => Promise<DeliveryRow | null>;
    updateMany: (args: {
      where: { id: string; salonId: string; status?: { in: string[] }; mode?: string };
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  messageRequest: {
    updateMany: () => Promise<{ count: number }>;
  };
  outboxEvent: {
    findFirst: () => Promise<{ id: string }>;
    create: () => Promise<unknown>;
  };
  auditLog: { create: () => Promise<unknown> };
  $transaction: (fn: (tx: FakePrismaClient) => Promise<unknown>) => Promise<unknown>;
};

function fakePrisma(rows: DeliveryRow[]) {
  const client: FakePrismaClient = {
    messageDelivery: {
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
    },
    messageRequest: {
      updateMany: async () => ({ count: 1 }),
    },
    outboxEvent: {
      findFirst: async () => ({ id: 'event' }),
      create: async () => ({}),
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (fn: (tx: FakePrismaClient) => Promise<unknown>) => {
      const snapshot = rows.map((row) => ({ ...row }));
      try {
        return await fn(client);
      } catch (error) {
        for (let index = 0; index < rows.length; index += 1) {
          Object.assign(rows[index]!, snapshot[index]);
        }
        throw error;
      }
    },
  };
  return { client };
}

describe('OutboxProcessor MessageSendRequested dead-letter', () => {
  const logger = pino({ level: 'silent' });

  beforeEach(() => {
    jest.clearAllMocks();
    deadLetter.mockResolvedValue(true);
    processed.mockResolvedValue(true);
    retry.mockResolvedValue(true);
  });

  const baseConfig = {
    values: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      OUTBOX_BATCH_SIZE: 10,
      OUTBOX_LEASE_MS: 1_000,
      OUTBOX_MAX_ATTEMPTS: 2,
      OUTBOX_BACKOFF_BASE_MS: 10,
      OUTBOX_BACKOFF_CAP_MS: 20,
      OUTBOX_POLL_INTERVAL_MS: 60_000,
    } as AppConfig,
  } as AppConfigService;

  function messageEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
    return event({
      eventType: DOMAIN_EVENT_TYPES.MessageSendRequested,
      payload: { messageDeliveryId: 'm1' },
      attemptCount: 2,
      ...overrides,
    });
  }

  it('fails PROCESSING delivery when the last-attempt handler times out', async () => {
    jest.useFakeTimers();
    const row = deliveryRow({ status: 'PENDING' });
    const prisma = fakePrisma([row]);
    const sender = { sendText: jest.fn(({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) };
    const handler = new SendCustomerMessageHandler(prisma as never, sender as never);
    const processor = new OutboxProcessor(prisma as never, baseConfig, handler, logger);

    try {
      const done = processor.processOne(messageEvent());
      await Promise.resolve();
      await Promise.resolve();
      expect(row.status).toBe('PROCESSING');
      await jest.advanceTimersByTimeAsync(handlerTimeoutMs(baseConfig.values.OUTBOX_LEASE_MS));
      await done;
    } finally {
      jest.useRealTimers();
    }

    expect(deadLetter).toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(row.status).toBe('FAILED');
    expect(row.failureCode).toBe('PROVIDER_UNKNOWN');
    expect(row.failedAt).toBeInstanceOf(Date);
  });

  it('fails PROCESSING delivery when the last attempt throws a generic consume error', async () => {
    const row = deliveryRow({ status: 'PENDING' });
    const prisma = fakePrisma([row]);
    const sender = { sendText: jest.fn().mockRejectedValue(new Error('boom')) };
    const handler = new SendCustomerMessageHandler(prisma as never, sender as never);
    const processor = new OutboxProcessor(prisma as never, baseConfig, handler, logger);

    await processor.processOne(messageEvent());

    expect(deadLetter).toHaveBeenCalled();
    expect(row.status).toBe('FAILED');
    expect(row.failureCode).toBe('PROVIDER_UNKNOWN');
    expect(row.failedAt).toBeInstanceOf(Date);
  });

  it('transitions PENDING to FAILED when dead-lettering without a processing update', async () => {
    const row = deliveryRow({ status: 'PENDING' });
    const prisma = fakePrisma([row]);
    const handler = new SendCustomerMessageHandler(prisma as never, { sendText: jest.fn() } as never);
    jest.spyOn(handler, 'handle').mockRejectedValue(new Error('boom'));
    const processor = new OutboxProcessor(prisma as never, baseConfig, handler, logger);

    await processor.processOne(messageEvent());

    expect(deadLetter).toHaveBeenCalled();
    expect(row.status).toBe('FAILED');
    expect(row.failedAt).toBeInstanceOf(Date);
  });

  it('does not change SENT when dead-lettering', async () => {
    const submittedAt = new Date('2026-01-01T00:00:00.000Z');
    const row = deliveryRow({ status: 'SENT', submittedAt });
    const prisma = fakePrisma([row]);
    const handler = new SendCustomerMessageHandler(prisma as never, { sendText: jest.fn() } as never);
    jest.spyOn(handler, 'handle').mockRejectedValue(new Error('boom'));
    const processor = new OutboxProcessor(prisma as never, baseConfig, handler, logger);

    await processor.processOne(messageEvent());

    expect(deadLetter).toHaveBeenCalled();
    expect(row.status).toBe('SENT');
    expect(row.failedAt).toBeNull();
    expect(row.submittedAt).toBe(submittedAt);
  });

  it('does not rewrite an already FAILED delivery on dead-letter', async () => {
    const failedAt = new Date('2026-01-02T00:00:00.000Z');
    const row = deliveryRow({
      status: 'FAILED',
      failedAt,
      failureCode: 'PROVIDER_AUTH',
    });
    const prisma = fakePrisma([row]);
    const handler = new SendCustomerMessageHandler(prisma as never, { sendText: jest.fn() } as never);
    jest.spyOn(handler, 'handle').mockRejectedValue(new Error('boom'));
    const processor = new OutboxProcessor(prisma as never, baseConfig, handler, logger);

    await processor.processOne(messageEvent());

    expect(deadLetter).toHaveBeenCalled();
    expect(row.status).toBe('FAILED');
    expect(row.failureCode).toBe('PROVIDER_AUTH');
    expect(row.failedAt).toBe(failedAt);
  });

  it('does not fail another tenant MessageDelivery', async () => {
    const otherTenant = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const row = deliveryRow({ salonId: otherTenant, status: 'PROCESSING' });
    const prisma = fakePrisma([row]);
    const handler = new SendCustomerMessageHandler(prisma as never, { sendText: jest.fn() } as never);
    jest.spyOn(handler, 'handle').mockRejectedValue(new Error('boom'));
    const processor = new OutboxProcessor(prisma as never, baseConfig, handler, logger);

    await processor.processOne(messageEvent());

    expect(deadLetter).toHaveBeenCalled();
    expect(row.status).toBe('PROCESSING');
    expect(row.failedAt).toBeNull();
  });

  it('retries below max attempts without failing the delivery', async () => {
    const row = deliveryRow({ status: 'PENDING' });
    const prisma = fakePrisma([row]);
    const sender = {
      sendText: jest.fn().mockResolvedValue({
        outcome: 'retryable',
        code: 'PROVIDER_TEMPORARY',
      }),
    };
    const handler = new SendCustomerMessageHandler(prisma as never, sender as never);
    const processor = new OutboxProcessor(prisma as never, baseConfig, handler, logger);

    await processor.processOne(messageEvent({ attemptCount: 1 }));

    expect(retry).toHaveBeenCalled();
    expect(deadLetter).not.toHaveBeenCalled();
    expect(row.status).toBe('PENDING');
    expect(row.failedAt).toBeNull();
  });

  it('uses PROVIDER_TEMPORARY when the dead-letter reason is a retryable temporary provider error', async () => {
    const row = deliveryRow({ status: 'PROCESSING' });
    const prisma = fakePrisma([row]);
    const handler = new SendCustomerMessageHandler(prisma as never, { sendText: jest.fn() } as never);
    jest
      .spyOn(handler, 'handle')
      .mockRejectedValue(new RetryableMessageSendError('PROVIDER_TEMPORARY'));
    const processor = new OutboxProcessor(prisma as never, baseConfig, handler, logger);

    await processor.processOne(messageEvent());

    expect(deadLetter).toHaveBeenCalled();
    expect(row.status).toBe('FAILED');
    expect(row.failureCode).toBe('PROVIDER_TEMPORARY');
  });

  it('rolls back dead-letter when MessageDelivery fail cannot be applied', async () => {
    const row = deliveryRow({ status: 'PROCESSING' });
    const prisma = fakePrisma([row]);
    let outboxStatus: 'PROCESSING' | 'DEAD_LETTER' = 'PROCESSING';
    deadLetter.mockImplementation(async () => {
      outboxStatus = 'DEAD_LETTER';
      return true;
    });
    const originalTx = prisma.client.$transaction;
    prisma.client.$transaction = (async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = { outboxStatus, delivery: { ...row } };
      try {
        return await fn({
          messageDelivery: {
            findFirst: async () => row,
            updateMany: async () => {
              throw new Error('crash between dead-letter and abandon');
            },
          },
          messageRequest: {
            updateMany: async () => ({ count: 1 }),
          },
          auditLog: { create: async () => ({}) },
        });
      } catch (error) {
        outboxStatus = snapshot.outboxStatus;
        Object.assign(row, snapshot.delivery);
        throw error;
      }
    }) as typeof originalTx;
    const handler = new SendCustomerMessageHandler(prisma as never, { sendText: jest.fn() } as never);
    jest.spyOn(handler, 'handle').mockRejectedValue(new Error('boom'));
    const processor = new OutboxProcessor(prisma as never, baseConfig, handler, logger);

    await expect(processor.processOne(messageEvent())).rejects.toThrow(
      'crash between dead-letter and abandon',
    );
    expect(outboxStatus).toBe('PROCESSING');
    expect(row.status).toBe('PROCESSING');
    expect(row.failedAt).toBeNull();
  });
});

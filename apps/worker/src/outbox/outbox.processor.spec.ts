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

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    eventType: DOMAIN_EVENT_TYPES.VisitCompleted,
    payload: { visitId: 'v1' },
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

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new OutboxProcessor(prisma, config, logger);
  });

  it('dead-letters unknown event types instead of marking them processed', async () => {
    await processor.processOne(event({ eventType: 'NotARealEvent' }));
    expect(deadLetter).toHaveBeenCalledWith(prisma.client, event().id, 'UNKNOWN_EVENT_TYPE');
    expect(processed).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('marks known events processed', async () => {
    await processor.processOne(event());
    expect(processed).toHaveBeenCalled();
    expect(deadLetter).not.toHaveBeenCalled();
  });

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
});

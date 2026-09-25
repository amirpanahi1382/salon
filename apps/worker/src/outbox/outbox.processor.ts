import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import {
  claimOutboxEvents,
  markOutboxDeadLetter,
  markOutboxProcessed,
  markOutboxRetry,
  type OutboxEvent,
} from '@salon/database';
import {
  DOMAIN_EVENT_TYPES,
  fullJitterDelayMs,
  isDomainEventType,
  type MessageFailureCode,
  TimeoutError,
  withTimeout,
} from '@salon/shared';
import type { Logger } from 'pino';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { createWorkerLogger } from '../infrastructure/logging/worker-logger';
import { RetryableMessageSendError } from '../messaging/message-sender';
import { SendCustomerMessageHandler, type DeliveryExecutionResult } from '../messaging/send-customer-message.handler';

/**
 * At-least-once outbox consumer. Handlers must be idempotent.
 * Unknown event types are dead-lettered immediately (retry cannot invent a handler).
 */
@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly sendCustomerMessage: SendCustomerMessageHandler,
    @Optional() logger?: Logger,
  ) {
    this.logger = logger ?? createWorkerLogger(config.values);
  }

  onModuleInit(): void {
    const interval = this.config.values.OUTBOX_POLL_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    this.logger.info(
      { operation: 'outbox.start', pollIntervalMs: interval },
      'Outbox worker polling',
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.inFlight) {
      await this.inFlight;
    }
    this.logger.info({ operation: 'outbox.shutdown', outcome: 'stopped' }, 'Outbox worker stopped');
  }

  async tick(): Promise<void> {
    if (this.stopping || this.running) {
      return;
    }
    this.running = true;
    const work = this.runBatch();
    this.inFlight = work;
    try {
      await work;
    } finally {
      this.running = false;
      this.inFlight = undefined;
    }
  }

  private async runBatch(): Promise<void> {
    if (this.stopping) {
      return;
    }
    try {
      const claimed = await claimOutboxEvents(
        this.prisma.client,
        this.config.values.OUTBOX_BATCH_SIZE,
        this.config.values.OUTBOX_LEASE_MS,
      );
      // Start the bounded claimed batch together so later rows do not spend their lease waiting.
      const results = await Promise.allSettled(claimed.map((event) => this.processOne(event)));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    } catch (error: unknown) {
      this.logger.error(
        {
          operation: 'outbox.poll',
          outcome: 'failed',
          errorType: error instanceof Error ? error.name : 'unknown',
          err: error instanceof Error ? error.message : 'outbox tick failed',
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Outbox poll failed',
      );
    }
  }

  async processOne(event: OutboxEvent): Promise<void> {
    const started = Date.now();
    const maxAttempts = this.config.values.OUTBOX_MAX_ATTEMPTS;
    const base = {
      eventId: event.id,
      eventType: event.eventType,
      attempt: event.attemptCount,
      claimGeneration: event.claimGeneration.toString(),
      tenantId: event.tenantId,
      operation: 'outbox.consume',
    };

    if (!isDomainEventType(event.eventType)) {
      const applied = await markOutboxDeadLetter(this.prisma.client, event.id, event.claimGeneration, 'UNKNOWN_EVENT_TYPE');
      if (!applied) {
        this.logger.warn({ ...base, outcome: 'stale_owner' }, 'Stale outbox owner rejected');
        return;
      }
      this.logger.error(
        {
          ...base,
          durationMs: Date.now() - started,
          outcome: 'dead_letter',
          errorCode: 'UNKNOWN_EVENT_TYPE',
          errorType: 'UnknownEventType',
        },
        'Unknown outbox event type dead-lettered',
      );
      return;
    }

    const abort = new AbortController();
    try {
      const work = this.consume(event, abort.signal);
      let result: DeliveryExecutionResult;
      try {
        result = await withTimeout(
          work,
          handlerTimeoutMs(this.config.values.OUTBOX_LEASE_MS),
          'Outbox handler timed out',
        );
      } catch (error: unknown) {
        abort.abort();
        // Cancellation is a request: keep observing the handler until it actually settles.
        const settled = await work.catch(() => undefined);
        if (settled?.outcome === 'stale') {
          this.logger.warn({ ...base, outcome: 'stale_owner' }, 'Stale delivery owner left for reclaim');
          return;
        }
        throw error;
      }
      if (result.outcome === 'stale') {
        this.logger.warn({ ...base, outcome: 'stale_owner' }, 'Stale delivery owner left for reclaim');
        return;
      }
      const applied = await markOutboxProcessed(this.prisma.client, event.id, event.claimGeneration);
      if (!applied) {
        this.logger.warn({ ...base, outcome: 'stale_owner' }, 'Stale outbox owner rejected');
        return;
      }
      this.logger.info(
        {
          ...base,
          durationMs: Date.now() - started,
          outcome: 'processed',
        },
        'Outbox event processed',
      );
    } catch (error: unknown) {
      abort.abort();
      const message = error instanceof Error ? error.message : 'consumer failed';
      const errorType = error instanceof Error ? error.name : 'unknown';
      const errorCode =
        error instanceof TimeoutError
          ? 'HANDLER_TIMEOUT'
          : error instanceof RetryableMessageSendError
            ? error.code
            : 'CONSUMER_FAILED';
      if (event.attemptCount >= maxAttempts) {
        const applied = await this.deadLetterEvent(event, message, error);
        if (!applied) {
          this.logger.warn({ ...base, outcome: 'stale_owner' }, 'Stale outbox owner rejected');
          return;
        }
        this.logger.error(
          {
            ...base,
            durationMs: Date.now() - started,
            outcome: 'dead_letter',
            errorCode,
            errorType,
            stack: error instanceof Error ? error.stack : undefined,
            next: 'manual replay after fix',
          },
          'Outbox event dead-lettered',
        );
        return;
      }

      const delayMs =
        error instanceof RetryableMessageSendError && error.retryAfterMs !== undefined
          ? error.retryAfterMs
          : fullJitterDelayMs(
              Math.max(0, event.attemptCount - 1),
              this.config.values.OUTBOX_BACKOFF_BASE_MS,
              this.config.values.OUTBOX_BACKOFF_CAP_MS,
            );
      const applied = await markOutboxRetry(this.prisma.client, event.id, event.claimGeneration, message, delayMs);
      if (!applied) {
        this.logger.warn({ ...base, outcome: 'stale_owner' }, 'Stale outbox owner rejected');
        return;
      }
      this.logger.warn(
        {
          ...base,
          durationMs: Date.now() - started,
          outcome: 'retry',
          errorCode,
          errorType,
          delayMs,
          next: `retry after ${delayMs}ms`,
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Outbox event scheduled for retry',
      );
    }
  }

  private async deadLetterEvent(
    event: OutboxEvent,
    lastError: string,
    cause: unknown,
  ): Promise<boolean> {
    if (
      event.eventType !== DOMAIN_EVENT_TYPES.MessageSendRequested &&
      event.eventType !== DOMAIN_EVENT_TYPES.MessageDeliveryActivated
    ) {
      return markOutboxDeadLetter(this.prisma.client, event.id, event.claimGeneration, lastError);
    }
    const code = deadLetterFailureCode(cause);
    return this.prisma.client.$transaction(async (tx) => {
      const applied = await markOutboxDeadLetter(tx, event.id, event.claimGeneration, lastError);
      if (!applied) return false;
      await this.sendCustomerMessage.abandonIfInFlight(event, code, tx);
      return true;
    });
  }

  private async consume(event: OutboxEvent, signal: AbortSignal): Promise<DeliveryExecutionResult> {
    if (
      event.eventType === DOMAIN_EVENT_TYPES.MessageSendRequested ||
      event.eventType === DOMAIN_EVENT_TYPES.MessageDeliveryActivated
    ) {
      return this.sendCustomerMessage.handle(
        event,
        this.config.values.OUTBOX_MAX_ATTEMPTS,
        signal,
      );
    }
    if (!event.eventType) {
      throw new Error('Missing event type');
    }
    return { outcome: 'completed' };
  }
}

export function handlerTimeoutMs(leaseMs: number): number {
  return Math.max(1_000, Math.floor(leaseMs * 0.8));
}

function deadLetterFailureCode(error: unknown): MessageFailureCode {
  if (error instanceof RetryableMessageSendError) {
    return error.code;
  }
  return 'PROVIDER_UNKNOWN';
}

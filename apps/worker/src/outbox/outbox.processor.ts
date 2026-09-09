import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
  TimeoutError,
  withTimeout,
} from '@salon/shared';
import type { Logger } from 'pino';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { createWorkerLogger } from '../infrastructure/logging/worker-logger';
import { RetryableMessageSendError } from '../messaging/message-sender';
import { SendCustomerMessageHandler } from '../messaging/send-customer-message.handler';

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
    logger?: Logger,
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
      for (const event of claimed) {
        await this.processOne(event);
      }
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
      tenantId: event.tenantId,
      operation: 'outbox.consume',
    };

    if (!isDomainEventType(event.eventType)) {
      await markOutboxDeadLetter(this.prisma.client, event.id, 'UNKNOWN_EVENT_TYPE');
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

    try {
      await withTimeout(
        this.consume(event),
        handlerTimeoutMs(this.config.values.OUTBOX_LEASE_MS),
        'Outbox handler timed out',
      );
      await markOutboxProcessed(this.prisma.client, event.id);
      this.logger.info(
        {
          ...base,
          durationMs: Date.now() - started,
          outcome: 'processed',
        },
        'Outbox event processed',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'consumer failed';
      const errorType = error instanceof Error ? error.name : 'unknown';
      const errorCode =
        error instanceof TimeoutError
          ? 'HANDLER_TIMEOUT'
          : error instanceof RetryableMessageSendError
            ? error.code
            : 'CONSUMER_FAILED';
      if (event.attemptCount >= maxAttempts) {
        await markOutboxDeadLetter(this.prisma.client, event.id, message);
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
      await markOutboxRetry(this.prisma.client, event.id, message, delayMs);
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

  private async consume(event: OutboxEvent): Promise<void> {
    if (event.eventType === DOMAIN_EVENT_TYPES.MessageSendRequested) {
      await this.sendCustomerMessage.handle(event, this.config.values.OUTBOX_MAX_ATTEMPTS);
      return;
    }
    if (!event.eventType) {
      throw new Error('Missing event type');
    }
  }
}

export function handlerTimeoutMs(leaseMs: number): number {
  return Math.max(1_000, Math.floor(leaseMs * 0.8));
}

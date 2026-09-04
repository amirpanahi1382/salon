import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  claimOutboxEvents,
  markOutboxDeadLetter,
  markOutboxProcessed,
  markOutboxRetry,
  type OutboxEvent,
} from '@salon/database';
import { fullJitterDelayMs } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';

/**
 * Foundation consumer: acknowledges known event types.
 * Domain handlers will be added by later phases. Must remain idempotent.
 */
@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    const interval = this.config.values.OUTBOX_POLL_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
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
      const message = error instanceof Error ? error.message : 'outbox tick failed';
      this.logger.error({ err: message }, 'Outbox poll failed');
    } finally {
      this.running = false;
    }
  }

  private async processOne(event: OutboxEvent): Promise<void> {
    const maxAttempts = this.config.values.OUTBOX_MAX_ATTEMPTS;
    try {
      await this.consume(event);
      await markOutboxProcessed(this.prisma.client, event.id);
      this.logger.log(
        `Processed eventType=${event.eventType} eventId=${event.id} tenantId=${event.tenantId ?? 'none'} attempt=${event.attemptCount}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'consumer failed';
      if (event.attemptCount >= maxAttempts) {
        await markOutboxDeadLetter(this.prisma.client, event.id, message);
        this.logger.error(
          `Dead-letter eventType=${event.eventType} eventId=${event.id} tenantId=${event.tenantId ?? 'none'} attempt=${event.attemptCount}`,
        );
        return;
      }

      const delayMs = fullJitterDelayMs(
        Math.max(0, event.attemptCount - 1),
        this.config.values.OUTBOX_BACKOFF_BASE_MS,
        this.config.values.OUTBOX_BACKOFF_CAP_MS,
      );
      await markOutboxRetry(this.prisma.client, event.id, message, delayMs);
      this.logger.warn(
        `Retry eventType=${event.eventType} eventId=${event.id} tenantId=${event.tenantId ?? 'none'} attempt=${event.attemptCount} delayMs=${delayMs}`,
      );
    }
  }

  private async consume(event: OutboxEvent): Promise<void> {
    // Idempotent no-op until domain consumers exist. Duplicate deliveries are safe.
    if (!event.eventType) {
      throw new Error('Missing event type');
    }
  }
}

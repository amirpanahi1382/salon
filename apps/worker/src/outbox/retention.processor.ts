import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { deleteExpiredIdempotencyBatch, deleteProcessedOutboxBatch } from '@salon/database';
import type { Logger } from 'pino';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { createWorkerLogger } from '../infrastructure/logging/worker-logger';

@Injectable()
export class RetentionProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() logger?: Logger,
  ) {
    this.logger = logger ?? createWorkerLogger(config.values);
  }

  onModuleInit(): void {
    const interval = this.config.values.RETENTION_CLEANUP_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    this.logger.info(
      { operation: 'retention.start', pollIntervalMs: interval },
      'Retention cleanup polling',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const batch = this.config.values.RETENTION_CLEANUP_BATCH_SIZE;
      const outboxDeleted = await deleteProcessedOutboxBatch(
        this.prisma.client,
        this.config.values.OUTBOX_PROCESSED_RETENTION_DAYS,
        batch,
      );
      const idempotencyDeleted = await deleteExpiredIdempotencyBatch(
        this.prisma.client,
        this.config.values.IDEMPOTENCY_RETENTION_DAYS,
        batch,
      );
      if (outboxDeleted > 0 || idempotencyDeleted > 0) {
        this.logger.info(
          {
            operation: 'retention.cleanup',
            outcome: 'processed',
            outboxDeleted,
            idempotencyDeleted,
          },
          'Retention cleanup deleted expired rows',
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        {
          operation: 'retention.cleanup',
          outcome: 'failed',
          err: error instanceof Error ? error.message : 'retention failed',
        },
        'Retention cleanup failed',
      );
    } finally {
      this.running = false;
    }
  }
}

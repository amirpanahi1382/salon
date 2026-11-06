import { randomUUID } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { ObjectStorage } from '@salon/object-storage';
import { withTimeout } from '@salon/shared';
import type { Logger } from 'pino';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { createWorkerLogger } from '../infrastructure/logging/worker-logger';

export const ACTIVATION_RECEIPT_OBJECT_STORAGE = Symbol('ACTIVATION_RECEIPT_OBJECT_STORAGE');

type CleanupClaim = {
  id: string;
  receiptId: string;
  objectKey: string;
  claimGeneration: bigint;
  claimToken: string;
  settleUntil: Date;
};

/**
 * Bounded recovery for receipt attempts which committed before object PUT but
 * never reached the STORED/audit transaction. It owns no business decision:
 * reviewable and historical evidence is always excluded from cleanup.
 */
@Injectable()
export class ActivationReceiptRecoveryProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() @Inject(ACTIVATION_RECEIPT_OBJECT_STORAGE) private readonly storage?: ObjectStorage,
    @Optional() logger?: Logger,
  ) {
    this.logger = logger ?? createWorkerLogger(config.values);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.config.values.VIP_UPLOAD_RECOVERY_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.inFlight) await this.inFlight;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.stopping || this.running) return;
    this.running = true;
    this.inFlight = this.runBatch(now);
    try { await this.inFlight; } finally { this.running = false; this.inFlight = undefined; }
  }

  async releaseExpiredAttempts(now = new Date()): Promise<number> {
    const delay = this.config.values.MINIO_REQUEST_TIMEOUT_MS;
    const settle = this.config.values.VIP_UPLOAD_CLEANUP_SETTLE_MS;
    const batch = this.config.values.VIP_UPLOAD_RECOVERY_BATCH_SIZE;
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; objectKey: string; generation: bigint }>>`
        SELECT id, object_key AS "objectKey", upload_generation AS generation
        FROM activation_receipts
        WHERE phase = 'UPLOADING'::"ActivationReceiptPhase"
          -- Pre-recovery rows have no ownership proof. They remain review-only:
          -- a later API upload may close them to unblock itself, but recovery
          -- never creates a deletion candidate for their historical key.
          AND upload_owner_token IS NOT NULL
          AND upload_locked_until IS NOT NULL
          AND upload_locked_until <= ${now}
        ORDER BY upload_locked_until, id
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED
      `;
      let released = 0;
      for (const row of rows) {
        const changed = await tx.$executeRaw`
          UPDATE activation_receipts
          SET phase = 'FAILED'::"ActivationReceiptPhase", upload_owner_token = NULL,
              upload_locked_until = NULL, upload_last_error_code = 'LEASE_EXPIRED', updated_at = clock_timestamp()
          WHERE id = ${row.id}::uuid AND phase = 'UPLOADING'::"ActivationReceiptPhase"
            AND upload_generation = ${row.generation}
        `;
        if (changed !== 1) continue;
        await tx.$executeRaw`
          INSERT INTO activation_receipt_upload_cleanups
            (id, receipt_id, object_key, upload_generation, available_at, settle_until, status,
             claim_generation, delete_passes, attempts, created_at)
          VALUES (${randomUUID()}::uuid, ${row.id}::uuid, ${row.objectKey}, ${row.generation},
                  ${new Date(now.getTime() + delay)}, ${new Date(now.getTime() + settle)},
                  'PENDING', 0, 0, 0, ${now})
          ON CONFLICT (object_key) DO NOTHING
        `;
        released += 1;
      }
      return released;
    });
  }

  async claimCleanups(now = new Date()): Promise<CleanupClaim[]> {
    const claimToken = randomUUID();
    const lockedUntil = new Date(now.getTime() + this.config.values.VIP_UPLOAD_LEASE_MS);
    const batch = this.config.values.VIP_UPLOAD_RECOVERY_BATCH_SIZE;
    return this.prisma.client.$transaction((tx) => tx.$queryRaw<CleanupClaim[]>`
      WITH candidates AS (
        SELECT c.id FROM activation_receipt_upload_cleanups c
        JOIN activation_receipts r ON r.id = c.receipt_id
        WHERE ((c.status = 'PENDING' AND c.available_at <= ${now})
           OR (c.status = 'PROCESSING' AND c.locked_until <= ${now}))
          AND r.phase = 'FAILED'::"ActivationReceiptPhase"
          AND r.object_key = c.object_key
          AND r.upload_generation = c.upload_generation
        ORDER BY c.available_at, c.id LIMIT ${batch} FOR UPDATE OF c SKIP LOCKED
      )
      UPDATE activation_receipt_upload_cleanups c
      SET status = 'PROCESSING', claim_generation = c.claim_generation + 1,
          claim_token = ${claimToken}::uuid, locked_until = ${lockedUntil}, attempts = c.attempts + 1,
          last_error_code = NULL
      FROM candidates WHERE c.id = candidates.id
      RETURNING c.id, c.receipt_id AS "receiptId", c.object_key AS "objectKey",
                c.claim_generation AS "claimGeneration", c.claim_token AS "claimToken",
                c.settle_until AS "settleUntil"
    `);
  }

  private async runBatch(now: Date): Promise<void> {
    try {
      const expired = await this.releaseExpiredAttempts(now);
      if (!this.config.values.ACTIVATION_RECEIPT_AUTOMATIC_CLEANUP_ENABLED) {
        if (expired) {
          this.logger.warn(
            { operation: 'activation_receipt_recovery.tick', expired, outcome: 'quarantined', errorCode: 'CLEANUP_AWAITING_STORAGE_BOUND' },
            'Activation receipt uploads quarantined pending storage completion-bound verification',
          );
        }
        return;
      }
      const claims = await this.claimCleanups(now);
      await Promise.allSettled(claims.map((claim) => this.processCleanup(claim, now)));
      if (expired || claims.length) this.logger.info({ operation: 'activation_receipt_recovery.tick', expired, claimed: claims.length }, 'Activation receipt recovery batch completed');
    } catch {
      this.logger.error({ operation: 'activation_receipt_recovery.tick', outcome: 'failed', errorCode: 'ACTIVATION_RECEIPT_RECOVERY_FAILED', errorType: 'Error' }, 'Activation receipt recovery failed');
    }
  }

  async processCleanup(claim: CleanupClaim, now = new Date()): Promise<void> {
    if (!this.storage) {
      throw new Error('Activation receipt storage is unavailable for automatic cleanup');
    }
    const current = await this.prisma.client.$queryRaw<Array<{ id: string }>>`
      SELECT r.id FROM activation_receipt_upload_cleanups c
      JOIN activation_receipts r ON r.id = c.receipt_id
      WHERE c.id = ${claim.id}::uuid AND c.status = 'PROCESSING'
        AND c.claim_generation = ${claim.claimGeneration} AND c.claim_token = ${claim.claimToken}::uuid
        AND r.phase = 'FAILED'::"ActivationReceiptPhase" AND r.object_key = ${claim.objectKey}
        AND r.upload_generation = c.upload_generation
    `;
    if (current.length !== 1) return;
    try {
      await withTimeout(this.storage.deleteObject(claim.objectKey), this.config.values.MINIO_REQUEST_TIMEOUT_MS, 'Activation receipt cleanup timed out');
      const finalPass = now >= claim.settleUntil;
      await this.prisma.client.$executeRaw`
        UPDATE activation_receipt_upload_cleanups SET
          status = ${finalPass ? 'PROCESSED' : 'PENDING'}::"ActivationReceiptCleanupStatus",
          claim_token = NULL, locked_until = NULL,
          available_at = ${finalPass ? now : claim.settleUntil},
          processed_at = ${finalPass ? now : null}, delete_passes = delete_passes + 1, last_error_code = NULL
        WHERE id = ${claim.id}::uuid AND status = 'PROCESSING'
          AND claim_generation = ${claim.claimGeneration} AND claim_token = ${claim.claimToken}::uuid
      `;
    } catch {
      await this.prisma.client.$executeRaw`
        UPDATE activation_receipt_upload_cleanups SET status = 'PENDING', claim_token = NULL,
          locked_until = NULL, available_at = ${new Date(Date.now() + 30_000)},
          last_error_code = 'STORAGE_DELETE_FAILED'
        WHERE id = ${claim.id}::uuid AND status = 'PROCESSING'
          AND claim_generation = ${claim.claimGeneration} AND claim_token = ${claim.claimToken}::uuid
      `;
    }
  }
}

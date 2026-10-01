import { randomUUID } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { ObjectStorage } from '@salon/object-storage';
import { withTimeout } from '@salon/shared';
import type { Logger } from 'pino';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { createWorkerLogger } from '../infrastructure/logging/worker-logger';

export const VIP_OBJECT_STORAGE = Symbol('VIP_OBJECT_STORAGE');

type CleanupClaim = {
  id: string;
  objectKey: string;
  claimGeneration: bigint;
  claimToken: string;
  requestGeneration: bigint;
  settleUntil: Date;
  deletePasses: number;
};

/**
 * Recovers bounded batches of abandoned VIP uploads and their generation-specific objects.
 * Database ownership changes commit before any object-storage request is made.
 */
@Injectable()
export class VipSampleWorkRecoveryProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(VIP_OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Optional() logger?: Logger,
  ) {
    this.logger = logger ?? createWorkerLogger(config.values);
  }

  onModuleInit(): void {
    const interval = this.config.values.VIP_UPLOAD_RECOVERY_INTERVAL_MS;
    this.timer = setInterval(() => void this.tick(), interval);
    this.logger.info(
      { operation: 'vip_sample_work_recovery.start', pollIntervalMs: interval },
      'VIP sample-work recovery polling',
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.inFlight) await this.inFlight;
  }

  async tick(): Promise<void> {
    if (this.stopping || this.running) return;
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
    try {
      const expired = await this.releaseExpiredUploads();
      const cleanups = await this.claimCleanups();
      const results = await Promise.allSettled(cleanups.map((claim) => this.processCleanup(claim)));
      const rejected = results.filter((result) => result.status === 'rejected').length;
      if (expired || cleanups.length || rejected) {
        this.logger.info(
          { operation: 'vip_sample_work_recovery.tick', expired, claimed: cleanups.length, rejected },
          'VIP sample-work recovery batch completed',
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        {
          operation: 'vip_sample_work_recovery.tick',
          outcome: 'failed',
          err: error instanceof Error ? error.message : 'recovery failed',
        },
        'VIP sample-work recovery failed',
      );
    }
  }

  async releaseExpiredUploads(now = new Date()): Promise<number> {
    const batch = this.config.values.VIP_UPLOAD_RECOVERY_BATCH_SIZE;
    const cleanupDelayMs = this.config.values.MINIO_REQUEST_TIMEOUT_MS;
    const cleanupSettleMs = this.config.values.VIP_UPLOAD_CLEANUP_SETTLE_MS;
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        generation: number;
        objectKey: string;
        ownerToken: string;
        lockedUntil: Date;
        requestStatus: string;
        reservedUntil: Date;
      }>>`
        SELECT u.id,
               u.generation,
               u.object_key AS "objectKey",
               u.owner_token AS "ownerToken",
               u.locked_until AS "lockedUntil",
               r.status::text AS "requestStatus",
               r.reserved_until AS "reservedUntil"
          FROM vip_sample_work_uploads u
          JOIN vip_requests r ON r.id = u.vip_request_id AND r.salon_id = u.salon_id
         WHERE u.status = 'UPLOADING'
           AND u.locked_until <= ${now}
         ORDER BY u.locked_until, u.id
         LIMIT ${batch}
         FOR UPDATE OF u SKIP LOCKED
      `;
      let released = 0;
      for (const row of rows) {
        const availableAt = new Date(
          Math.max(now.getTime(), row.lockedUntil.getTime()) + cleanupDelayMs,
        );
        const settleUntil = new Date(
          Math.max(now.getTime(), row.lockedUntil.getTime()) + cleanupSettleMs,
        );
        const nextStatus = row.requestStatus === 'AWAITING_SAMPLE_WORK' &&
          row.reservedUntil.getTime() >= now.getTime() ? 'RETRYABLE' : 'ABANDONED';
        const moved = await tx.vipSampleWorkUpload.updateMany({
          where: {
            id: row.id,
            status: 'UPLOADING',
            generation: row.generation,
            ownerToken: row.ownerToken,
            objectKey: row.objectKey,
            lockedUntil: { lte: now },
          },
          data: {
            status: nextStatus,
            position: null,
            ownerToken: null,
            lockedUntil: null,
            lastErrorCode: 'LEASE_EXPIRED',
          },
        });
        if (moved.count !== 1) continue;
        await tx.$executeRaw`
          INSERT INTO vip_sample_work_cleanups
            (id, upload_id, object_key, upload_generation, available_at, settle_until, status,
             request_generation, claim_generation, delete_passes, attempts, created_at)
          VALUES
            (${randomUUID()}::uuid, ${row.id}::uuid, ${row.objectKey}, ${row.generation},
             ${availableAt}, ${settleUntil}, 'PENDING', 1, 0, 0, 0, ${now})
          ON CONFLICT (object_key) DO UPDATE
            SET request_generation = vip_sample_work_cleanups.request_generation + 1,
                status = CASE
                  WHEN vip_sample_work_cleanups.status = 'PROCESSED'
                    THEN 'PENDING'::"VipSampleCleanupStatus"
                  ELSE vip_sample_work_cleanups.status
                END,
                available_at = LEAST(vip_sample_work_cleanups.available_at, EXCLUDED.available_at),
                settle_until = GREATEST(vip_sample_work_cleanups.settle_until, EXCLUDED.settle_until),
                processed_at = CASE
                  WHEN vip_sample_work_cleanups.status = 'PROCESSED' THEN NULL
                  ELSE vip_sample_work_cleanups.processed_at
                END,
                last_error_code = NULL
        `;
        released += 1;
      }
      return released;
    });
  }

  async claimCleanups(now = new Date()): Promise<CleanupClaim[]> {
    const batch = this.config.values.VIP_UPLOAD_RECOVERY_BATCH_SIZE;
    const leaseUntil = new Date(now.getTime() + this.config.values.VIP_UPLOAD_LEASE_MS);
    const claimToken = randomUUID();
    return this.prisma.client.$transaction(async (tx) => {
      return tx.$queryRaw<CleanupClaim[]>`
      WITH candidates AS (
        SELECT c.id
          FROM vip_sample_work_cleanups c
         WHERE (
                 (c.status = 'PENDING' AND c.available_at <= ${now})
              OR (c.status = 'PROCESSING' AND c.locked_until <= ${now})
               )
           AND NOT EXISTS (
             SELECT 1 FROM vip_sample_works s WHERE s.object_key = c.object_key
           )
         ORDER BY c.available_at, c.id
         LIMIT ${batch}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE vip_sample_work_cleanups c
         SET status = 'PROCESSING',
             claim_generation = c.claim_generation + 1,
             claim_token = ${claimToken},
             locked_until = ${leaseUntil},
             attempts = c.attempts + 1,
             last_error_code = NULL
        FROM candidates
       WHERE c.id = candidates.id
      RETURNING c.id,
                c.object_key AS "objectKey",
                c.claim_generation AS "claimGeneration",
                c.claim_token AS "claimToken",
                c.request_generation AS "requestGeneration",
                c.settle_until AS "settleUntil",
                c.delete_passes AS "deletePasses"
      `;
    });
  }

  async processCleanup(claim: CleanupClaim, now = new Date()): Promise<void> {
    const referenced = await this.prisma.client.vipSampleWork.findFirst({
      where: { objectKey: claim.objectKey },
      select: { id: true },
    });
    if (referenced) {
      await this.retryCleanup(claim, 'OBJECT_BECAME_COMMITTED', 60_000);
      return;
    }
    try {
      await withTimeout(
        this.storage.deleteObject(claim.objectKey),
        this.config.values.MINIO_REQUEST_TIMEOUT_MS,
        'VIP sample-work cleanup timed out',
      );
      if (now.getTime() < claim.settleUntil.getTime()) {
        const rescheduled = await this.prisma.client.vipSampleWorkCleanup.updateMany({
          where: {
            id: claim.id,
            status: 'PROCESSING',
            claimGeneration: claim.claimGeneration,
            claimToken: claim.claimToken,
            requestGeneration: claim.requestGeneration,
          },
          data: {
            status: 'PENDING',
            claimToken: null,
            lockedUntil: null,
            availableAt: claim.settleUntil,
            deletePasses: { increment: 1 },
            lastErrorCode: null,
          },
        });
        if (rescheduled.count !== 1) this.logStaleCleanup(claim.id);
        return;
      }
      const applied = await this.prisma.client.vipSampleWorkCleanup.updateMany({
        where: {
          id: claim.id,
          status: 'PROCESSING',
          claimGeneration: claim.claimGeneration,
          claimToken: claim.claimToken,
          requestGeneration: claim.requestGeneration,
        },
        data: {
          status: 'PROCESSED',
          claimToken: null,
          lockedUntil: null,
          processedAt: now,
          deletePasses: { increment: 1 },
          lastErrorCode: null,
        },
      });
      if (applied.count !== 1) {
        this.logStaleCleanup(claim.id);
      }
    } catch {
      await this.retryCleanup(claim, 'STORAGE_DELETE_FAILED', 30_000);
    }
  }

  private async retryCleanup(claim: CleanupClaim, errorCode: string, delayMs: number): Promise<void> {
    await this.prisma.client.vipSampleWorkCleanup.updateMany({
      where: {
        id: claim.id,
        status: 'PROCESSING',
        claimGeneration: claim.claimGeneration,
        claimToken: claim.claimToken,
        requestGeneration: claim.requestGeneration,
      },
      data: {
        status: 'PENDING',
        claimToken: null,
        lockedUntil: null,
        availableAt: new Date(Date.now() + delayMs),
        lastErrorCode: errorCode,
      },
    });
  }

  private logStaleCleanup(cleanupId: string): void {
    this.logger.warn(
      { operation: 'vip_sample_work_cleanup', cleanupId, outcome: 'stale_owner' },
      'Stale VIP sample-work cleanup owner rejected',
    );
  }
}

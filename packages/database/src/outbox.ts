import { Prisma, type OutboxEvent, type PrismaClient } from '@prisma/client';

/**
 * Claims a batch of outbox rows using PostgreSQL `FOR UPDATE SKIP LOCKED`.
 * Concurrent workers receive disjoint rows. Expired PROCESSING leases are reclaimable.
 */
export async function claimOutboxEvents(
  prisma: PrismaClient,
  batchSize: number,
  leaseMs: number,
): Promise<OutboxEvent[]> {
  return prisma.$queryRaw<OutboxEvent[]>(Prisma.sql`
    WITH claimed AS (
      SELECT id
      FROM outbox_events
      WHERE (
        (status = 'PENDING'::"OutboxStatus" AND available_at <= NOW())
        OR (
          status = 'PROCESSING'::"OutboxStatus"
          AND locked_until IS NOT NULL
          AND locked_until < NOW()
        )
      )
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events AS o
    SET
      status = 'PROCESSING'::"OutboxStatus",
      locked_at = NOW(),
      locked_until = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
      attempt_count = o.attempt_count + 1
    FROM claimed
    WHERE o.id = claimed.id
    RETURNING
      o.id,
      o.tenant_id AS "tenantId",
      o.event_type AS "eventType",
      o.payload,
      o.status,
      o.attempt_count AS "attemptCount",
      o.available_at AS "availableAt",
      o.locked_at AS "lockedAt",
      o.locked_until AS "lockedUntil",
      o.processed_at AS "processedAt",
      o.last_error AS "lastError",
      o.created_at AS "createdAt";
  `);
}

export async function markOutboxProcessed(
  prisma: PrismaClient,
  id: string,
): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: 'PROCESSED',
      processedAt: new Date(),
      lastError: null,
      lockedAt: null,
      lockedUntil: null,
    },
  });
}

export async function markOutboxRetry(
  prisma: PrismaClient,
  id: string,
  lastError: string,
  delayMs: number,
): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: 'PENDING',
      availableAt: new Date(Date.now() + delayMs),
      lastError: lastError.slice(0, 2000),
      lockedAt: null,
      lockedUntil: null,
    },
  });
}

export async function markOutboxDeadLetter(
  prisma: PrismaClient,
  id: string,
  lastError: string,
): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: 'DEAD_LETTER',
      lastError: lastError.slice(0, 2000),
      lockedAt: null,
      lockedUntil: null,
    },
  });
}

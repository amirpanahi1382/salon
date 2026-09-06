import { Prisma, type PrismaClient } from '@prisma/client';

export async function deleteProcessedOutboxBatch(
  prisma: PrismaClient,
  olderThanDays: number,
  batchSize: number,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    DELETE FROM outbox_events
    WHERE id IN (
      SELECT id
      FROM outbox_events
      WHERE status = 'PROCESSED'::"OutboxStatus"
        AND processed_at IS NOT NULL
        AND processed_at < NOW() - (${olderThanDays} * INTERVAL '1 day')
      ORDER BY processed_at ASC
      LIMIT ${batchSize}
    )
    RETURNING id
  `);
  return rows.length;
}

export async function deleteExpiredIdempotencyBatch(
  prisma: PrismaClient,
  olderThanDays: number,
  batchSize: number,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    DELETE FROM idempotency_records
    WHERE id IN (
      SELECT id
      FROM idempotency_records
      WHERE created_at < NOW() - (${olderThanDays} * INTERVAL '1 day')
      ORDER BY created_at ASC
      LIMIT ${batchSize}
    )
    RETURNING id
  `);
  return rows.length;
}

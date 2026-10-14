import { Prisma } from '@salon/database';

/**
 * One recipient, one bucket. Canonical SENT outranks a later stop.
 * A durable stop outcome outranks "not yet queued" and a cancelled request.
 * Active platform stops are not a bucket; they are a separate current fact.
 */
export const VIP_RECIPIENT_EXECUTION_SQL = Prisma.sql`
  CASE
    WHEN d.status = 'SENT' AND d.submitted_at IS NOT NULL THEN 'SENT'
    WHEN stop_out.id IS NOT NULL THEN 'GLOBALLY_STOPPED'
    WHEN rec.message_request_id IS NULL THEN 'NOT_YET_QUEUED'
    WHEN mr.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN mr.status = 'FAILED' OR d.status = 'FAILED' THEN 'FAILED'
    WHEN mr.status = 'DISPATCHED' OR d.status IN ('PENDING', 'PROCESSING') THEN 'IN_PIPELINE'
    ELSE 'QUEUED'
  END
`;

export const VIP_RECIPIENT_STOP_JOIN = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT o.id
    FROM message_global_stop_outcomes o
    WHERE o.vip_request_recipient_id = rec.id
       OR (rec.message_request_id IS NOT NULL AND o.message_request_id = rec.message_request_id)
    LIMIT 1
  ) stop_out ON true
`;

export const VIP_RECIPIENT_PROGRESS_COUNTS = Prisma.sql`
  COUNT(rec.id)::int AS "recipientCount",
  COUNT(rec.id) FILTER (WHERE ${VIP_RECIPIENT_EXECUTION_SQL} = 'NOT_YET_QUEUED')::int
    AS "notYetQueuedCount",
  COUNT(rec.id) FILTER (WHERE ${VIP_RECIPIENT_EXECUTION_SQL} = 'QUEUED')::int AS "queuedCount",
  COUNT(rec.id) FILTER (WHERE ${VIP_RECIPIENT_EXECUTION_SQL} = 'IN_PIPELINE')::int AS "inPipelineCount",
  COUNT(rec.id) FILTER (WHERE ${VIP_RECIPIENT_EXECUTION_SQL} = 'SENT')::int AS "sentCount",
  COUNT(rec.id) FILTER (WHERE ${VIP_RECIPIENT_EXECUTION_SQL} = 'SENT' AND d.mode = 'MANUAL')::int
    AS "manualSentCount",
  COUNT(rec.id) FILTER (WHERE ${VIP_RECIPIENT_EXECUTION_SQL} = 'FAILED')::int AS "failedCount",
  COUNT(rec.id) FILTER (WHERE ${VIP_RECIPIENT_EXECUTION_SQL} = 'CANCELLED')::int AS "cancelledCount",
  COUNT(rec.id) FILTER (WHERE ${VIP_RECIPIENT_EXECUTION_SQL} = 'GLOBALLY_STOPPED')::int
    AS "globallyStoppedCount",
  COUNT(*) FILTER (
    WHERE rec.id IS NOT NULL
      AND stop_out.id IS NULL
      AND EXISTS (
        SELECT 1
        FROM platform_message_stops active_stop
        WHERE active_stop.phone_number = rec.phone_number
          AND active_stop.active = true
      )
  )::int AS "activeStopWithoutDurableSkipCount",
  MAX(d.submitted_at) FILTER (
    WHERE ${VIP_RECIPIENT_EXECUTION_SQL} = 'SENT' AND d.mode = 'MANUAL'
  ) AS "latestManualSentAt"
`;

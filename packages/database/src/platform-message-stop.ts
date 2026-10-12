import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export const PLATFORM_MESSAGE_STOP_REASON = 'RECIPIENT_REQUEST';

type StopDb = Prisma.TransactionClient;

/** Two-int advisory lock. The SQL arguments are a hash, not the phone. */
export function platformMessagePhoneLockKeys(phone: string): [number, number] {
  const digest = createHash('sha256').update(`platform-message-stop:${phone}`).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export async function lockPlatformMessagePhone(tx: StopDb, phone: string): Promise<void> {
  const [first, second] = platformMessagePhoneLockKeys(phone);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${first}::integer, ${second}::integer)`;
}

export async function isActivePlatformMessageStop(tx: StopDb, phone: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ active: boolean }>>`
    SELECT active
    FROM platform_message_stops
    WHERE phone_number = ${phone}
    FOR UPDATE
  `;
  return rows[0]?.active === true;
}

/**
 * Records that unsent work for this phone must not be sent.
 * Canonical SENT rows are left unchanged. Delivery rows are not marked SENT or FAILED.
 * Returns how many requests were newly terminal-blocked.
 */
export async function blockUnsentMessagesForPhone(
  tx: StopDb,
  phone: string,
  now: Date,
): Promise<number> {
  const requests = await tx.$queryRaw<Array<{ id: string; salon_id: string }>>`
    SELECT mr.id, mr.salon_id
    FROM message_requests mr
    WHERE mr.recipient_phone_number = ${phone}
      AND mr.status IN ('QUEUED'::"MessageRequestStatus", 'DISPATCHED'::"MessageRequestStatus")
      AND NOT EXISTS (
        SELECT 1
        FROM message_deliveries d
        WHERE d.message_request_id = mr.id
          AND d.status = 'SENT'::"MessageDeliveryStatus"
          AND d.submitted_at IS NOT NULL
      )
    FOR UPDATE OF mr
  `;
  let blocked = 0;
  for (const request of requests) {
    const cancelled = await tx.$executeRaw`
      UPDATE message_requests
      SET status = 'CANCELLED'::"MessageRequestStatus", updated_at = ${now}
      WHERE id = ${request.id}::uuid
        AND salon_id = ${request.salon_id}::uuid
        AND status IN ('QUEUED'::"MessageRequestStatus", 'DISPATCHED'::"MessageRequestStatus")
    `;
    if (cancelled === 0) continue;
    await tx.$executeRaw`
      UPDATE outbox_events
      SET status = 'PROCESSED'::"OutboxStatus",
          processed_at = ${now},
          locked_at = NULL,
          locked_until = NULL
      WHERE tenant_id = ${request.salon_id}::uuid
        AND status IN ('PENDING'::"OutboxStatus", 'PROCESSING'::"OutboxStatus")
        AND payload->>'messageRequestId' = ${request.id}
    `;
    await tx.$executeRaw`
      INSERT INTO message_global_stop_outcomes (
        id, salon_id, phone_number, reason_code, message_request_id, created_at
      )
      VALUES (
        gen_random_uuid(),
        ${request.salon_id}::uuid,
        ${phone},
        ${PLATFORM_MESSAGE_STOP_REASON},
        ${request.id}::uuid,
        ${now}
      )
      ON CONFLICT (message_request_id, salon_id) DO NOTHING
    `;
    blocked += 1;
  }
  return blocked;
}

export async function recordVipRecipientGlobalStop(
  tx: StopDb,
  input: { recipientId: string; salonId: string; phone: string; now: Date },
): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO message_global_stop_outcomes (
      id, salon_id, phone_number, reason_code, vip_request_recipient_id, created_at
    )
    VALUES (
      gen_random_uuid(),
      ${input.salonId}::uuid,
      ${input.phone},
      ${PLATFORM_MESSAGE_STOP_REASON},
      ${input.recipientId}::uuid,
      ${input.now}
    )
    ON CONFLICT (vip_request_recipient_id, salon_id) DO NOTHING
  `;
  return inserted > 0;
}

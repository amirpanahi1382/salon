-- Replace the two-column customer list index with a unique-tie-breaker composite
-- used by cursor pagination (created_at DESC, id DESC).
DROP INDEX IF EXISTS "customers_salon_id_created_at_idx";
CREATE INDEX "customers_salon_id_created_at_id_idx" ON "customers"("salon_id", "created_at", "id");

-- Retention deletes PROCESSED outbox rows by processed_at in bounded batches.
CREATE INDEX "outbox_events_processed_at_idx" ON "outbox_events"("processed_at");

-- Claim path filters PENDING/PROCESSING then orders by created_at (seq scan at ~1k rows).
CREATE INDEX "outbox_events_claimable_created_at_idx"
ON "outbox_events" ("created_at")
WHERE status IN ('PENDING', 'PROCESSING');

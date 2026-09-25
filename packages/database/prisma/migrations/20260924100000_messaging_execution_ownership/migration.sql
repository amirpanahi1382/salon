ALTER TABLE "outbox_events"
  ADD COLUMN "claim_generation" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "outbox_events_dedupe_key_key"
  ON "outbox_events" ("dedupe_key");

ALTER TABLE "message_deliveries"
  ADD COLUMN "execution_generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "execution_token" TEXT,
  ADD COLUMN "execution_locked_until" TIMESTAMPTZ(3);

ALTER TABLE "message_deliveries"
  ADD CONSTRAINT "message_deliveries_execution_generation_nonnegative"
  CHECK ("execution_generation" >= 0);

ALTER TABLE "message_deliveries"
  ADD CONSTRAINT "message_deliveries_execution_lease_pair"
  CHECK (("execution_token" IS NULL) = ("execution_locked_until" IS NULL));

ALTER TABLE "message_deliveries"
  ADD CONSTRAINT "message_deliveries_terminal_has_no_execution_owner"
  CHECK ("status" NOT IN ('SENT', 'FAILED') OR "execution_token" IS NULL);

CREATE INDEX "outbox_events_processing_lease_idx"
  ON "outbox_events" ("status", "locked_until")
  WHERE "status" = 'PROCESSING';

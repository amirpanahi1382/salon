-- Platform-wide "do not message this canonical phone" policy.
-- Current row is unique per phone. Events are append-only. Outcomes record
-- unsent work that was skipped; they do not rewrite SENT evidence.

CREATE TYPE "PlatformMessageStopAction" AS ENUM ('REGISTERED', 'LIFTED');

CREATE TABLE "platform_message_stops" (
    "id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "reason_code" TEXT NOT NULL,
    "registered_by_admin_id" UUID NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL,
    "lifted_by_admin_id" UUID,
    "lifted_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_message_stops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_message_stops_phone_number_key"
  ON "platform_message_stops"("phone_number");

CREATE INDEX "platform_message_stops_active_phone_number_idx"
  ON "platform_message_stops"("active", "phone_number");

ALTER TABLE "platform_message_stops"
  ADD CONSTRAINT "platform_message_stops_phone_chk"
  CHECK ("phone_number" ~ '^09[0-9]{9}$'),
  ADD CONSTRAINT "platform_message_stops_reason_chk"
  CHECK ("reason_code" = 'RECIPIENT_REQUEST'),
  ADD CONSTRAINT "platform_message_stops_lift_chk"
  CHECK (
    ("active" = true AND "lifted_at" IS NULL AND "lifted_by_admin_id" IS NULL)
    OR ("active" = false AND "lifted_at" IS NOT NULL AND "lifted_by_admin_id" IS NOT NULL)
  );

ALTER TABLE "platform_message_stops"
  ADD CONSTRAINT "platform_message_stops_registered_by_fkey"
  FOREIGN KEY ("registered_by_admin_id") REFERENCES "platform_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "platform_message_stops_lifted_by_fkey"
  FOREIGN KEY ("lifted_by_admin_id") REFERENCES "platform_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "platform_message_stop_events" (
    "id" UUID NOT NULL,
    "stop_id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "action" "PlatformMessageStopAction" NOT NULL,
    "reason_code" TEXT NOT NULL,
    "actor_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_message_stop_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_message_stop_events_stop_id_created_at_idx"
  ON "platform_message_stop_events"("stop_id", "created_at");

ALTER TABLE "platform_message_stop_events"
  ADD CONSTRAINT "platform_message_stop_events_phone_chk"
  CHECK ("phone_number" ~ '^09[0-9]{9}$'),
  ADD CONSTRAINT "platform_message_stop_events_reason_chk"
  CHECK ("reason_code" = 'RECIPIENT_REQUEST');

ALTER TABLE "platform_message_stop_events"
  ADD CONSTRAINT "platform_message_stop_events_stop_fkey"
  FOREIGN KEY ("stop_id") REFERENCES "platform_message_stops"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "platform_message_stop_events_actor_fkey"
  FOREIGN KEY ("actor_admin_id") REFERENCES "platform_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "message_global_stop_outcomes" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "message_request_id" UUID,
    "vip_request_recipient_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_global_stop_outcomes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_global_stop_outcomes_message_request_id_salon_id_key"
  ON "message_global_stop_outcomes"("message_request_id", "salon_id");

CREATE UNIQUE INDEX "message_global_stop_outcomes_vip_request_recipient_id_salon_id_key"
  ON "message_global_stop_outcomes"("vip_request_recipient_id", "salon_id");

CREATE INDEX "message_global_stop_outcomes_salon_id_created_at_idx"
  ON "message_global_stop_outcomes"("salon_id", "created_at");

CREATE INDEX "message_global_stop_outcomes_phone_number_idx"
  ON "message_global_stop_outcomes"("phone_number");

ALTER TABLE "message_global_stop_outcomes"
  ADD CONSTRAINT "message_global_stop_outcomes_phone_chk"
  CHECK ("phone_number" ~ '^09[0-9]{9}$'),
  ADD CONSTRAINT "message_global_stop_outcomes_reason_chk"
  CHECK ("reason_code" = 'RECIPIENT_REQUEST'),
  ADD CONSTRAINT "message_global_stop_outcomes_target_chk"
  CHECK ("message_request_id" IS NOT NULL OR "vip_request_recipient_id" IS NOT NULL);

ALTER TABLE "message_global_stop_outcomes"
  ADD CONSTRAINT "message_global_stop_outcomes_salon_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salons"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message_global_stop_outcomes"
  ADD CONSTRAINT "message_global_stop_outcomes_request_salon_fkey"
  FOREIGN KEY ("message_request_id", "salon_id") REFERENCES "message_requests"("id", "salon_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message_global_stop_outcomes"
  ADD CONSTRAINT "message_global_stop_outcomes_recipient_salon_fkey"
  FOREIGN KEY ("vip_request_recipient_id", "salon_id") REFERENCES "vip_request_recipients"("id", "salon_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

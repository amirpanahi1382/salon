-- Durable message intent (MessageRequest) separate from provider delivery.
-- Bale is a delivery mode, not a requirement for queueing.
-- Daily uniqueness uses Asia/Tehran calendar dates; stored timestamps remain timestamptz UTC.
--
-- Historical MessageDelivery rows are backfilled 1:1 with counts_toward_daily_limit = false.
-- The one-request-per-customer-per-Tehran-day rule applies only to new salon requests
-- (counts_toward_daily_limit = true), via a partial unique index.

CREATE TYPE "MessageRequestStatus" AS ENUM ('QUEUED', 'DISPATCHED', 'SENT', 'FAILED');
CREATE TYPE "MessageDeliveryMode" AS ENUM ('BALE', 'MANUAL');

CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

CREATE TABLE "message_requests" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "opportunity_type" "OpportunityActionType" NOT NULL,
    "message_text" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_business_date" DATE NOT NULL,
    "counts_toward_daily_limit" BOOLEAN NOT NULL DEFAULT true,
    "status" "MessageRequestStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_requests_text_length_check" CHECK (char_length("message_text") BETWEEN 1 AND 4096)
);

INSERT INTO "message_requests" (
    "id",
    "salon_id",
    "customer_id",
    "action_id",
    "created_by_user_id",
    "opportunity_type",
    "message_text",
    "requested_at",
    "message_business_date",
    "counts_toward_daily_limit",
    "status",
    "created_at",
    "updated_at"
)
SELECT
    md."id",
    md."salon_id",
    md."customer_id",
    md."action_id",
    md."created_by",
    oa."opportunity_type",
    md."body",
    md."created_at",
    (md."created_at" AT TIME ZONE 'Asia/Tehran')::date,
    false,
    CASE md."status"
        WHEN 'SENT' THEN 'SENT'::"MessageRequestStatus"
        WHEN 'FAILED' THEN 'FAILED'::"MessageRequestStatus"
        ELSE 'DISPATCHED'::"MessageRequestStatus"
    END,
    md."created_at",
    md."updated_at"
FROM "message_deliveries" md
INNER JOIN "opportunity_actions" oa ON oa."id" = md."action_id" AND oa."salon_id" = md."salon_id";

CREATE UNIQUE INDEX "message_requests_id_salon_id_key" ON "message_requests"("id", "salon_id");
CREATE UNIQUE INDEX "message_requests_salon_customer_day_key"
    ON "message_requests"("salon_id", "customer_id", "message_business_date")
    WHERE "counts_toward_daily_limit";
CREATE INDEX "message_requests_status_requested_at_id_idx" ON "message_requests"("status", "requested_at", "id");
CREATE INDEX "message_requests_salon_id_requested_at_id_idx" ON "message_requests"("salon_id", "requested_at", "id");
CREATE INDEX "message_requests_salon_id_customer_id_requested_at_id_idx" ON "message_requests"("salon_id", "customer_id", "requested_at", "id");
CREATE INDEX "message_requests_customer_id_requested_at_idx" ON "message_requests"("customer_id", "requested_at");
CREATE INDEX "message_requests_salon_id_customer_id_message_business_date_idx" ON "message_requests"("salon_id", "customer_id", "message_business_date");

ALTER TABLE "message_requests" ADD CONSTRAINT "message_requests_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_requests" ADD CONSTRAINT "message_requests_customer_id_salon_id_fkey" FOREIGN KEY ("customer_id", "salon_id") REFERENCES "customers"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_requests" ADD CONSTRAINT "message_requests_action_id_salon_id_fkey" FOREIGN KEY ("action_id", "salon_id") REFERENCES "opportunity_actions"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_requests" ADD CONSTRAINT "message_requests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message_deliveries" ADD COLUMN "message_request_id" UUID;
ALTER TABLE "message_deliveries" ADD COLUMN "mode" "MessageDeliveryMode";
ALTER TABLE "message_deliveries" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "message_deliveries" ADD COLUMN "dispatched_by_admin_id" UUID;
ALTER TABLE "message_deliveries" ADD COLUMN "fulfilled_by_admin_id" UUID;

UPDATE "message_deliveries" SET "message_request_id" = "id", "mode" = 'BALE';

ALTER TABLE "message_deliveries" ALTER COLUMN "message_request_id" SET NOT NULL;
ALTER TABLE "message_deliveries" ALTER COLUMN "mode" SET NOT NULL;
ALTER TABLE "message_deliveries" ALTER COLUMN "provider" DROP NOT NULL;

ALTER TABLE "message_deliveries" DROP CONSTRAINT "message_deliveries_body_length_check";
ALTER TABLE "message_deliveries" DROP COLUMN "body";

CREATE UNIQUE INDEX "message_deliveries_message_request_id_key" ON "message_deliveries"("message_request_id");
CREATE INDEX "message_deliveries_mode_status_created_at_idx" ON "message_deliveries"("mode", "status", "created_at");
CREATE INDEX "message_deliveries_status_created_at_id_idx" ON "message_deliveries"("status", "created_at", "id");

ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_message_request_id_salon_id_fkey" FOREIGN KEY ("message_request_id", "salon_id") REFERENCES "message_requests"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_dispatched_by_admin_id_fkey" FOREIGN KEY ("dispatched_by_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_fulfilled_by_admin_id_fkey" FOREIGN KEY ("fulfilled_by_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_mode_provider_check" CHECK (
    ("mode" = 'BALE' AND "provider" = 'BALE_SAFIR')
    OR ("mode" = 'MANUAL' AND "provider" IS NULL)
);
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_attempts_check" CHECK ("attempts" >= 0);

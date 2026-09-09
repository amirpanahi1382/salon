-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');
CREATE TYPE "MessageProvider" AS ENUM ('BALE_SAFIR');
CREATE TYPE "MessageChannel" AS ENUM ('TEXT');

CREATE TABLE "message_deliveries" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "provider" "MessageProvider" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "status" "MessageDeliveryStatus" NOT NULL,
    "body" TEXT NOT NULL,
    "provider_request_id" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "failure_code" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),

    CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_deliveries_status_timestamps_check" CHECK (
        ("status" = 'PENDING' AND "submitted_at" IS NULL AND "failed_at" IS NULL)
        OR ("status" = 'PROCESSING' AND "submitted_at" IS NULL AND "failed_at" IS NULL)
        OR ("status" = 'SENT' AND "submitted_at" IS NOT NULL AND "failed_at" IS NULL)
        OR ("status" = 'FAILED' AND "failed_at" IS NOT NULL AND "submitted_at" IS NULL)
    ),
    CONSTRAINT "message_deliveries_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 4096)
);

CREATE UNIQUE INDEX "message_deliveries_id_salon_id_key" ON "message_deliveries"("id", "salon_id");
CREATE UNIQUE INDEX "message_deliveries_salon_id_provider_request_id_key" ON "message_deliveries"("salon_id", "provider_request_id");
CREATE INDEX "message_deliveries_salon_id_customer_id_created_at_id_idx" ON "message_deliveries"("salon_id", "customer_id", "created_at", "id");
CREATE INDEX "message_deliveries_salon_id_status_created_at_idx" ON "message_deliveries"("salon_id", "status", "created_at");
CREATE INDEX "message_deliveries_salon_id_action_id_idx" ON "message_deliveries"("salon_id", "action_id");

ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_customer_id_salon_id_fkey" FOREIGN KEY ("customer_id", "salon_id") REFERENCES "customers"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_action_id_salon_id_fkey" FOREIGN KEY ("action_id", "salon_id") REFERENCES "opportunity_actions"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

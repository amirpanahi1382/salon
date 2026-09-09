-- CreateEnum
CREATE TYPE "OpportunityActionStatus" AS ENUM ('OPEN', 'COMPLETED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "OpportunityActionType" AS ENUM ('REACTIVATION', 'CUSTOMER_RETURN', 'REVENUE_DECLINE');

CREATE TABLE "opportunity_actions" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "opportunity_type" "OpportunityActionType" NOT NULL,
    "status" "OpportunityActionStatus" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "dismissed_at" TIMESTAMPTZ(3),

    CONSTRAINT "opportunity_actions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "opportunity_actions_status_timestamps_check" CHECK (
        ("status" = 'OPEN' AND "completed_at" IS NULL AND "dismissed_at" IS NULL)
        OR ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL AND "dismissed_at" IS NULL)
        OR ("status" = 'DISMISSED' AND "dismissed_at" IS NOT NULL AND "completed_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "opportunity_actions_id_salon_id_key" ON "opportunity_actions"("id", "salon_id");
CREATE INDEX "opportunity_actions_salon_id_status_created_at_id_idx" ON "opportunity_actions"("salon_id", "status", "created_at", "id");
CREATE INDEX "opportunity_actions_salon_id_customer_id_created_at_id_idx" ON "opportunity_actions"("salon_id", "customer_id", "created_at", "id");
CREATE INDEX "opportunity_actions_salon_id_created_at_id_idx" ON "opportunity_actions"("salon_id", "created_at", "id");
CREATE UNIQUE INDEX "opportunity_actions_one_open_per_opportunity" ON "opportunity_actions"("salon_id", "customer_id", "opportunity_type") WHERE "status" = 'OPEN';

ALTER TABLE "opportunity_actions" ADD CONSTRAINT "opportunity_actions_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_actions" ADD CONSTRAINT "opportunity_actions_customer_id_salon_id_fkey" FOREIGN KEY ("customer_id", "salon_id") REFERENCES "customers"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_actions" ADD CONSTRAINT "opportunity_actions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

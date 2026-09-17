-- Additive tenant-safe uniqueness so ReturnCommitment creator/updater FKs
-- can reference users(id, salon_id) without repeating TD-03.
CREATE UNIQUE INDEX "users_id_salon_id_key" ON "users"("id", "salon_id");

-- Product-originated return commitments. Not appointments, bookings, or visits.
CREATE TABLE "return_commitments" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "source_message_request_id" UUID NOT NULL,
    "source_message_delivery_id" UUID NOT NULL,
    "expected_at" TIMESTAMPTZ(3) NOT NULL,
    "actual_visit_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_commitments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "return_commitments_id_salon_id_key" ON "return_commitments"("id", "salon_id");
CREATE UNIQUE INDEX "return_commitments_salon_source_request_key" ON "return_commitments"("salon_id", "source_message_request_id");
CREATE UNIQUE INDEX "return_commitments_salon_source_delivery_key" ON "return_commitments"("salon_id", "source_message_delivery_id");
CREATE UNIQUE INDEX "return_commitments_salon_actual_visit_key" ON "return_commitments"("salon_id", "actual_visit_id") WHERE "actual_visit_id" IS NOT NULL;
CREATE INDEX "return_commitments_salon_id_customer_id_expected_at_id_idx" ON "return_commitments"("salon_id", "customer_id", "expected_at", "id");
CREATE INDEX "return_commitments_salon_id_expected_at_id_idx" ON "return_commitments"("salon_id", "expected_at", "id");

ALTER TABLE "return_commitments" ADD CONSTRAINT "return_commitments_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_commitments" ADD CONSTRAINT "return_commitments_customer_id_salon_id_fkey" FOREIGN KEY ("customer_id", "salon_id") REFERENCES "customers"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_commitments" ADD CONSTRAINT "return_commitments_source_request_salon_fkey" FOREIGN KEY ("source_message_request_id", "salon_id") REFERENCES "message_requests"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_commitments" ADD CONSTRAINT "return_commitments_source_delivery_salon_fkey" FOREIGN KEY ("source_message_delivery_id", "salon_id") REFERENCES "message_deliveries"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_commitments" ADD CONSTRAINT "return_commitments_actual_visit_salon_fkey" FOREIGN KEY ("actual_visit_id", "salon_id") REFERENCES "visits"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_commitments" ADD CONSTRAINT "return_commitments_created_by_user_salon_fkey" FOREIGN KEY ("created_by_user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_commitments" ADD CONSTRAINT "return_commitments_updated_by_user_salon_fkey" FOREIGN KEY ("updated_by_user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;

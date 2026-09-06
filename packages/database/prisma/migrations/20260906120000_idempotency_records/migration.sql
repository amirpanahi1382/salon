-- Client retry keys for Visit creation (and future selected writes).
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_records_tenant_id_actor_id_operation_key_key"
  ON "idempotency_records"("tenant_id", "actor_id", "operation", "key");

CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"("created_at");

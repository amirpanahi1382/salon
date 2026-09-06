-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('COMPLETED', 'VOIDED');

CREATE UNIQUE INDEX "visits_id_salon_id_key" ON "visits"("id", "salon_id");

CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "services_id_salon_id_key" ON "services"("id", "salon_id");
CREATE UNIQUE INDEX "services_salon_id_name_key" ON "services"("salon_id", "name");
CREATE INDEX "services_salon_id_status_idx" ON "services"("salon_id", "status");

ALTER TABLE "services" ADD CONSTRAINT "services_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "visit_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'IRR',
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transactions_amount_nonnegative" CHECK ("amount" >= 0),
    CONSTRAINT "transactions_currency_irr" CHECK ("currency" = 'IRR')
);

CREATE UNIQUE INDEX "transactions_id_salon_id_key" ON "transactions"("id", "salon_id");
CREATE INDEX "transactions_salon_id_occurred_at_id_idx" ON "transactions"("salon_id", "occurred_at", "id");
CREATE INDEX "transactions_salon_id_customer_id_occurred_at_idx" ON "transactions"("salon_id", "customer_id", "occurred_at");
CREATE INDEX "transactions_salon_id_status_occurred_at_idx" ON "transactions"("salon_id", "status", "occurred_at");
CREATE INDEX "transactions_salon_id_visit_id_idx" ON "transactions"("salon_id", "visit_id");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_salon_id_fkey" FOREIGN KEY ("customer_id", "salon_id") REFERENCES "customers"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_visit_id_salon_id_fkey" FOREIGN KEY ("visit_id", "salon_id") REFERENCES "visits"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "transaction_items" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(19,2) NOT NULL,
    "total_amount" DECIMAL(19,2) NOT NULL,

    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transaction_items_quantity_positive" CHECK ("quantity" >= 1),
    CONSTRAINT "transaction_items_unit_price_nonnegative" CHECK ("unit_price" >= 0),
    CONSTRAINT "transaction_items_total_amount_nonnegative" CHECK ("total_amount" >= 0)
);

CREATE INDEX "transaction_items_salon_id_transaction_id_idx" ON "transaction_items"("salon_id", "transaction_id");

ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_salon_id_fkey" FOREIGN KEY ("transaction_id", "salon_id") REFERENCES "transactions"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_service_id_salon_id_fkey" FOREIGN KEY ("service_id", "salon_id") REFERENCES "services"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;

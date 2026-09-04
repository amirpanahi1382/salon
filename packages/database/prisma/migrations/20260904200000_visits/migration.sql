-- Composite identity so visits cannot reference a customer from another salon.
CREATE UNIQUE INDEX "customers_id_salon_id_key" ON "customers"("id", "salon_id");

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "visited_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visits_salon_id_visited_at_idx" ON "visits"("salon_id", "visited_at");
CREATE INDEX "visits_salon_id_customer_id_visited_at_idx" ON "visits"("salon_id", "customer_id", "visited_at");

ALTER TABLE "visits" ADD CONSTRAINT "visits_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_customer_id_salon_id_fkey" FOREIGN KEY ("customer_id", "salon_id") REFERENCES "customers"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;

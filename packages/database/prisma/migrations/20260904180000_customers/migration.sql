-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_salon_id_phone_number_key" ON "customers"("salon_id", "phone_number");
CREATE INDEX "customers_salon_id_created_at_idx" ON "customers"("salon_id", "created_at");

ALTER TABLE "customers" ADD CONSTRAINT "customers_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

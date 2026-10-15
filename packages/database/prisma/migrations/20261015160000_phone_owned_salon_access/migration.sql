-- Phone-owned salon owner and restricted product access.
-- Existing salons stay PRODUCT with additional users allowed.
-- Existing users keep their email. Phone is null until a phone-owned owner is created.
-- Email and phone are never both set, and neither may be missing.

CREATE TYPE "SalonAccessState" AS ENUM ('PRODUCT', 'AWAITING_AGREEMENT');

ALTER TABLE "salons"
  ADD COLUMN "access_state" "SalonAccessState" NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN "additional_users_allowed" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "users"
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN "phone" TEXT;

CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

ALTER TABLE "users"
  ADD CONSTRAINT "users_login_identity_chk"
  CHECK (
    ("email" IS NOT NULL AND "phone" IS NULL)
    OR ("email" IS NULL AND "phone" IS NOT NULL)
  ),
  ADD CONSTRAINT "users_phone_format_chk"
  CHECK ("phone" IS NULL OR "phone" ~ '^09[0-9]{9}$');

CREATE TABLE "phone_owner_completions" (
  "id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "salon_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "phone_owner_completions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phone_owner_completions_idempotency_key_key"
  ON "phone_owner_completions"("idempotency_key");
CREATE UNIQUE INDEX "phone_owner_completions_salon_id_key"
  ON "phone_owner_completions"("salon_id");
CREATE UNIQUE INDEX "phone_owner_completions_user_id_key"
  ON "phone_owner_completions"("user_id");
CREATE UNIQUE INDEX "phone_owner_completions_user_id_salon_id_key"
  ON "phone_owner_completions"("user_id", "salon_id");

ALTER TABLE "phone_owner_completions"
  ADD CONSTRAINT "phone_owner_completions_key_chk"
  CHECK ("idempotency_key" ~ '^[A-Za-z0-9._-]{8,128}$'),
  ADD CONSTRAINT "phone_owner_completions_request_hash_chk"
  CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "phone_owner_completions"
  ADD CONSTRAINT "phone_owner_completions_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "phone_owner_completions_user_id_salon_id_fkey"
  FOREIGN KEY ("user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A phone-owned salon already has its owner. Historical salons keep additional_users_allowed.
CREATE FUNCTION "users_reject_extra_member"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  single_owner boolean;
BEGIN
  -- Lock the salon so two concurrent inserts cannot both pass the empty-user check.
  SELECT "additional_users_allowed" = false
  INTO single_owner
  FROM "salons"
  WHERE "id" = NEW."salon_id"
  FOR UPDATE;

  IF single_owner AND EXISTS (
    SELECT 1
    FROM "users"
    WHERE "salon_id" = NEW."salon_id"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'users_single_owner_salon',
      MESSAGE = 'additional salon users are not allowed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "users_single_owner_salon"
  BEFORE INSERT ON "users"
  FOR EACH ROW
  EXECUTE FUNCTION "users_reject_extra_member"();

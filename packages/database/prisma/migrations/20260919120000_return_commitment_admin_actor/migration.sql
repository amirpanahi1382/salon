-- Platform Admin may record the same canonical ReturnCommitment.
-- Actor is XOR salon User XOR PlatformAdmin. Existing rows stay salon-user created.

ALTER TABLE "return_commitments"
  ALTER COLUMN "created_by_user_id" DROP NOT NULL,
  ALTER COLUMN "updated_by_user_id" DROP NOT NULL;

ALTER TABLE "return_commitments"
  ADD COLUMN "created_by_platform_admin_id" UUID,
  ADD COLUMN "updated_by_platform_admin_id" UUID;

ALTER TABLE "return_commitments"
  ADD CONSTRAINT "return_commitments_created_by_admin_fkey"
  FOREIGN KEY ("created_by_platform_admin_id") REFERENCES "platform_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "return_commitments"
  ADD CONSTRAINT "return_commitments_updated_by_admin_fkey"
  FOREIGN KEY ("updated_by_platform_admin_id") REFERENCES "platform_admins"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "return_commitments"
  ADD CONSTRAINT "return_commitments_created_actor_chk" CHECK (
    ("created_by_user_id" IS NOT NULL AND "created_by_platform_admin_id" IS NULL)
    OR ("created_by_user_id" IS NULL AND "created_by_platform_admin_id" IS NOT NULL)
  );

ALTER TABLE "return_commitments"
  ADD CONSTRAINT "return_commitments_updated_actor_chk" CHECK (
    ("updated_by_user_id" IS NOT NULL AND "updated_by_platform_admin_id" IS NULL)
    OR ("updated_by_user_id" IS NULL AND "updated_by_platform_admin_id" IS NOT NULL)
  );

CREATE INDEX "return_commitments_open_salon_expected_id_idx"
  ON "return_commitments" ("salon_id", "expected_at", "id")
  WHERE "actual_visit_id" IS NULL;

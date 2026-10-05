-- Reviewed catalog membership. Null means the list is not in this collection.
-- It does not mean test, inactive, or invalid, and it does not classify existing rows.

CREATE TYPE "VipCatalogMembership" AS ENUM ('ORIGINAL_TEHRAN');

ALTER TABLE "vip_target_lists"
  ADD COLUMN "catalog_membership" "VipCatalogMembership";

CREATE INDEX "vip_target_lists_catalog_membership_created_at_id_idx"
  ON "vip_target_lists" ("catalog_membership", "created_at", "id");

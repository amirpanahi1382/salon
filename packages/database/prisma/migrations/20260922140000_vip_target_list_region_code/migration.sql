-- Canonical VIP list region identity. Nullable so historical/non-regional
-- lists stay outside region inventory. Non-null values are constrained to 01–14.
-- Does not change reservation, quota, or contact rows.

ALTER TABLE "vip_target_lists"
  ADD COLUMN "region_code" TEXT;

ALTER TABLE "vip_target_lists"
  ADD CONSTRAINT "vip_target_lists_region_code_chk"
  CHECK (
    "region_code" IS NULL
    OR "region_code" IN (
      '01', '02', '03', '04', '05', '06', '07',
      '08', '09', '10', '11', '12', '13', '14'
    )
  );

-- Tenant-scoped VIP children must match VipRequest (id, salon_id).
-- Add the composite FKs first so existing mismatches fail the migration
-- instead of being rewritten. Drop the request-id-only FKs afterward.

ALTER TABLE "vip_sample_works"
  ADD CONSTRAINT "vip_sample_works_vip_request_id_salon_id_fkey"
  FOREIGN KEY ("vip_request_id", "salon_id")
  REFERENCES "vip_requests" ("id", "salon_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_request_recipients"
  ADD CONSTRAINT "vip_request_recipients_vip_request_id_salon_id_fkey"
  FOREIGN KEY ("vip_request_id", "salon_id")
  REFERENCES "vip_requests" ("id", "salon_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_sample_works"
  DROP CONSTRAINT "vip_sample_works_vip_request_id_fkey";

ALTER TABLE "vip_request_recipients"
  DROP CONSTRAINT "vip_request_recipients_vip_request_id_fkey";

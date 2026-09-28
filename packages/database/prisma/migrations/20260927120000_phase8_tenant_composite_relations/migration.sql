-- Install tenant-composite FKs without rewriting or silently assigning historical provenance.
-- NOT VALID enforces new inserts and updated rows, but existing rows need a later
-- explicit VALIDATE CONSTRAINT after the read-only preflight is clean.
BEGIN;

ALTER TABLE "opportunity_actions"
  DROP CONSTRAINT "opportunity_actions_created_by_fkey",
  ADD CONSTRAINT "opportunity_actions_created_by_salon_id_fkey"
    FOREIGN KEY ("created_by", "salon_id") REFERENCES "users"("id", "salon_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "message_requests"
  DROP CONSTRAINT "message_requests_created_by_user_id_fkey",
  ADD CONSTRAINT "message_requests_created_by_user_id_salon_id_fkey"
    FOREIGN KEY ("created_by_user_id", "salon_id") REFERENCES "users"("id", "salon_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "message_deliveries"
  DROP CONSTRAINT "message_deliveries_created_by_fkey",
  ADD CONSTRAINT "message_deliveries_created_by_salon_id_fkey"
    FOREIGN KEY ("created_by", "salon_id") REFERENCES "users"("id", "salon_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "vip_requests"
  DROP CONSTRAINT "vip_requests_created_by_user_id_fkey",
  ADD CONSTRAINT "vip_requests_created_by_user_id_salon_id_fkey"
    FOREIGN KEY ("created_by_user_id", "salon_id") REFERENCES "users"("id", "salon_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "vip_request_recipients"
  DROP CONSTRAINT "vip_request_recipients_message_request_id_fkey",
  ADD CONSTRAINT "vip_request_recipients_message_request_id_salon_id_fkey"
    FOREIGN KEY ("message_request_id", "salon_id") REFERENCES "message_requests"("id", "salon_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

COMMIT;

-- Composite NOT VALID FKs protect new tenant equality, but an old mismatched
-- child does not match its parent's (id, salon_id) pair. Keep the original
-- global-ID parent-existence guarantee for that historical row as well.
-- VALIDATE scans existing rows and fails atomically if a parent was lost.
BEGIN;

ALTER TABLE "opportunity_actions"
  ADD CONSTRAINT "opportunity_actions_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "message_requests"
  ADD CONSTRAINT "message_requests_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "message_deliveries"
  ADD CONSTRAINT "message_deliveries_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "vip_requests"
  ADD CONSTRAINT "vip_requests_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "vip_request_recipients"
  ADD CONSTRAINT "vip_request_recipients_message_request_id_fkey"
    FOREIGN KEY ("message_request_id") REFERENCES "message_requests"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE "opportunity_actions" VALIDATE CONSTRAINT "opportunity_actions_created_by_fkey";
ALTER TABLE "message_requests" VALIDATE CONSTRAINT "message_requests_created_by_user_id_fkey";
ALTER TABLE "message_deliveries" VALIDATE CONSTRAINT "message_deliveries_created_by_fkey";
ALTER TABLE "vip_requests" VALIDATE CONSTRAINT "vip_requests_created_by_user_id_fkey";
ALTER TABLE "vip_request_recipients" VALIDATE CONSTRAINT "vip_request_recipients_message_request_id_fkey";

COMMIT;

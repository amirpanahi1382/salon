-- Apply only after the read-only historical-integrity preflight is clean on
-- the intended database. VALIDATE scans existing rows and takes a lock that
-- conflicts with concurrent schema changes, but does not rewrite history.
-- The migrator deliberately has no role-wide timeout, so bound this migration's
-- schema-lock wait without changing ordinary migration behaviour.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "opportunity_actions"
  VALIDATE CONSTRAINT "opportunity_actions_created_by_salon_id_fkey";
ALTER TABLE "message_requests"
  VALIDATE CONSTRAINT "message_requests_created_by_user_id_salon_id_fkey";
ALTER TABLE "message_deliveries"
  VALIDATE CONSTRAINT "message_deliveries_created_by_salon_id_fkey";
ALTER TABLE "vip_requests"
  VALIDATE CONSTRAINT "vip_requests_created_by_user_id_salon_id_fkey";
ALTER TABLE "vip_request_recipients"
  VALIDATE CONSTRAINT "vip_request_recipients_message_request_id_salon_id_fkey";

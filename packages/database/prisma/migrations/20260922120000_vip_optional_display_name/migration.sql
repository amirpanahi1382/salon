-- VIP target and request-recipient display names are optional.
-- Phone remains the required identity. Historical non-null names are preserved.

ALTER TABLE "vip_target_contacts"
  ALTER COLUMN "display_name" DROP NOT NULL;

ALTER TABLE "vip_request_recipients"
  ALTER COLUMN "display_name" DROP NOT NULL;

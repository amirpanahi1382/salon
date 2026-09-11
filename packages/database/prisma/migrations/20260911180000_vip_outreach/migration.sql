-- VIP outreach: platform-admin target lists, salon entitlement, requests,
-- historical recipient snapshots, sample-work metadata.
-- MessageRequest may target a VIP recipient instead of a salon Customer.
-- Existing customer/opportunity/manual rows are not rewritten.

ALTER TABLE "message_requests" ALTER COLUMN "customer_id" DROP NOT NULL;
ALTER TABLE "message_deliveries" ALTER COLUMN "customer_id" DROP NOT NULL;

ALTER TABLE "message_requests"
  ADD COLUMN "vip_request_id" UUID,
  ADD COLUMN "recipient_display_name" TEXT,
  ADD COLUMN "recipient_phone_number" TEXT;

CREATE TYPE "VipTargetListStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'IN_USE');
CREATE TYPE "VipRequestStatus" AS ENUM (
  'AWAITING_SAMPLE_WORK',
  'SUBMITTED',
  'MANUAL_QUEUED',
  'BALE_NOT_IMPLEMENTED',
  'CANCELLED'
);

CREATE TABLE "vip_target_lists" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "status" "VipTargetListStatus" NOT NULL,
  "contact_count" INTEGER NOT NULL,
  "created_by_admin_id" UUID NOT NULL,
  "reserved_by_salon_id" UUID,
  "reserved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "vip_target_lists_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vip_target_lists_contact_count_range"
    CHECK ("contact_count" >= 1 AND "contact_count" <= 100),
  CONSTRAINT "vip_target_lists_reservation_consistent"
    CHECK (
      (
        "status" = 'IN_USE'
        AND "reserved_by_salon_id" IS NOT NULL
        AND "reserved_at" IS NOT NULL
      )
      OR (
        "status" <> 'IN_USE'
        AND "reserved_by_salon_id" IS NULL
        AND "reserved_at" IS NULL
      )
    )
);

CREATE TABLE "vip_target_contacts" (
  "id" UUID NOT NULL,
  "list_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "display_name" TEXT NOT NULL,
  "phone_number" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vip_target_contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vip_target_contacts_sort_order_positive" CHECK ("sort_order" >= 1),
  CONSTRAINT "vip_target_contacts_phone_canonical" CHECK ("phone_number" ~ '^09[0-9]{9}$')
);

CREATE TABLE "vip_salon_entitlements" (
  "id" UUID NOT NULL,
  "salon_id" UUID NOT NULL,
  "granted_by_admin_id" UUID NOT NULL,
  "granted_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "revoked_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "vip_salon_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vip_salon_entitlements_revoke_consistent"
    CHECK (
      ("revoked_at" IS NULL AND "revoked_by_admin_id" IS NULL)
      OR ("revoked_at" IS NOT NULL AND "revoked_by_admin_id" IS NOT NULL)
    )
);

CREATE TABLE "vip_requests" (
  "id" UUID NOT NULL,
  "salon_id" UUID NOT NULL,
  "list_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "requested_count" INTEGER NOT NULL,
  "geographic_range" TEXT NOT NULL,
  "status" "VipRequestStatus" NOT NULL,
  "reserved_until" TIMESTAMPTZ(3) NOT NULL,
  "submitted_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "vip_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vip_requests_id_salon_key" UNIQUE ("id", "salon_id"),
  CONSTRAINT "vip_requests_count_allowed" CHECK ("requested_count" IN (30, 50, 100)),
  CONSTRAINT "vip_requests_geo_not_empty" CHECK (char_length(btrim("geographic_range")) > 0),
  CONSTRAINT "vip_requests_submit_cancel_exclusive"
    CHECK (NOT ("submitted_at" IS NOT NULL AND "cancelled_at" IS NOT NULL))
);

CREATE TABLE "vip_request_recipients" (
  "id" UUID NOT NULL,
  "vip_request_id" UUID NOT NULL,
  "salon_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "source_contact_id" UUID NOT NULL,
  "display_name" TEXT NOT NULL,
  "phone_number" TEXT NOT NULL,
  "message_text" TEXT NOT NULL,
  "message_request_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vip_request_recipients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vip_request_recipients_sort_order_positive" CHECK ("sort_order" >= 1),
  CONSTRAINT "vip_request_recipients_phone_canonical" CHECK ("phone_number" ~ '^09[0-9]{9}$')
);

CREATE TABLE "vip_sample_works" (
  "id" UUID NOT NULL,
  "vip_request_id" UUID NOT NULL,
  "salon_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "object_key" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vip_sample_works_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vip_sample_works_position_range" CHECK ("position" >= 1 AND "position" <= 3),
  CONSTRAINT "vip_sample_works_byte_size_positive" CHECK ("byte_size" > 0)
);

ALTER TABLE "vip_target_lists"
  ADD CONSTRAINT "vip_target_lists_created_by_admin_id_fkey"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_target_lists"
  ADD CONSTRAINT "vip_target_lists_reserved_by_salon_id_fkey"
  FOREIGN KEY ("reserved_by_salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_target_contacts"
  ADD CONSTRAINT "vip_target_contacts_list_id_fkey"
  FOREIGN KEY ("list_id") REFERENCES "vip_target_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_salon_entitlements"
  ADD CONSTRAINT "vip_salon_entitlements_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_salon_entitlements"
  ADD CONSTRAINT "vip_salon_entitlements_granted_by_admin_id_fkey"
  FOREIGN KEY ("granted_by_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_salon_entitlements"
  ADD CONSTRAINT "vip_salon_entitlements_revoked_by_admin_id_fkey"
  FOREIGN KEY ("revoked_by_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_requests"
  ADD CONSTRAINT "vip_requests_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_requests"
  ADD CONSTRAINT "vip_requests_list_id_fkey"
  FOREIGN KEY ("list_id") REFERENCES "vip_target_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_requests"
  ADD CONSTRAINT "vip_requests_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_request_recipients"
  ADD CONSTRAINT "vip_request_recipients_vip_request_id_fkey"
  FOREIGN KEY ("vip_request_id") REFERENCES "vip_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_request_recipients"
  ADD CONSTRAINT "vip_request_recipients_source_contact_id_fkey"
  FOREIGN KEY ("source_contact_id") REFERENCES "vip_target_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_request_recipients"
  ADD CONSTRAINT "vip_request_recipients_message_request_id_fkey"
  FOREIGN KEY ("message_request_id") REFERENCES "message_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vip_sample_works"
  ADD CONSTRAINT "vip_sample_works_vip_request_id_fkey"
  FOREIGN KEY ("vip_request_id") REFERENCES "vip_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message_requests"
  ADD CONSTRAINT "message_requests_vip_request_id_salon_id_fkey"
  FOREIGN KEY ("vip_request_id", "salon_id") REFERENCES "vip_requests"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "vip_target_contacts_list_id_phone_number_key" ON "vip_target_contacts"("list_id", "phone_number");
CREATE UNIQUE INDEX "vip_target_contacts_list_id_sort_order_key" ON "vip_target_contacts"("list_id", "sort_order");
CREATE INDEX "vip_target_contacts_list_id_sort_order_id_idx" ON "vip_target_contacts"("list_id", "sort_order", "id");
CREATE INDEX "vip_target_lists_status_created_at_id_idx" ON "vip_target_lists"("status", "created_at", "id");

CREATE UNIQUE INDEX "vip_target_lists_in_use_list_key"
  ON "vip_target_lists"("id")
  WHERE "status" = 'IN_USE';

CREATE UNIQUE INDEX "vip_target_lists_one_in_use_per_salon"
  ON "vip_target_lists"("reserved_by_salon_id")
  WHERE "status" = 'IN_USE' AND "reserved_by_salon_id" IS NOT NULL;

CREATE UNIQUE INDEX "vip_salon_entitlements_salon_id_key" ON "vip_salon_entitlements"("salon_id");
CREATE UNIQUE INDEX "vip_salon_entitlements_one_active"
  ON "vip_salon_entitlements"("salon_id")
  WHERE "revoked_at" IS NULL;

CREATE UNIQUE INDEX "vip_request_recipients_vip_request_id_sort_order_key"
  ON "vip_request_recipients"("vip_request_id", "sort_order");
CREATE UNIQUE INDEX "vip_request_recipients_message_request_id_key"
  ON "vip_request_recipients"("message_request_id");
CREATE INDEX "vip_request_recipients_vip_request_id_sort_order_id_idx"
  ON "vip_request_recipients"("vip_request_id", "sort_order", "id");
CREATE INDEX "vip_request_recipients_salon_id_idx" ON "vip_request_recipients"("salon_id");

CREATE UNIQUE INDEX "vip_sample_works_vip_request_id_position_key"
  ON "vip_sample_works"("vip_request_id", "position");
CREATE UNIQUE INDEX "vip_sample_works_vip_request_id_sha256_key"
  ON "vip_sample_works"("vip_request_id", "sha256");
CREATE UNIQUE INDEX "vip_sample_works_object_key_key" ON "vip_sample_works"("object_key");
CREATE INDEX "vip_sample_works_salon_id_vip_request_id_idx"
  ON "vip_sample_works"("salon_id", "vip_request_id");

CREATE INDEX "vip_requests_salon_id_created_at_id_idx" ON "vip_requests"("salon_id", "created_at", "id");
CREATE INDEX "vip_requests_salon_id_status_idx" ON "vip_requests"("salon_id", "status");
CREATE INDEX "vip_requests_list_id_status_idx" ON "vip_requests"("list_id", "status");

CREATE UNIQUE INDEX "vip_requests_one_open_reservation_per_list"
  ON "vip_requests"("list_id")
  WHERE "status" = 'AWAITING_SAMPLE_WORK';

CREATE INDEX "message_requests_vip_request_id_idx" ON "message_requests"("vip_request_id");

ALTER TABLE "message_requests"
  ADD CONSTRAINT "message_requests_recipient_origin_consistent"
  CHECK (
    (
      "customer_id" IS NOT NULL
      AND "vip_request_id" IS NULL
      AND "recipient_display_name" IS NULL
      AND "recipient_phone_number" IS NULL
    )
    OR (
      "customer_id" IS NULL
      AND "vip_request_id" IS NOT NULL
      AND "recipient_display_name" IS NOT NULL
      AND "recipient_phone_number" IS NOT NULL
      AND "action_id" IS NULL
      AND "opportunity_type" IS NULL
      AND "counts_toward_daily_limit" = false
    )
  );

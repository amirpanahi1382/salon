-- CreateEnum
CREATE TYPE "VisitIntentionContactBasis" AS ENUM ('WITHHELD', 'SALON_SUPPLIED', 'ADMIN_AUTHORIZED');

-- AlterTable
ALTER TABLE "visit_intentions"
  ADD COLUMN "contact_basis" "VisitIntentionContactBasis" NOT NULL DEFAULT 'WITHHELD';

-- Salon-entered contact already stored before this column is SALON_SUPPLIED.
-- Admin rows and rows without contact stay WITHHELD. Do not copy recipient identity.
UPDATE "visit_intentions"
SET "contact_basis" = 'SALON_SUPPLIED'
WHERE "subject" = 'VIP_PROSPECT'
  AND "created_by_platform_admin_id" IS NULL
  AND ("disclosed_display_name" IS NOT NULL OR "disclosed_phone" IS NOT NULL);

ALTER TABLE "visit_intentions" DROP CONSTRAINT "visit_intentions_subject_chk";

ALTER TABLE "visit_intentions"
  ADD CONSTRAINT "visit_intentions_subject_chk" CHECK (
    (
      "subject" = 'CUSTOMER'
      AND "customer_id" IS NOT NULL
      AND "vip_request_id" IS NULL
      AND "vip_request_recipient_id" IS NULL
      AND "disclosed_display_name" IS NULL
      AND "disclosed_phone" IS NULL
      AND "contact_basis" = 'WITHHELD'
      AND "report_channel" IN ('SALON_STAFF', 'TOLD_PLATFORM_ADMIN')
    )
    OR (
      "subject" = 'VIP_PROSPECT'
      AND "customer_id" IS NULL
      AND "source_message_request_id" IS NULL
      AND "vip_request_id" IS NOT NULL
      AND (
        (
          "report_channel" = 'INBOUND_TO_SALON'
          AND "vip_request_recipient_id" IS NULL
        )
        OR (
          "report_channel" = 'REPORTED_DURING_MANUAL_HANDLING'
          AND "vip_request_recipient_id" IS NOT NULL
          AND (
            (
              "contact_basis" = 'WITHHELD'
              AND "disclosed_display_name" IS NULL
              AND "disclosed_phone" IS NULL
            )
            OR (
              "contact_basis" = 'ADMIN_AUTHORIZED'
              AND "disclosed_display_name" IS NOT NULL
              AND "disclosed_phone" IS NOT NULL
            )
          )
        )
      )
    )
  );

ALTER TABLE "visit_intentions" DROP CONSTRAINT "visit_intentions_inbound_disclosure_chk";

ALTER TABLE "visit_intentions"
  ADD CONSTRAINT "visit_intentions_inbound_disclosure_chk" CHECK (
    (
      "report_channel" = 'INBOUND_TO_SALON'
      AND "vip_request_recipient_id" IS NULL
      AND (
        (
          "contact_basis" = 'SALON_SUPPLIED'
          AND ("disclosed_display_name" IS NOT NULL OR "disclosed_phone" IS NOT NULL)
        )
        OR (
          "contact_basis" = 'WITHHELD'
          AND "disclosed_display_name" IS NULL
          AND "disclosed_phone" IS NULL
        )
      )
    )
    OR (
      "report_channel" = 'REPORTED_DURING_MANUAL_HANDLING'
      AND "contact_basis" IN ('WITHHELD', 'ADMIN_AUTHORIZED')
    )
    OR (
      "report_channel" IN ('SALON_STAFF', 'TOLD_PLATFORM_ADMIN')
      AND "contact_basis" = 'WITHHELD'
      AND "disclosed_display_name" IS NULL
      AND "disclosed_phone" IS NULL
    )
  );

ALTER TABLE "visit_intentions"
  ADD CONSTRAINT "visit_intentions_contact_basis_check" CHECK (
    (
      "contact_basis" = 'WITHHELD'
      AND "disclosed_display_name" IS NULL
      AND "disclosed_phone" IS NULL
    )
    OR (
      "contact_basis" = 'SALON_SUPPLIED'
      AND "created_by_platform_admin_id" IS NULL
      AND "subject" = 'VIP_PROSPECT'
      AND ("disclosed_display_name" IS NOT NULL OR "disclosed_phone" IS NOT NULL)
    )
    OR (
      "contact_basis" = 'ADMIN_AUTHORIZED'
      AND "created_by_platform_admin_id" IS NOT NULL
      AND "subject" = 'VIP_PROSPECT'
      AND "disclosed_display_name" IS NOT NULL
      AND "disclosed_phone" IS NOT NULL
    )
  );

-- CreateTable
CREATE TABLE "visit_intention_contact_revisions" (
    "id" UUID NOT NULL,
    "visit_intention_id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "contact_basis" "VisitIntentionContactBasis" NOT NULL,
    "disclosed_display_name" TEXT,
    "disclosed_phone" TEXT,
    "recorded_by_user_id" UUID,
    "recorded_by_platform_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_intention_contact_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visit_intention_contact_revisions_visit_intention_id_revision_key"
  ON "visit_intention_contact_revisions"("visit_intention_id", "revision");

CREATE INDEX "visit_intention_contact_revisions_salon_id_visit_intention_id_revision_idx"
  ON "visit_intention_contact_revisions"("salon_id", "visit_intention_id", "revision");

ALTER TABLE "visit_intention_contact_revisions"
  ADD CONSTRAINT "visit_intention_contact_revisions_intention_salon_fkey"
  FOREIGN KEY ("visit_intention_id", "salon_id")
  REFERENCES "visit_intentions"("id", "salon_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Revision 1 is the original claim. Do not copy recipient or target-list identity.
INSERT INTO "visit_intention_contact_revisions" (
    "id",
    "visit_intention_id",
    "salon_id",
    "revision",
    "contact_basis",
    "disclosed_display_name",
    "disclosed_phone",
    "recorded_by_user_id",
    "recorded_by_platform_admin_id",
    "created_at"
)
SELECT
    gen_random_uuid(),
    "id",
    "salon_id",
    1,
    "contact_basis",
    "disclosed_display_name",
    "disclosed_phone",
    "created_by_user_id",
    "created_by_platform_admin_id",
    "created_at"
FROM "visit_intentions"
WHERE "subject" = 'VIP_PROSPECT';

CREATE INDEX "visit_intentions_salon_id_vip_request_id_created_at_id_idx"
  ON "visit_intentions"("salon_id", "vip_request_id", "created_at", "id");

-- Reported visit intentions. Not ReturnCommitments, bookings, Visits, or Customers.
-- Additive unique indexes on vip_request_recipients are implied by the primary key
-- and exist so composite foreign keys can prove request and salon membership.

CREATE UNIQUE INDEX "vip_request_recipients_id_salon_id_key" ON "vip_request_recipients"("id", "salon_id");
CREATE UNIQUE INDEX "vip_request_recipients_id_vip_request_id_key" ON "vip_request_recipients"("id", "vip_request_id");

CREATE TYPE "VisitIntentionSubject" AS ENUM ('CUSTOMER', 'VIP_PROSPECT');
CREATE TYPE "VisitIntentionTimePrecision" AS ENUM ('UNKNOWN', 'DATE', 'INSTANT');
CREATE TYPE "VisitIntentionReportChannel" AS ENUM (
    'SALON_STAFF',
    'TOLD_PLATFORM_ADMIN',
    'INBOUND_TO_SALON',
    'REPORTED_DURING_MANUAL_HANDLING'
);

CREATE TABLE "visit_intentions" (
    "id" UUID NOT NULL,
    "salon_id" UUID NOT NULL,
    "subject" "VisitIntentionSubject" NOT NULL,
    "customer_id" UUID,
    "source_message_request_id" UUID,
    "vip_request_id" UUID,
    "vip_request_recipient_id" UUID,
    "disclosed_display_name" TEXT,
    "disclosed_phone" TEXT,
    "time_precision" "VisitIntentionTimePrecision" NOT NULL,
    "agreed_date" DATE,
    "agreed_instant" TIMESTAMPTZ(3),
    "report_channel" "VisitIntentionReportChannel" NOT NULL,
    "created_by_user_id" UUID,
    "created_by_platform_admin_id" UUID,
    "updated_by_user_id" UUID,
    "updated_by_platform_admin_id" UUID,
    "linked_visit_id" UUID,
    "linked_customer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visit_intentions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "visit_intentions_subject_chk" CHECK (
        (
            "subject" = 'CUSTOMER'
            AND "customer_id" IS NOT NULL
            AND "vip_request_id" IS NULL
            AND "vip_request_recipient_id" IS NULL
            AND "disclosed_display_name" IS NULL
            AND "disclosed_phone" IS NULL
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
                    AND "disclosed_display_name" IS NULL
                    AND "disclosed_phone" IS NULL
                )
            )
        )
    ),
    CONSTRAINT "visit_intentions_time_chk" CHECK (
        ("time_precision" = 'UNKNOWN' AND "agreed_date" IS NULL AND "agreed_instant" IS NULL)
        OR ("time_precision" = 'DATE' AND "agreed_date" IS NOT NULL AND "agreed_instant" IS NULL)
        OR ("time_precision" = 'INSTANT' AND "agreed_date" IS NULL AND "agreed_instant" IS NOT NULL)
    ),
    CONSTRAINT "visit_intentions_created_actor_chk" CHECK (
        ("created_by_user_id" IS NOT NULL AND "created_by_platform_admin_id" IS NULL)
        OR ("created_by_user_id" IS NULL AND "created_by_platform_admin_id" IS NOT NULL)
    ),
    CONSTRAINT "visit_intentions_updated_actor_chk" CHECK (
        ("updated_by_user_id" IS NOT NULL AND "updated_by_platform_admin_id" IS NULL)
        OR ("updated_by_user_id" IS NULL AND "updated_by_platform_admin_id" IS NOT NULL)
    ),
    CONSTRAINT "visit_intentions_channel_actor_chk" CHECK (
        (
            "report_channel" IN ('SALON_STAFF', 'INBOUND_TO_SALON')
            AND "created_by_user_id" IS NOT NULL
        )
        OR (
            "report_channel" IN ('TOLD_PLATFORM_ADMIN', 'REPORTED_DURING_MANUAL_HANDLING')
            AND "created_by_platform_admin_id" IS NOT NULL
        )
    ),
    CONSTRAINT "visit_intentions_link_chk" CHECK (
        ("linked_visit_id" IS NULL AND "linked_customer_id" IS NULL)
        OR ("linked_visit_id" IS NOT NULL AND "linked_customer_id" IS NOT NULL)
    ),
    CONSTRAINT "visit_intentions_customer_link_chk" CHECK (
        "linked_customer_id" IS NULL
        OR "subject" = 'VIP_PROSPECT'
        OR "linked_customer_id" = "customer_id"
    ),
    CONSTRAINT "visit_intentions_disclosed_phone_chk" CHECK (
        "disclosed_phone" IS NULL OR "disclosed_phone" ~ '^09[0-9]{9}$'
    ),
    CONSTRAINT "visit_intentions_disclosed_name_chk" CHECK (
        "disclosed_display_name" IS NULL
        OR (
            char_length("disclosed_display_name") BETWEEN 1 AND 80
            AND "disclosed_display_name" !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT "visit_intentions_inbound_disclosure_chk" CHECK (
        "report_channel" = 'INBOUND_TO_SALON'
        OR ("disclosed_display_name" IS NULL AND "disclosed_phone" IS NULL)
    )
);

CREATE UNIQUE INDEX "visit_intentions_id_salon_id_key" ON "visit_intentions"("id", "salon_id");
CREATE INDEX "visit_intentions_salon_id_customer_id_created_at_id_idx" ON "visit_intentions"("salon_id", "customer_id", "created_at", "id");
CREATE INDEX "visit_intentions_salon_id_subject_created_at_id_idx" ON "visit_intentions"("salon_id", "subject", "created_at", "id");
CREATE UNIQUE INDEX "visit_intentions_one_open_customer_key" ON "visit_intentions"("salon_id", "customer_id") WHERE "subject" = 'CUSTOMER' AND "linked_visit_id" IS NULL;
CREATE UNIQUE INDEX "visit_intentions_one_open_vip_recipient_key" ON "visit_intentions"("salon_id", "vip_request_recipient_id") WHERE "vip_request_recipient_id" IS NOT NULL AND "linked_visit_id" IS NULL;
CREATE UNIQUE INDEX "visit_intentions_salon_linked_visit_key" ON "visit_intentions"("salon_id", "linked_visit_id") WHERE "linked_visit_id" IS NOT NULL;

ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_customer_id_salon_id_fkey" FOREIGN KEY ("customer_id", "salon_id") REFERENCES "customers"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_source_message_salon_fkey" FOREIGN KEY ("source_message_request_id", "salon_id") REFERENCES "message_requests"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_vip_request_salon_fkey" FOREIGN KEY ("vip_request_id", "salon_id") REFERENCES "vip_requests"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_recipient_request_fkey" FOREIGN KEY ("vip_request_recipient_id", "vip_request_id") REFERENCES "vip_request_recipients"("id", "vip_request_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_recipient_salon_fkey" FOREIGN KEY ("vip_request_recipient_id", "salon_id") REFERENCES "vip_request_recipients"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_created_by_user_salon_fkey" FOREIGN KEY ("created_by_user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_created_by_admin_fkey" FOREIGN KEY ("created_by_platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_updated_by_user_salon_fkey" FOREIGN KEY ("updated_by_user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_updated_by_admin_fkey" FOREIGN KEY ("updated_by_platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_linked_visit_salon_fkey" FOREIGN KEY ("linked_visit_id", "salon_id") REFERENCES "visits"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_intentions" ADD CONSTRAINT "visit_intentions_linked_customer_salon_fkey" FOREIGN KEY ("linked_customer_id", "salon_id") REFERENCES "customers"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Durable intent and fenced cleanup for VIP sample-work object writes.
-- Historical sample metadata remains unverified: verified_at is intentionally NULL.
CREATE TYPE "VipSampleUploadStatus" AS ENUM ('RETRYABLE', 'UPLOADING', 'AVAILABLE', 'ABANDONED');
CREATE TYPE "VipSampleCleanupStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED');

ALTER TABLE "vip_sample_works"
  ADD COLUMN "verified_at" TIMESTAMPTZ(3);

CREATE TABLE "vip_sample_work_uploads" (
  "id" UUID NOT NULL,
  "vip_request_id" UUID NOT NULL,
  "salon_id" UUID NOT NULL,
  "sha256" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "status" "VipSampleUploadStatus" NOT NULL DEFAULT 'RETRYABLE',
  "position" INTEGER,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "object_key" TEXT,
  "owner_token" TEXT,
  "locked_until" TIMESTAMPTZ(3),
  "sample_work_id" UUID,
  "verified_at" TIMESTAMPTZ(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "vip_sample_work_uploads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vip_sample_work_uploads_byte_size_positive" CHECK ("byte_size" > 0),
  CONSTRAINT "vip_sample_work_uploads_position_range" CHECK ("position" IS NULL OR "position" BETWEEN 1 AND 3),
  CONSTRAINT "vip_sample_work_uploads_owner_state" CHECK (
    ("status" = 'UPLOADING' AND "position" IS NOT NULL AND "object_key" IS NOT NULL
      AND "owner_token" IS NOT NULL AND "locked_until" IS NOT NULL AND "sample_work_id" IS NULL)
    OR
    ("status" <> 'UPLOADING' AND "position" IS NULL AND "owner_token" IS NULL AND "locked_until" IS NULL)
  ),
  CONSTRAINT "vip_sample_work_uploads_available_state" CHECK (
    ("status" = 'AVAILABLE' AND "sample_work_id" IS NOT NULL AND "verified_at" IS NOT NULL)
    OR
    ("status" <> 'AVAILABLE' AND "sample_work_id" IS NULL)
  )
);

CREATE TABLE "vip_sample_work_cleanups" (
  "id" UUID NOT NULL,
  "upload_id" UUID NOT NULL,
  "object_key" TEXT NOT NULL,
  "upload_generation" INTEGER NOT NULL,
  "status" "VipSampleCleanupStatus" NOT NULL DEFAULT 'PENDING',
  "request_generation" BIGINT NOT NULL DEFAULT 1,
  "claim_generation" BIGINT NOT NULL DEFAULT 0,
  "claim_token" TEXT,
  "locked_until" TIMESTAMPTZ(3),
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settle_until" TIMESTAMPTZ(3) NOT NULL,
  "delete_passes" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(3),
  CONSTRAINT "vip_sample_work_cleanups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vip_sample_work_cleanups_delete_passes_nonnegative" CHECK ("delete_passes" >= 0),
  CONSTRAINT "vip_sample_work_cleanups_claim_state" CHECK (
    ("status" = 'PROCESSING' AND "claim_token" IS NOT NULL AND "locked_until" IS NOT NULL AND "processed_at" IS NULL)
    OR
    ("status" = 'PENDING' AND "claim_token" IS NULL AND "locked_until" IS NULL AND "processed_at" IS NULL)
    OR
    ("status" = 'PROCESSED' AND "claim_token" IS NULL AND "locked_until" IS NULL AND "processed_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "vip_sample_work_uploads_vip_request_id_sha256_key"
  ON "vip_sample_work_uploads"("vip_request_id", "sha256");
CREATE UNIQUE INDEX "vip_sample_work_uploads_object_key_key"
  ON "vip_sample_work_uploads"("object_key");
CREATE UNIQUE INDEX "vip_sample_work_uploads_sample_work_id_key"
  ON "vip_sample_work_uploads"("sample_work_id");
CREATE UNIQUE INDEX "vip_sample_work_uploads_active_position_key"
  ON "vip_sample_work_uploads"("vip_request_id", "position") WHERE "position" IS NOT NULL;
CREATE INDEX "vip_sample_work_uploads_status_locked_until_id_idx"
  ON "vip_sample_work_uploads"("status", "locked_until", "id");
CREATE INDEX "vip_sample_work_uploads_vip_request_id_position_idx"
  ON "vip_sample_work_uploads"("vip_request_id", "position");
CREATE INDEX "vip_sample_work_uploads_salon_id_vip_request_id_idx"
  ON "vip_sample_work_uploads"("salon_id", "vip_request_id");

CREATE UNIQUE INDEX "vip_sample_work_cleanups_object_key_key"
  ON "vip_sample_work_cleanups"("object_key");
CREATE INDEX "vip_sample_work_cleanups_status_available_locked_id_idx"
  ON "vip_sample_work_cleanups"("status", "available_at", "locked_until", "id");
CREATE INDEX "vip_sample_work_cleanups_upload_generation_idx"
  ON "vip_sample_work_cleanups"("upload_id", "upload_generation");

ALTER TABLE "vip_sample_work_uploads"
  ADD CONSTRAINT "vip_sample_work_uploads_vip_request_id_salon_id_fkey"
  FOREIGN KEY ("vip_request_id", "salon_id") REFERENCES "vip_requests"("id", "salon_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "vip_sample_work_uploads"
  ADD CONSTRAINT "vip_sample_work_uploads_sample_work_id_fkey"
  FOREIGN KEY ("sample_work_id") REFERENCES "vip_sample_works"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "vip_sample_work_cleanups"
  ADD CONSTRAINT "vip_sample_work_cleanups_upload_id_fkey"
  FOREIGN KEY ("upload_id") REFERENCES "vip_sample_work_uploads"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Durable recovery for activation-receipt upload attempts.  Existing receipt
-- evidence is never backfilled or inferred from object-storage keys.
ALTER TABLE "activation_receipts"
  ADD COLUMN "upload_generation" BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN "upload_owner_token" UUID,
  ADD COLUMN "upload_locked_until" TIMESTAMPTZ(3),
  ADD COLUMN "upload_last_error_code" TEXT;

ALTER TABLE "activation_receipts"
  ADD CONSTRAINT "activation_receipts_upload_owner_chk"
  CHECK (
    -- Null/null is an explicitly retained pre-migration attempt. It has no
    -- provable authorization or object ownership and is inventory-only.
    ("phase" = 'UPLOADING' AND
      (("upload_owner_token" IS NOT NULL AND "upload_locked_until" IS NOT NULL)
       OR ("upload_owner_token" IS NULL AND "upload_locked_until" IS NULL)))
    OR
    ("phase" <> 'UPLOADING' AND "upload_owner_token" IS NULL AND "upload_locked_until" IS NULL)
  );

CREATE TYPE "ActivationReceiptCleanupStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED');

CREATE TABLE "activation_receipt_upload_cleanups" (
  "id" UUID NOT NULL,
  "receipt_id" UUID NOT NULL,
  "object_key" TEXT NOT NULL,
  "upload_generation" BIGINT NOT NULL,
  "available_at" TIMESTAMPTZ(3) NOT NULL,
  "settle_until" TIMESTAMPTZ(3) NOT NULL,
  "status" "ActivationReceiptCleanupStatus" NOT NULL DEFAULT 'PENDING',
  "claim_generation" BIGINT NOT NULL DEFAULT 0,
  "claim_token" UUID,
  "locked_until" TIMESTAMPTZ(3),
  "delete_passes" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" TEXT,
  "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activation_receipt_upload_cleanups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "activation_receipt_upload_cleanups_receipt_id_fkey"
    FOREIGN KEY ("receipt_id") REFERENCES "activation_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "activation_receipt_upload_cleanups_object_key_key" UNIQUE ("object_key"),
  CONSTRAINT "activation_receipt_upload_cleanups_time_chk" CHECK ("settle_until" >= "available_at")
);

CREATE INDEX "activation_receipt_upload_cleanups_claim_idx"
  ON "activation_receipt_upload_cleanups" ("status", "available_at", "id");
-- The worker has two independently ordered claim paths. Partial indexes keep
-- either path bounded without indexing protected/history cleanup rows.
CREATE INDEX "activation_receipt_upload_cleanups_pending_claim_idx"
  ON "activation_receipt_upload_cleanups" ("available_at", "id")
  WHERE "status" = 'PENDING';
CREATE INDEX "activation_receipt_upload_cleanups_processing_claim_idx"
  ON "activation_receipt_upload_cleanups" ("locked_until", "id")
  WHERE "status" = 'PROCESSING';
CREATE INDEX "activation_receipts_upload_recovery_idx"
  ON "activation_receipts" ("phase", "upload_locked_until", "id")
  WHERE "phase" = 'UPLOADING';

-- The original guard predates operational upload ownership.  Evidence and
-- historical phase transitions remain immutable; an UPLOADING attempt may
-- only renew/clear its own operational fields or make its existing terminal
-- transition.
CREATE OR REPLACE FUNCTION "activation_receipt_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipts cannot be deleted';
  END IF;
  IF NEW.salon_id IS DISTINCT FROM OLD.salon_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.agreement_acceptance_id IS DISTINCT FROM OLD.agreement_acceptance_id
    OR NEW.object_key IS DISTINCT FROM OLD.object_key
    OR NEW.content_type IS DISTINCT FROM OLD.content_type
    OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
    OR NEW.sha256 IS DISTINCT FROM OLD.sha256
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt evidence is immutable';
  END IF;
  IF OLD.phase IN ('FAILED', 'SUPERSEDED', 'APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt decision is immutable';
  END IF;
  IF OLD.phase = 'UPLOADING' AND NEW.phase NOT IN ('UPLOADING', 'STORED', 'FAILED') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt transition is invalid';
  END IF;
  IF OLD.phase = 'STORED' AND NEW.phase NOT IN ('SUPERSEDED', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt transition is invalid';
  END IF;
  IF OLD.phase = 'UNDER_REVIEW' AND NEW.phase NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt transition is invalid';
  END IF;
  IF OLD.phase <> 'UPLOADING' AND (
    NEW.upload_generation IS DISTINCT FROM OLD.upload_generation OR
    NEW.upload_owner_token IS DISTINCT FROM OLD.upload_owner_token OR
    NEW.upload_locked_until IS DISTINCT FROM OLD.upload_locked_until OR
    NEW.upload_last_error_code IS DISTINCT FROM OLD.upload_last_error_code
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt upload state is immutable';
  END IF;
  IF NEW.bank_attestation_wording IS DISTINCT FROM OLD.bank_attestation_wording
    AND NOT (OLD.phase = 'UNDER_REVIEW' AND NEW.phase = 'APPROVED')
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt attestation is immutable';
  END IF;
  IF OLD.phase = 'UNDER_REVIEW' AND (
    NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.submission_idempotency_key IS DISTINCT FROM OLD.submission_idempotency_key
    OR NEW.amount_irr IS DISTINCT FROM OLD.amount_irr
    OR NEW.instruction_snapshot IS DISTINCT FROM OLD.instruction_snapshot
    OR NEW.instruction_digest IS DISTINCT FROM OLD.instruction_digest
    OR NEW.stored_at IS DISTINCT FROM OLD.stored_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt submission is immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- Manual card-transfer receipt evidence.
-- Does not change existing salon access rows and does not activate a salon.

CREATE TYPE "ActivationReceiptPhase" AS ENUM (
  'UPLOADING',
  'FAILED',
  'STORED',
  'SUPERSEDED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "activation_receipts" (
  "id" UUID NOT NULL,
  "salon_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "agreement_acceptance_id" UUID NOT NULL,
  "object_key" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "phase" "ActivationReceiptPhase" NOT NULL,
  "stored_at" TIMESTAMPTZ(3),
  "submitted_at" TIMESTAMPTZ(3),
  "submission_idempotency_key" TEXT,
  "amount_irr" DECIMAL(19, 2),
  "instruction_snapshot" JSONB,
  "instruction_digest" CHAR(64),
  "decided_at" TIMESTAMPTZ(3),
  "decided_by_admin_id" UUID,
  "decision_idempotency_key" TEXT,
  "rejection_reason" TEXT,
  "bank_attestation_wording" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "activation_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "activation_receipts_salon_id_created_at_idx"
  ON "activation_receipts"("salon_id", "created_at");
CREATE INDEX "activation_receipts_phase_submitted_at_idx"
  ON "activation_receipts"("phase", "submitted_at");

CREATE UNIQUE INDEX "activation_receipts_one_uploading"
  ON "activation_receipts"("salon_id") WHERE "phase" = 'UPLOADING';
CREATE UNIQUE INDEX "activation_receipts_one_stored"
  ON "activation_receipts"("salon_id") WHERE "phase" = 'STORED';
CREATE UNIQUE INDEX "activation_receipts_one_under_review"
  ON "activation_receipts"("salon_id") WHERE "phase" = 'UNDER_REVIEW';
CREATE UNIQUE INDEX "activation_receipts_submission_key"
  ON "activation_receipts"("salon_id", "submission_idempotency_key")
  WHERE "submission_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "activation_receipts_decision_key"
  ON "activation_receipts"("salon_id", "decision_idempotency_key")
  WHERE "decision_idempotency_key" IS NOT NULL;

ALTER TABLE "activation_receipts"
  ADD CONSTRAINT "activation_receipts_object_key_chk"
    CHECK ("object_key" = 'activation-receipts/' || "salon_id"::text || '/' || "id"::text),
  ADD CONSTRAINT "activation_receipts_content_type_chk"
    CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "activation_receipts_byte_size_chk"
    CHECK ("byte_size" > 0 AND "byte_size" <= 5242880),
  ADD CONSTRAINT "activation_receipts_sha_chk"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "activation_receipts_digest_chk"
    CHECK ("instruction_digest" IS NULL OR "instruction_digest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "activation_receipts_phase_chk"
    CHECK (
      (
        "phase" IN ('UPLOADING', 'FAILED')
        AND "stored_at" IS NULL
        AND "submitted_at" IS NULL
        AND "submission_idempotency_key" IS NULL
        AND "amount_irr" IS NULL
        AND "instruction_snapshot" IS NULL
        AND "instruction_digest" IS NULL
        AND "decided_at" IS NULL
        AND "decided_by_admin_id" IS NULL
        AND "decision_idempotency_key" IS NULL
        AND "rejection_reason" IS NULL
      )
      OR (
        "phase" IN ('STORED', 'SUPERSEDED')
        AND "stored_at" IS NOT NULL
        AND "submitted_at" IS NULL
        AND "submission_idempotency_key" IS NULL
        AND "amount_irr" IS NULL
        AND "instruction_snapshot" IS NULL
        AND "instruction_digest" IS NULL
        AND "decided_at" IS NULL
        AND "decided_by_admin_id" IS NULL
        AND "decision_idempotency_key" IS NULL
        AND "rejection_reason" IS NULL
      )
      OR (
        "phase" = 'UNDER_REVIEW'
        AND "stored_at" IS NOT NULL
        AND "submitted_at" IS NOT NULL
        AND "submission_idempotency_key" IS NOT NULL
        AND "amount_irr" IS NOT NULL
        AND "instruction_snapshot" IS NOT NULL
        AND "instruction_digest" IS NOT NULL
        AND "decided_at" IS NULL
        AND "decided_by_admin_id" IS NULL
        AND "decision_idempotency_key" IS NULL
        AND "rejection_reason" IS NULL
      )
      OR (
        "phase" = 'APPROVED'
        AND "stored_at" IS NOT NULL
        AND "submitted_at" IS NOT NULL
        AND "submission_idempotency_key" IS NOT NULL
        AND "amount_irr" IS NOT NULL
        AND "instruction_snapshot" IS NOT NULL
        AND "instruction_digest" IS NOT NULL
        AND "decided_at" IS NOT NULL
        AND "decided_by_admin_id" IS NOT NULL
        AND "decision_idempotency_key" IS NOT NULL
        AND "rejection_reason" IS NULL
      )
      OR (
        "phase" = 'REJECTED'
        AND "stored_at" IS NOT NULL
        AND "submitted_at" IS NOT NULL
        AND "submission_idempotency_key" IS NOT NULL
        AND "amount_irr" IS NOT NULL
        AND "instruction_snapshot" IS NOT NULL
        AND "instruction_digest" IS NOT NULL
        AND "decided_at" IS NOT NULL
        AND "decided_by_admin_id" IS NOT NULL
        AND "decision_idempotency_key" IS NOT NULL
        AND char_length(btrim("rejection_reason")) BETWEEN 3 AND 500
      )
    );

ALTER TABLE "activation_receipts"
  ADD CONSTRAINT "activation_receipts_bank_attestation_chk"
    CHECK (
      (
        "phase" = 'APPROVED'
        AND "bank_attestation_wording" = 'واریز را در حساب بانکی بررسی و با این فیش تطبیق داده‌ام'
      )
      OR (
        "phase" <> 'APPROVED'
        AND "bank_attestation_wording" IS NULL
      )
    );

ALTER TABLE "activation_receipts"
  ADD CONSTRAINT "activation_receipts_salon_id_fkey"
    FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "activation_receipts_user_id_salon_id_fkey"
    FOREIGN KEY ("user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "activation_receipts_agreement_acceptance_id_fkey"
    FOREIGN KEY ("agreement_acceptance_id") REFERENCES "agreement_acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "activation_receipts_decided_by_admin_id_fkey"
    FOREIGN KEY ("decided_by_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "activation_receipt_guard"() RETURNS trigger
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
  IF OLD.phase = 'UPLOADING' AND NEW.phase NOT IN ('STORED', 'FAILED') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt transition is invalid';
  END IF;
  IF OLD.phase = 'STORED' AND NEW.phase NOT IN ('SUPERSEDED', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt transition is invalid';
  END IF;
  IF OLD.phase = 'UNDER_REVIEW' AND NEW.phase NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'activation receipt transition is invalid';
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

CREATE TRIGGER "activation_receipts_guard"
  BEFORE UPDATE OR DELETE ON "activation_receipts"
  FOR EACH ROW EXECUTE FUNCTION "activation_receipt_guard"();

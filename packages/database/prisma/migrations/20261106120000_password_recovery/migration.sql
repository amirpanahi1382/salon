-- Password recovery through phone ownership. Separate from signup challenges.
-- Phone numbers, OTP codes, recovery proofs, and passwords are not stored here.
-- credentials_version invalidates JWTs issued before a successful reset.

ALTER TABLE "users"
  ADD COLUMN "credentials_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "platform_admins"
  ADD COLUMN "credentials_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users"
  ADD CONSTRAINT "users_credentials_version_chk"
  CHECK ("credentials_version" >= 0);

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_credentials_version_chk"
  CHECK ("credentials_version" >= 0);

CREATE TYPE "PasswordRecoveryChallengeStatus" AS ENUM (
  'DISPATCHING',
  'SENT',
  'AMBIGUOUS',
  'INVALIDATED',
  'VERIFIED',
  'EXPIRED'
);

CREATE TYPE "PasswordRecoveryVerifyState" AS ENUM (
  'IN_PROGRESS',
  'REJECTED',
  'UNCONFIRMED',
  'SUCCEEDED'
);

CREATE TABLE "password_recovery_challenges" (
  "id" UUID NOT NULL,
  "phone_hash" TEXT NOT NULL,
  "status" "PasswordRecoveryChallengeStatus" NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "provider_request_id" TEXT,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "verify_attempts" INTEGER NOT NULL DEFAULT 0,
  "proof_hash" TEXT,
  "proof_expires_at" TIMESTAMPTZ(3),
  "proof_consumed_at" TIMESTAMPTZ(3),
  "proof_closed_at" TIMESTAMPTZ(3),
  "verified_at" TIMESTAMPTZ(3),
  "invalidated_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "password_recovery_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_recovery_challenges_idempotency_key_key"
  ON "password_recovery_challenges"("idempotency_key");

CREATE UNIQUE INDEX "password_recovery_challenges_proof_hash_key"
  ON "password_recovery_challenges"("proof_hash");

CREATE INDEX "password_recovery_challenges_phone_hash_created_at_idx"
  ON "password_recovery_challenges"("phone_hash", "created_at");

CREATE UNIQUE INDEX "password_recovery_challenges_one_open_phone"
  ON "password_recovery_challenges"("phone_hash")
  WHERE "status" IN ('DISPATCHING', 'SENT', 'AMBIGUOUS');

CREATE UNIQUE INDEX "password_recovery_challenges_one_open_proof"
  ON "password_recovery_challenges"("phone_hash")
  WHERE "status" = 'VERIFIED' AND "proof_closed_at" IS NULL;

ALTER TABLE "password_recovery_challenges"
  ADD CONSTRAINT "password_recovery_challenges_phone_hash_chk"
  CHECK ("phone_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "password_recovery_challenges_request_hash_chk"
  CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "password_recovery_challenges_key_chk"
  CHECK ("idempotency_key" ~ '^[A-Za-z0-9._-]{8,128}$'),
  ADD CONSTRAINT "password_recovery_challenges_attempts_chk"
  CHECK ("verify_attempts" >= 0),
  ADD CONSTRAINT "password_recovery_challenges_expiry_chk"
  CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "password_recovery_challenges_provider_request_chk"
  CHECK (
    "provider_request_id" IS NULL
    OR (
      char_length("provider_request_id") BETWEEN 1 AND 128
      AND "status" IN ('SENT', 'VERIFIED', 'INVALIDATED', 'EXPIRED')
    )
  ),
  ADD CONSTRAINT "password_recovery_challenges_sent_chk"
  CHECK ("status" <> 'SENT' OR "provider_request_id" IS NOT NULL),
  ADD CONSTRAINT "password_recovery_challenges_invalidated_chk"
  CHECK (
    ("status" = 'INVALIDATED' AND "invalidated_at" IS NOT NULL)
    OR ("status" <> 'INVALIDATED' AND "invalidated_at" IS NULL)
  ),
  ADD CONSTRAINT "password_recovery_challenges_proof_hash_chk"
  CHECK ("proof_hash" IS NULL OR "proof_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "password_recovery_challenges_proof_chk"
  CHECK (
    (
      "status" = 'VERIFIED'
      AND "proof_hash" IS NOT NULL
      AND "proof_expires_at" IS NOT NULL
      AND "verified_at" IS NOT NULL
      AND ("proof_consumed_at" IS NULL OR "proof_closed_at" IS NOT NULL)
    )
    OR (
      "status" <> 'VERIFIED'
      AND "proof_hash" IS NULL
      AND "proof_expires_at" IS NULL
      AND "verified_at" IS NULL
      AND "proof_consumed_at" IS NULL
      AND "proof_closed_at" IS NULL
    )
  );

CREATE TABLE "password_recovery_verify_attempts" (
  "id" UUID NOT NULL,
  "challenge_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "state" "PasswordRecoveryVerifyState" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "password_recovery_verify_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_recovery_verify_attempts_idempotency_key_key"
  ON "password_recovery_verify_attempts"("idempotency_key");

CREATE INDEX "password_recovery_verify_attempts_challenge_id_created_at_idx"
  ON "password_recovery_verify_attempts"("challenge_id", "created_at");

ALTER TABLE "password_recovery_verify_attempts"
  ADD CONSTRAINT "password_recovery_verify_attempts_key_chk"
  CHECK ("idempotency_key" ~ '^[A-Za-z0-9._-]{8,128}$'),
  ADD CONSTRAINT "password_recovery_verify_attempts_hash_chk"
  CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "password_recovery_verify_attempts"
  ADD CONSTRAINT "password_recovery_verify_attempts_challenge_fkey"
  FOREIGN KEY ("challenge_id") REFERENCES "password_recovery_challenges"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "password_recovery_completions" (
  "id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "challenge_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_recovery_completions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_recovery_completions_idempotency_key_key"
  ON "password_recovery_completions"("idempotency_key");

ALTER TABLE "password_recovery_completions"
  ADD CONSTRAINT "password_recovery_completions_key_chk"
  CHECK ("idempotency_key" ~ '^[A-Za-z0-9._-]{8,128}$'),
  ADD CONSTRAINT "password_recovery_completions_hash_chk"
  CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "password_recovery_completions"
  ADD CONSTRAINT "password_recovery_completions_challenge_fkey"
  FOREIGN KEY ("challenge_id") REFERENCES "password_recovery_challenges"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

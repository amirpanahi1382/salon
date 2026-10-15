-- Immutable agreement versions, presentations, and acceptances.
-- Does not change existing salon access, users, or financial rows.
-- Application encryption holds the national ID and the filled document.
-- Triggers reject ordinary UPDATE and DELETE. A table owner can still disable them.

CREATE TABLE "agreement_versions" (
  "id" UUID NOT NULL,
  "version_key" TEXT NOT NULL,
  "template_digest" CHAR(64) NOT NULL,
  "canonical_text" TEXT NOT NULL,
  "checkbox_wording" TEXT NOT NULL,
  "button_wording" TEXT NOT NULL,
  "amount_irr" DECIMAL(19, 2) NOT NULL,
  "scope_snapshot" JSONB NOT NULL,
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_by_admin_id" UUID NOT NULL,

  CONSTRAINT "agreement_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agreement_versions_version_key_key" ON "agreement_versions"("version_key");

CREATE TABLE "agreement_presentations" (
  "id" UUID NOT NULL,
  "salon_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "version_id" UUID NOT NULL,
  "rendered_digest" CHAR(64) NOT NULL,
  "evidence_key_id" TEXT NOT NULL,
  "declared_fields_ciphertext" BYTEA NOT NULL,
  "declared_fields_nonce" BYTEA NOT NULL,
  "rendered_document_ciphertext" BYTEA NOT NULL,
  "rendered_document_nonce" BYTEA NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agreement_presentations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agreement_presentations_salon_id_user_id_created_at_idx"
  ON "agreement_presentations"("salon_id", "user_id", "created_at");

CREATE TABLE "agreement_acceptances" (
  "id" UUID NOT NULL,
  "salon_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "version_id" UUID NOT NULL,
  "presentation_id" UUID NOT NULL,
  "template_digest" CHAR(64) NOT NULL,
  "rendered_digest" CHAR(64) NOT NULL,
  "snapshot_digest" CHAR(64) NOT NULL,
  "checkbox_wording" TEXT NOT NULL,
  "button_wording" TEXT NOT NULL,
  "checkbox_confirmed" BOOLEAN NOT NULL,
  "phone_owner_completion_id" UUID,
  "accepted_at" TIMESTAMPTZ(3) NOT NULL,
  "session_jti" UUID NOT NULL,
  "client_ip" TEXT,
  "client_ip_source" TEXT NOT NULL,
  "user_agent" TEXT,
  "app_version" TEXT,
  "app_build" TEXT,
  "api_revision" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "amount_irr" DECIMAL(19, 2) NOT NULL,
  "scope_snapshot" JSONB NOT NULL,
  "evidence_key_id" TEXT NOT NULL,
  "snapshot_ciphertext" BYTEA NOT NULL,
  "snapshot_nonce" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agreement_acceptances_presentation_id_key"
  ON "agreement_acceptances"("presentation_id");
CREATE INDEX "agreement_acceptances_salon_id_accepted_at_idx"
  ON "agreement_acceptances"("salon_id", "accepted_at");

ALTER TABLE "agreement_versions"
  ADD CONSTRAINT "agreement_versions_version_key_chk"
    CHECK ("version_key" ~ '^[A-Z0-9_]{1,64}$'),
  ADD CONSTRAINT "agreement_versions_template_digest_chk"
    CHECK ("template_digest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "agreement_versions_text_chk"
    CHECK (char_length("canonical_text") > 0 AND char_length("checkbox_wording") > 0 AND char_length("button_wording") > 0),
  ADD CONSTRAINT "agreement_versions_amount_chk"
    CHECK ("amount_irr" > 0);

ALTER TABLE "agreement_presentations"
  ADD CONSTRAINT "agreement_presentations_digest_chk"
    CHECK ("rendered_digest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "agreement_presentations_key_chk"
    CHECK (char_length("evidence_key_id") BETWEEN 1 AND 32),
  ADD CONSTRAINT "agreement_presentations_nonce_chk"
    CHECK (octet_length("declared_fields_nonce") = 12 AND octet_length("rendered_document_nonce") = 12),
  ADD CONSTRAINT "agreement_presentations_ciphertext_chk"
    CHECK (octet_length("declared_fields_ciphertext") > 16 AND octet_length("rendered_document_ciphertext") > 16),
  ADD CONSTRAINT "agreement_presentations_expiry_chk"
    CHECK ("expires_at" > "created_at");

ALTER TABLE "agreement_acceptances"
  ADD CONSTRAINT "agreement_acceptances_digest_chk"
    CHECK (
      "template_digest" ~ '^[0-9a-f]{64}$'
      AND "rendered_digest" ~ '^[0-9a-f]{64}$'
      AND "snapshot_digest" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "agreement_acceptances_consent_chk"
    CHECK ("checkbox_confirmed" = true),
  ADD CONSTRAINT "agreement_acceptances_ip_source_chk"
    CHECK ("client_ip_source" IN ('socket', 'trusted_proxy')),
  ADD CONSTRAINT "agreement_acceptances_wording_chk"
    CHECK (char_length("checkbox_wording") > 0 AND char_length("button_wording") > 0),
  ADD CONSTRAINT "agreement_acceptances_amount_chk"
    CHECK ("amount_irr" > 0),
  ADD CONSTRAINT "agreement_acceptances_key_chk"
    CHECK (char_length("evidence_key_id") BETWEEN 1 AND 32),
  ADD CONSTRAINT "agreement_acceptances_nonce_chk"
    CHECK (octet_length("snapshot_nonce") = 12),
  ADD CONSTRAINT "agreement_acceptances_ciphertext_chk"
    CHECK (octet_length("snapshot_ciphertext") > 16),
  ADD CONSTRAINT "agreement_acceptances_revision_chk"
    CHECK (char_length("api_revision") BETWEEN 1 AND 80),
  ADD CONSTRAINT "agreement_acceptances_request_chk"
    CHECK (char_length("request_id") BETWEEN 1 AND 80 AND char_length("correlation_id") BETWEEN 1 AND 80);

ALTER TABLE "agreement_versions"
  ADD CONSTRAINT "agreement_versions_published_by_admin_id_fkey"
  FOREIGN KEY ("published_by_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agreement_presentations"
  ADD CONSTRAINT "agreement_presentations_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agreement_presentations_user_id_salon_id_fkey"
  FOREIGN KEY ("user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agreement_presentations_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agreement_acceptances"
  ADD CONSTRAINT "agreement_acceptances_salon_id_fkey"
  FOREIGN KEY ("salon_id") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agreement_acceptances_user_id_salon_id_fkey"
  FOREIGN KEY ("user_id", "salon_id") REFERENCES "users"("id", "salon_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agreement_acceptances_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agreement_acceptances_presentation_id_fkey"
  FOREIGN KEY ("presentation_id") REFERENCES "agreement_presentations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "agreement_acceptances_phone_owner_completion_id_fkey"
  FOREIGN KEY ("phone_owner_completion_id") REFERENCES "phone_owner_completions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "agreement_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000',
    MESSAGE = 'agreement records are immutable';
END;
$$;

CREATE TRIGGER "agreement_versions_immutable"
  BEFORE UPDATE OR DELETE ON "agreement_versions"
  FOR EACH ROW EXECUTE FUNCTION "agreement_reject_mutation"();

CREATE TRIGGER "agreement_presentations_immutable"
  BEFORE UPDATE OR DELETE ON "agreement_presentations"
  FOR EACH ROW EXECUTE FUNCTION "agreement_reject_mutation"();

CREATE TRIGGER "agreement_acceptances_immutable"
  BEFORE UPDATE OR DELETE ON "agreement_acceptances"
  FOR EACH ROW EXECUTE FUNCTION "agreement_reject_mutation"();

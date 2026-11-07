-- Occupies the one-open-phone slot so a suppressed start has cooldown/resend
-- without a provider SENT row.

DROP INDEX IF EXISTS "password_recovery_challenges_one_open_phone";
CREATE UNIQUE INDEX "password_recovery_challenges_one_open_phone"
  ON "password_recovery_challenges"("phone_hash")
  WHERE "status" IN ('DISPATCHING', 'SENT', 'AMBIGUOUS', 'SUPPRESSED');

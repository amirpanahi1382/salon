-- Persist ineligible recovery starts without labeling them provider SENT.
-- Public start still returns pending. OTP is not sent.
-- The new enum value cannot be used in this same Prisma transaction.

ALTER TYPE "PasswordRecoveryChallengeStatus" ADD VALUE 'SUPPRESSED';

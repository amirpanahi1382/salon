-- Phone-owned onboarding after agreement acceptance.
-- Existing rows stay PRODUCT or AWAITING_AGREEMENT. This statement does not update them.
-- The new value is not used in this migration. PostgreSQL cannot use an enum
-- value added in the same transaction.

ALTER TYPE "SalonAccessState" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';

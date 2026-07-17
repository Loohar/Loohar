ALTER TYPE "PendingRegistrationStatus" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFICATION_PENDING';
ALTER TYPE "PendingRegistrationStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING';
ALTER TYPE "PendingRegistrationStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_PROCESSING';
ALTER TYPE "PendingRegistrationStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "PendingRegistrationStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "PendingRegistrationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "PendingRegistration"
  ADD COLUMN IF NOT EXISTS "normalizedEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "billingInterval" TEXT NOT NULL DEFAULT 'MONTHLY';

CREATE INDEX IF NOT EXISTS "PendingRegistration_normalizedEmail_idx" ON "PendingRegistration"("normalizedEmail");

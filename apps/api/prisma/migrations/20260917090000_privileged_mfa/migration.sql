-- Privileged-role MFA (TOTP). Additive: new nullable/defaulted columns and a new table.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "mfaPendingSecret" TEXT,
  ADD COLUMN IF NOT EXISTS "mfaLastUsedStep" INTEGER,
  ADD COLUMN IF NOT EXISTS "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mfaLockedUntil" TIMESTAMP(3);

ALTER TABLE "AuthSession"
  ADD COLUMN IF NOT EXISTS "mfaVerifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "UserMfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserMfaRecoveryCode_codeHash_key" ON "UserMfaRecoveryCode"("codeHash");
CREATE INDEX IF NOT EXISTS "UserMfaRecoveryCode_userId_usedAt_idx" ON "UserMfaRecoveryCode"("userId", "usedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserMfaRecoveryCode_userId_fkey') THEN
    ALTER TABLE "UserMfaRecoveryCode"
      ADD CONSTRAINT "UserMfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Any pre-existing plaintext MFA configuration from the earlier foundation cannot be trusted:
-- clear it so affected users re-enroll through the verified flow.
UPDATE "User"
SET "mfaEnabled" = false, "mfaSecret" = NULL, "mfaSetupStatus" = 'NOT_CONFIGURED', "mfaVerifiedAt" = NULL
WHERE ("mfaSecret" IS NOT NULL AND "mfaSecret" NOT LIKE 'v1.%') OR ("mfaEnabled" = true AND "mfaSecret" IS NULL);

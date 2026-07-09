UPDATE "User"
SET "passwordChangedAt" = "updatedAt"
WHERE "passwordChangedAt" IS NULL
  AND "forcePasswordChange" = false
  AND "temporaryPassword" = false;

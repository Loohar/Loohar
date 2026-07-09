ALTER TABLE "User"
ADD COLUMN "temporaryPassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

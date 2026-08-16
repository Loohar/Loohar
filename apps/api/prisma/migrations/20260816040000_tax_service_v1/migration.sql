CREATE TYPE "TaxAddressValidationStatus" AS ENUM (
  'UNVERIFIED',
  'VALID',
  'INVALID',
  'PROVIDER_UNAVAILABLE'
);

CREATE TYPE "TaxProfileStatus" AS ENUM (
  'UNCONFIGURED',
  'ADDRESS_REQUIRED',
  'VERIFYING',
  'REVIEW_REQUIRED',
  'ACTIVE',
  'EXPIRED',
  'REFRESH_REQUIRED',
  'PROVIDER_ERROR',
  'UNSUPPORTED_JURISDICTION',
  'DISABLED',
  'SUPERSEDED'
);

CREATE TYPE "TaxVerificationStatus" AS ENUM (
  'UNVERIFIED',
  'PENDING',
  'VERIFIED',
  'FAILED',
  'EXPIRED',
  'REFRESH_REQUIRED'
);

ALTER TABLE "RestaurantLocation"
  ADD COLUMN "normalizedAddressJson" JSONB,
  ADD COLUMN "addressValidationStatus" "TaxAddressValidationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "addressVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "taxStatus" "TaxProfileStatus" NOT NULL DEFAULT 'UNCONFIGURED',
  ADD COLUMN "taxStatusCode" TEXT,
  ADD COLUMN "taxStatusMessage" TEXT,
  ADD COLUMN "taxLastAttemptAt" TIMESTAMP(3);

ALTER TABLE "LocationTaxProfile"
  ADD COLUMN "status" "TaxProfileStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  ADD COLUMN "verificationStatus" "TaxVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "countryCode" TEXT,
  ADD COLUMN "stateCode" TEXT,
  ADD COLUMN "county" TEXT,
  ADD COLUMN "municipality" TEXT,
  ADD COLUMN "specialDistrictsJson" JSONB,
  ADD COLUMN "taxComponentsJson" JSONB,
  ADD COLUMN "exemptionJson" JSONB,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "nextVerificationAt" TIMESTAMP(3),
  ADD COLUMN "acknowledgementVersion" TEXT,
  ADD COLUMN "acknowledgedByUserId" TEXT,
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ALTER COLUMN "enabled" SET DEFAULT false;

DROP INDEX "LocationTaxProfile_restaurantId_locationId_enabled_effectiveAt_idx";

CREATE INDEX "LocationTaxProfile_restaurantId_locationId_status_enabled_effectiveAt_idx"
  ON "LocationTaxProfile"("restaurantId", "locationId", "status", "enabled", "effectiveAt");

CREATE INDEX "LocationTaxProfile_status_nextVerificationAt_idx"
  ON "LocationTaxProfile"("status", "nextVerificationAt");

CREATE UNIQUE INDEX "LocationTaxProfile_one_active_per_location_idx"
  ON "LocationTaxProfile"("restaurantId", "locationId")
  WHERE "status" = 'ACTIVE' AND "enabled" = true;

ALTER TABLE "OrderQuote"
  ADD COLUMN "taxProfileId" TEXT,
  ADD COLUMN "taxConfigurationVersion" TEXT,
  ADD COLUMN "taxSnapshotJson" JSONB;

ALTER TABLE "OrderTaxSnapshot"
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "taxProfileId" TEXT,
  ADD COLUMN "configurationVersion" TEXT,
  ADD COLUMN "source" TEXT;

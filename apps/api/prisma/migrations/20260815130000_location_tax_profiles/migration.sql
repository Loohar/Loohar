CREATE TABLE "LocationTaxProfile" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "taxRateBps" INTEGER NOT NULL,
  "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "jurisdictionCode" TEXT NOT NULL,
  "jurisdictionJson" JSONB NOT NULL,
  "sourceMetadataJson" JSONB NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "configurationVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocationTaxProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LocationTaxProfile_taxRateBps_check" CHECK ("taxRateBps" >= 0 AND "taxRateBps" <= 100000)
);

CREATE UNIQUE INDEX "LocationTaxProfile_restaurantId_locationId_configurationVersion_key"
  ON "LocationTaxProfile"("restaurantId", "locationId", "configurationVersion");

CREATE INDEX "LocationTaxProfile_restaurantId_locationId_enabled_effectiveAt_idx"
  ON "LocationTaxProfile"("restaurantId", "locationId", "enabled", "effectiveAt");

ALTER TABLE "LocationTaxProfile"
  ADD CONSTRAINT "LocationTaxProfile_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LocationTaxProfile"
  ADD CONSTRAINT "LocationTaxProfile_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

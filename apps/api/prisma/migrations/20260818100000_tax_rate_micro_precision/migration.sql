ALTER TABLE "LocationTaxProfile"
  ADD COLUMN "taxRateMicros" INTEGER;

ALTER TABLE "OrderTaxSnapshot"
  ADD COLUMN "taxRateMicros" INTEGER;

ALTER TABLE "TaxConfiguration"
  ADD COLUMN "taxRateMicros" INTEGER;

ALTER TABLE "LocationTaxProfile"
  ADD CONSTRAINT "LocationTaxProfile_taxRateMicros_check"
  CHECK ("taxRateMicros" IS NULL OR ("taxRateMicros" >= 0 AND "taxRateMicros" <= 10000000));

ALTER TABLE "OrderTaxSnapshot"
  ADD CONSTRAINT "OrderTaxSnapshot_taxRateMicros_check"
  CHECK ("taxRateMicros" IS NULL OR ("taxRateMicros" >= 0 AND "taxRateMicros" <= 10000000));

ALTER TABLE "TaxConfiguration"
  ADD CONSTRAINT "TaxConfiguration_taxRateMicros_check"
  CHECK ("taxRateMicros" IS NULL OR ("taxRateMicros" >= 0 AND "taxRateMicros" <= 10000000));

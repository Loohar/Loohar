ALTER TABLE "OrderTaxSnapshot"
  ALTER COLUMN "taxRateBps" DROP DEFAULT;

ALTER TABLE "TaxConfiguration"
  ALTER COLUMN "taxRateBps" DROP DEFAULT;

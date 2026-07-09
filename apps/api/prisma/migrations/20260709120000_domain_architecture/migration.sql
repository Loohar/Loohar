ALTER TYPE "DomainStatus" ADD VALUE IF NOT EXISTS 'SSL_PENDING';
ALTER TYPE "DomainStatus" ADD VALUE IF NOT EXISTS 'FAILED';

ALTER TYPE "SslStatus" ADD VALUE IF NOT EXISTS 'SSL_PENDING';
ALTER TYPE "SslStatus" ADD VALUE IF NOT EXISTS 'FAILED';

ALTER TABLE "RestaurantDomain"
  ADD COLUMN IF NOT EXISTS "primaryDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "canonicalDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "domainVerifiedAt" TIMESTAMP(3);

UPDATE "RestaurantDomain" AS domain
SET
  "primaryDomain" = COALESCE(domain."primaryDomain", domain."defaultSubdomain" || '.loohar.com'),
  "canonicalDomain" = COALESCE(domain."canonicalDomain", domain."defaultSubdomain" || '.loohar.com')
WHERE domain."primaryDomain" IS NULL OR domain."canonicalDomain" IS NULL;

CREATE INDEX IF NOT EXISTS "RestaurantDomain_primaryDomain_idx" ON "RestaurantDomain"("primaryDomain");
CREATE INDEX IF NOT EXISTS "RestaurantDomain_canonicalDomain_idx" ON "RestaurantDomain"("canonicalDomain");

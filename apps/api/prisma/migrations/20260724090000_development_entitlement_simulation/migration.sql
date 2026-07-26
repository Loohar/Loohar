CREATE TYPE "TenantClassification" AS ENUM ('STANDARD', 'INTERNAL_DEVELOPMENT', 'PRIVATE_BETA', 'DEMO');

CREATE TYPE "EntitlementSimulationMode" AS ENUM ('FULL_ACCESS', 'SIMULATE_PLAN', 'SIMULATE_SUSPENDED', 'SIMULATE_EXPIRED_TRIAL', 'SIMULATE_PAST_DUE', 'SIMULATE_CANCELLED');

ALTER TABLE "Restaurant"
ADD COLUMN "tenantClassification" "TenantClassification" NOT NULL DEFAULT 'STANDARD';

CREATE TABLE "TenantEntitlementSimulation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" "EntitlementSimulationMode" NOT NULL DEFAULT 'FULL_ACCESS',
  "simulatedPlan" "SubscriptionPlanCode",
  "simulatedSubscriptionStatus" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TenantEntitlementSimulation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantEntitlementSimulation_tenantId_key" ON "TenantEntitlementSimulation"("tenantId");
CREATE INDEX "TenantEntitlementSimulation_enabled_mode_idx" ON "TenantEntitlementSimulation"("enabled", "mode");
CREATE INDEX "TenantEntitlementSimulation_expiresAt_idx" ON "TenantEntitlementSimulation"("expiresAt");

ALTER TABLE "TenantEntitlementSimulation"
ADD CONSTRAINT "TenantEntitlementSimulation_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing tenants remain STANDARD by default.
-- Internal development tenants must be marked explicitly with the controlled
-- tenant:mark-development script, which requires DEVELOPMENT_TENANT_ID.

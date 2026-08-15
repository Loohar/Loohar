import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { describeDatabaseUrl, printSafeUrlSummary, redactSensitiveText } from "./safe-db-url-metadata.mjs";

for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "apps/api/.env")]) {
  if (existsSync(envPath)) loadDotenv({ path: envPath, override: false });
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredDate(name) {
  const value = required(name);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} must be an ISO-8601 timestamp.`);
  return date;
}

function optional(name) {
  return String(process.env[name] || "").trim() || null;
}

const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "";
const expectedProjectRef = required("EXPECTED_SUPABASE_PROJECT_REF");
const databaseUrl = required("DATABASE_URL");
const directUrl = required("DIRECT_URL");
const databaseMeta = describeDatabaseUrl(databaseUrl);
const directMeta = describeDatabaseUrl(directUrl);

if (appEnv !== "staging") throw new Error("APP_ENV must be staging.");
if (required("STAGING_TAX_PROFILE_CONFIRM") !== "OFFLINE_V1_CERTIFICATION_ONLY") {
  throw new Error("STAGING_TAX_PROFILE_CONFIRM does not authorize the isolated certification write.");
}
if (required("STAGING_TAX_PROFILE_SYNTHETIC") !== "true") {
  throw new Error("STAGING_TAX_PROFILE_SYNTHETIC must be true.");
}
for (const [label, metadata] of [["DATABASE_URL", databaseMeta], ["DIRECT_URL", directMeta]]) {
  if (!metadata.ok || metadata.projectRef !== expectedProjectRef) {
    throw new Error(`${label} does not match the expected staging Supabase project.`);
  }
  if (metadata.mode === "supabase-transaction-pooler") {
    throw new Error(`${label} must not use the transaction pooler.`);
  }
}

const taxRateBps = Number(required("STAGING_TAX_RATE_BPS"));
if (!Number.isSafeInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 100_000) {
  throw new Error("STAGING_TAX_RATE_BPS must be an integer from 0 through 100000.");
}

const tenantSlug = required("STAGING_TAX_TENANT_SLUG");
const locationName = required("STAGING_TAX_LOCATION_NAME");
const configurationVersion = required("STAGING_TAX_CONFIGURATION_VERSION");
const provider = required("STAGING_TAX_PROVIDER");
const source = required("STAGING_TAX_SOURCE");
const sourceReference = required("STAGING_TAX_SOURCE_REFERENCE");
const jurisdictionCode = required("STAGING_TAX_JURISDICTION_CODE");
const effectiveAt = requiredDate("STAGING_TAX_EFFECTIVE_AT");
const verifiedAt = requiredDate("STAGING_TAX_VERIFIED_AT");

if (verifiedAt < effectiveAt) throw new Error("STAGING_TAX_VERIFIED_AT must be on or after STAGING_TAX_EFFECTIVE_AT.");

printSafeUrlSummary("DATABASE_URL", databaseMeta, expectedProjectRef);
printSafeUrlSummary("DIRECT_URL", directMeta, expectedProjectRef);

process.env.DATABASE_URL = directUrl;
process.env.DIRECT_URL = directUrl;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ log: [{ level: "error", emit: "event" }] });

try {
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: tenantSlug },
    include: { locations: { where: { active: true } } }
  });
  if (!restaurant) throw new Error("The requested staging tenant was not found.");
  if (restaurant.tenantClassification !== "INTERNAL_DEVELOPMENT") {
    throw new Error("The requested tenant is not classified as INTERNAL_DEVELOPMENT.");
  }
  const matchingLocations = restaurant.locations.filter((location) => location.name === locationName);
  if (matchingLocations.length !== 1) {
    throw new Error("The requested active staging location did not resolve uniquely.");
  }
  const location = matchingLocations[0];
  const jurisdictionMetadata = {
    code: jurisdictionCode,
    countryCode: optional("STAGING_TAX_JURISDICTION_COUNTRY"),
    regionCode: optional("STAGING_TAX_JURISDICTION_REGION"),
    locality: optional("STAGING_TAX_JURISDICTION_LOCALITY"),
    tenantSlug,
    locationName: location.name,
    locationAddress: location.address || null,
    environment: "staging",
    synthetic: true
  };
  const sourceMetadata = {
    reference: sourceReference,
    environment: "staging",
    synthetic: true,
    purpose: "Offline v1 certification",
    synchronizedAt: verifiedAt.toISOString()
  };

  const profile = await prisma.$transaction(async (tx) => {
    await tx.locationTaxProfile.updateMany({
      where: {
        restaurantId: restaurant.id,
        locationId: location.id,
        enabled: true,
        NOT: { configurationVersion }
      },
      data: { enabled: false }
    });
    const nextProfile = await tx.locationTaxProfile.upsert({
      where: {
        restaurantId_locationId_configurationVersion: {
          restaurantId: restaurant.id,
          locationId: location.id,
          configurationVersion
        }
      },
      update: {
        provider,
        source,
        taxRateBps,
        taxInclusive: false,
        enabled: true,
        jurisdictionCode,
        jurisdictionJson: jurisdictionMetadata,
        sourceMetadataJson: sourceMetadata,
        effectiveAt,
        verifiedAt
      },
      create: {
        restaurantId: restaurant.id,
        locationId: location.id,
        provider,
        source,
        taxRateBps,
        taxInclusive: false,
        enabled: true,
        jurisdictionCode,
        jurisdictionJson: jurisdictionMetadata,
        sourceMetadataJson: sourceMetadata,
        effectiveAt,
        verifiedAt,
        configurationVersion
      }
    });
    await tx.auditLog.create({
      data: {
        restaurantId: restaurant.id,
        action: "staging.location_tax_profile.synchronized",
        entityType: "LocationTaxProfile",
        entityId: nextProfile.id,
        metadataJson: {
          environment: "staging",
          synthetic: true,
          locationId: location.id,
          configurationVersion,
          source,
          sourceReference,
          jurisdictionCode,
          effectiveAt: effectiveAt.toISOString(),
          verifiedAt: verifiedAt.toISOString()
        }
      }
    });
    return nextProfile;
  });

  console.log("Staging location tax profile synchronized.", {
    tenantSlug,
    locationName: location.name,
    profileId: profile.id,
    taxRateBps: profile.taxRateBps,
    configurationVersion: profile.configurationVersion,
    effectiveAt: profile.effectiveAt.toISOString(),
    verifiedAt: profile.verifiedAt.toISOString(),
    synthetic: true
  });
} catch (error) {
  console.error(redactSensitiveText(error?.message || String(error)));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

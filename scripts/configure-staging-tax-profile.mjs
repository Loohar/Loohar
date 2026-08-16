import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { describeDatabaseUrl, printSafeUrlSummary, redactSensitiveText } from "./safe-db-url-metadata.mjs";
import { ManualVerifiedTaxProvider, normalizeBusinessAddress, validateBusinessAddress } from "../apps/api/src/services/taxDomain.js";

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
const expectedTenantClassification = required("STAGING_TAX_EXPECTED_TENANT_CLASSIFICATION");
const expectedConfigurationVersion = optional("STAGING_TAX_CONFIGURATION_VERSION");
const provider = required("STAGING_TAX_PROVIDER");
const source = required("STAGING_TAX_SOURCE");
const sourceReference = required("STAGING_TAX_SOURCE_REFERENCE");
const jurisdictionCode = required("STAGING_TAX_JURISDICTION_CODE");
const countryCode = required("STAGING_TAX_JURISDICTION_COUNTRY");
const stateCode = required("STAGING_TAX_JURISDICTION_REGION");
const county = required("STAGING_TAX_JURISDICTION_COUNTY");
const municipality = required("STAGING_TAX_JURISDICTION_LOCALITY");
const effectiveAt = requiredDate("STAGING_TAX_EFFECTIVE_AT");
const verifiedAt = requiredDate("STAGING_TAX_VERIFIED_AT");

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
  if (restaurant.tenantClassification !== expectedTenantClassification) {
    throw new Error("The requested tenant classification does not match the explicit staging expectation.");
  }
  if (restaurant.status !== "ACTIVE") throw new Error("The requested staging tenant is not active.");
  const matchingLocations = restaurant.locations.filter((location) => location.name === locationName);
  if (matchingLocations.length !== 1) {
    throw new Error("The requested active staging location did not resolve uniquely.");
  }
  const location = matchingLocations[0];
  const normalizedAddress = normalizeBusinessAddress(location);
  const addressValidation = validateBusinessAddress(normalizedAddress);
  if (!addressValidation.valid) throw new Error(`The staging location address is incomplete: ${addressValidation.missing.join(", ")}.`);
  const verifiedConfiguration = await new ManualVerifiedTaxProvider().verifyTaxConfiguration({
    restaurantId: restaurant.id,
    locationId: location.id,
    address: normalizedAddress,
    effectiveAt,
    manualConfiguration: {
      taxRateBps,
      taxInclusive: false,
      jurisdictionCode,
      county,
      municipality,
      sourceReference,
      verificationMethod: "isolated-staging-certification",
      verifiedBy: "staging-certification-script",
      verifiedAt
    }
  });
  if (provider !== verifiedConfiguration.provider || source !== verifiedConfiguration.source) {
    throw new Error("Staging provider/source must identify the verified manual TaxProvider workflow.");
  }
  if (countryCode !== verifiedConfiguration.countryCode || stateCode !== verifiedConfiguration.stateCode) {
    throw new Error("Staging jurisdiction metadata does not match the location's normalized address.");
  }
  if (expectedConfigurationVersion && expectedConfigurationVersion !== verifiedConfiguration.configurationVersion) {
    throw new Error("STAGING_TAX_CONFIGURATION_VERSION does not match the derived immutable version.");
  }
  const configurationVersion = verifiedConfiguration.configurationVersion;

  const profile = await prisma.$transaction(async (tx) => {
    const existingProfile = await tx.locationTaxProfile.findUnique({
      where: {
        restaurantId_locationId_configurationVersion: {
          restaurantId: restaurant.id,
          locationId: location.id,
          configurationVersion
        }
      }
    });
    const nextProfile = existingProfile || await tx.locationTaxProfile.create({
      data: {
        restaurantId: restaurant.id,
        locationId: location.id,
        status: "REVIEW_REQUIRED",
        verificationStatus: "VERIFIED",
        provider,
        source,
        taxRateBps: verifiedConfiguration.taxRateBps,
        taxInclusive: verifiedConfiguration.taxInclusive,
        enabled: false,
        countryCode: verifiedConfiguration.countryCode,
        stateCode: verifiedConfiguration.stateCode,
        county: verifiedConfiguration.county,
        municipality: verifiedConfiguration.municipality,
        jurisdictionCode: verifiedConfiguration.jurisdictionCode,
        jurisdictionJson: verifiedConfiguration.jurisdictionMetadata,
        specialDistrictsJson: verifiedConfiguration.specialDistricts,
        taxComponentsJson: verifiedConfiguration.taxComponents,
        exemptionJson: verifiedConfiguration.exemption,
        sourceMetadataJson: verifiedConfiguration.sourceMetadata,
        effectiveAt: verifiedConfiguration.effectiveAt,
        expiresAt: verifiedConfiguration.expiresAt,
        verifiedAt: verifiedConfiguration.verifiedAt,
        lastVerifiedAt: verifiedConfiguration.verifiedAt,
        nextVerificationAt: verifiedConfiguration.nextVerificationAt,
        configurationVersion
      }
    });
    await tx.restaurantLocation.update({
      where: { id: location.id },
      data: {
        taxStatus: "REVIEW_REQUIRED",
        taxStatusCode: "TAX_PROFILE_REVIEW_REQUIRED",
        taxStatusMessage: "Review and acknowledge the synthetic staging profile before activation.",
        taxLastAttemptAt: verifiedAt,
        normalizedAddressJson: addressValidation.address,
        addressValidationStatus: "VALID",
        addressVerifiedAt: verifiedAt
      }
    });
    await tx.auditLog.create({
      data: {
        restaurantId: restaurant.id,
        action: "staging.location_tax_profile.candidate_created",
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

  console.log("Staging location tax profile candidate created.", {
    tenantSlug,
    locationName: location.name,
    profileId: profile.id,
    taxRateBps: profile.taxRateBps,
    configurationVersion: profile.configurationVersion,
    effectiveAt: profile.effectiveAt.toISOString(),
    verifiedAt: profile.verifiedAt.toISOString(),
    requiresAcknowledgement: true,
    synthetic: true
  });
} catch (error) {
  console.error(redactSensitiveText(error?.message || String(error)));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

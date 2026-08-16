import assert from "node:assert/strict";
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

const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "";
const expectedProjectRef = required("EXPECTED_SUPABASE_PROJECT_REF");
const databaseUrl = required("DATABASE_URL");
const directUrl = required("DIRECT_URL");
const databaseMeta = describeDatabaseUrl(databaseUrl);
const directMeta = describeDatabaseUrl(directUrl);

if (appEnv !== "staging") throw new Error("APP_ENV must be staging.");
if (required("STAGING_TAX_CERTIFICATION_CONFIRM") !== "TAX_SERVICE_V1_ISOLATED_ONLY") {
  throw new Error("STAGING_TAX_CERTIFICATION_CONFIRM does not authorize this isolated fixture write.");
}
for (const [label, metadata] of [["DATABASE_URL", databaseMeta], ["DIRECT_URL", directMeta]]) {
  if (!metadata.ok || metadata.projectRef !== expectedProjectRef) {
    throw new Error(`${label} does not match the expected staging Supabase project.`);
  }
  if (metadata.mode === "supabase-transaction-pooler") {
    throw new Error(`${label} must not use the transaction pooler.`);
  }
}

printSafeUrlSummary("DATABASE_URL", databaseMeta, expectedProjectRef);
printSafeUrlSummary("DIRECT_URL", directMeta, expectedProjectRef);
process.env.DATABASE_URL = directUrl;
process.env.DIRECT_URL = directUrl;

const {
  acknowledgeAndActivateTaxProfile,
  createManualVerifiedTaxProfile,
  findValidLocationTaxConfiguration,
  getTaxWorkspace,
  taxProfileHistory
} = await import("../apps/api/src/services/taxProfileService.js");
const { ManualVerifiedTaxProvider } = await import("../apps/api/src/services/taxDomain.js");
const { disconnectPrisma, prisma } = await import("../apps/api/src/config/prisma.js");

const FIXTURE_PREFIX = "tax-service-v1-cert";
const effectiveAt = new Date("2026-08-15T00:00:00.000Z");
const verifiedAt = new Date("2026-08-15T12:00:00.000Z");
const nextVerificationAt = new Date("2026-11-15T00:00:00.000Z");
const expiresAt = new Date("2027-02-15T00:00:00.000Z");
const provider = new ManualVerifiedTaxProvider();

const tenantFixtures = [
  {
    id: `${FIXTURE_PREFIX}-tenant-a`,
    slug: `${FIXTURE_PREFIX}-tenant-a`,
    name: "Tax Service V1 Certification Tenant A",
    owner: {
      id: `${FIXTURE_PREFIX}-owner-a`,
      email: `${FIXTURE_PREFIX}-owner-a@staging.invalid`
    },
    locations: [
      {
        id: `${FIXTURE_PREFIX}-tenant-a-denver`,
        name: "Certification Denver",
        address: "1700 Lincoln Street",
        city: "Denver",
        state: "CO",
        zip: "80203",
        country: "US",
        county: "Denver",
        municipality: "Denver",
        jurisdictionCode: "STAGING:US:CO:DENVER:CERT-A-1",
        taxRateBps: 825,
        sourceReference: "tax-service-v1-cert-a-denver-v2",
        previousProfile: {
          taxRateBps: 750,
          sourceReference: "tax-service-v1-cert-a-denver-v1",
          effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
          verifiedAt: new Date("2026-08-01T12:00:00.000Z")
        }
      },
      {
        id: `${FIXTURE_PREFIX}-tenant-a-boulder`,
        name: "Certification Boulder",
        address: "1777 Broadway",
        city: "Boulder",
        state: "CO",
        zip: "80302",
        country: "US",
        county: "Boulder",
        municipality: "Boulder",
        jurisdictionCode: "STAGING:US:CO:BOULDER:CERT-A-2",
        taxRateBps: 625,
        sourceReference: "tax-service-v1-cert-a-boulder-v1"
      },
      {
        id: `${FIXTURE_PREFIX}-tenant-a-profileless`,
        name: "Certification Profileless",
        address: "100 Test Plaza",
        city: "Denver",
        state: "CO",
        zip: "80202",
        country: "US",
        profileless: true
      }
    ]
  },
  {
    id: `${FIXTURE_PREFIX}-tenant-b`,
    slug: `${FIXTURE_PREFIX}-tenant-b`,
    name: "Tax Service V1 Certification Tenant B",
    owner: {
      id: `${FIXTURE_PREFIX}-owner-b`,
      email: `${FIXTURE_PREFIX}-owner-b@staging.invalid`
    },
    locations: [
      {
        id: `${FIXTURE_PREFIX}-tenant-b-zero`,
        name: "Certification Explicit Zero",
        address: "30 South Nevada Avenue",
        city: "Colorado Springs",
        state: "CO",
        zip: "80903",
        country: "US",
        county: "El Paso",
        municipality: "Colorado Springs",
        jurisdictionCode: "STAGING:US:CO:COLORADO-SPRINGS:CERT-B-1",
        taxRateBps: 0,
        sourceReference: "tax-service-v1-cert-b-zero-v1",
        exemption: {
          type: "SYNTHETIC_VERIFIED_ZERO_RATE",
          reference: "tax-service-v1-cert-explicit-zero"
        }
      }
    ]
  }
];

async function upsertTenant(fixture) {
  const restaurant = await prisma.restaurant.upsert({
    where: { id: fixture.id },
    update: {
      name: fixture.name,
      businessName: fixture.name,
      slug: fixture.slug,
      status: "ACTIVE",
      tenantClassification: "INTERNAL_DEVELOPMENT"
    },
    create: {
      id: fixture.id,
      name: fixture.name,
      businessName: fixture.name,
      slug: fixture.slug,
      status: "ACTIVE",
      tenantClassification: "INTERNAL_DEVELOPMENT",
      description: "Isolated Tax Service V1 staging certification fixture."
    }
  });
  const owner = await prisma.user.upsert({
    where: { id: fixture.owner.id },
    update: {
      email: fixture.owner.email,
      name: `${fixture.name} Owner`,
      role: "RESTAURANT_OWNER",
      status: "SUSPENDED",
      restaurantId: restaurant.id
    },
    create: {
      id: fixture.owner.id,
      email: fixture.owner.email,
      passwordHash: "STAGING_CERTIFICATION_FIXTURE_NOT_FOR_LOGIN",
      name: `${fixture.name} Owner`,
      role: "RESTAURANT_OWNER",
      status: "SUSPENDED",
      restaurantId: restaurant.id
    }
  });
  return { restaurant, owner };
}

async function upsertLocation(restaurantId, fixture) {
  return prisma.restaurantLocation.upsert({
    where: { id: fixture.id },
    update: {
      restaurantId,
      name: fixture.name,
      address: fixture.address,
      timezone: "America/Denver",
      settingsJson: {
        city: fixture.city,
        state: fixture.state,
        zip: fixture.zip,
        country: fixture.country,
        certificationFixture: true
      },
      active: true,
      ...(fixture.profileless ? {
        normalizedAddressJson: null,
        addressValidationStatus: "UNVERIFIED",
        addressVerifiedAt: null,
        taxStatus: "UNCONFIGURED",
        taxStatusCode: "TAX_PROFILE_UNCONFIGURED",
        taxStatusMessage: "Staging certification profileless location.",
        taxLastAttemptAt: null
      } : {})
    },
    create: {
      id: fixture.id,
      restaurantId,
      name: fixture.name,
      address: fixture.address,
      timezone: "America/Denver",
      settingsJson: {
        city: fixture.city,
        state: fixture.state,
        zip: fixture.zip,
        country: fixture.country,
        certificationFixture: true
      },
      active: true,
      taxStatus: fixture.profileless ? "UNCONFIGURED" : "UNCONFIGURED",
      taxStatusCode: fixture.profileless ? "TAX_PROFILE_UNCONFIGURED" : null,
      taxStatusMessage: fixture.profileless ? "Staging certification profileless location." : null
    }
  });
}

function manualConfiguration(fixture, ownerId, overrides = {}) {
  const taxRateBps = overrides.taxRateBps ?? fixture.taxRateBps;
  return {
    taxRateBps,
    taxInclusive: false,
    jurisdictionCode: fixture.jurisdictionCode,
    county: fixture.county,
    municipality: fixture.municipality,
    sourceReference: overrides.sourceReference || fixture.sourceReference,
    verificationMethod: "isolated-staging-certification",
    verifiedBy: ownerId,
    verifiedAt: overrides.verifiedAt || verifiedAt,
    effectiveAt: overrides.effectiveAt || effectiveAt,
    expiresAt,
    nextVerificationAt,
    taxComponents: taxRateBps === 0 ? [] : [{
      type: "COMBINED",
      name: "Synthetic certification combined rate",
      jurisdictionCode: fixture.jurisdictionCode,
      rateBps: taxRateBps
    }],
    specialDistricts: [],
    exemption: fixture.exemption || {}
  };
}

async function ensureProfile({ restaurantId, location, ownerId, configuration }) {
  const address = {
    addressLine1: location.address,
    addressLine2: "",
    city: location.settingsJson.city,
    stateProvince: location.settingsJson.state,
    postalCode: location.settingsJson.zip,
    country: location.settingsJson.country
  };
  const resolved = await provider.verifyTaxConfiguration({
    restaurantId,
    locationId: location.id,
    address,
    effectiveAt: configuration.effectiveAt,
    manualConfiguration: configuration
  });
  let profile = await prisma.locationTaxProfile.findUnique({
    where: {
      restaurantId_locationId_configurationVersion: {
        restaurantId,
        locationId: location.id,
        configurationVersion: resolved.configurationVersion
      }
    }
  });
  if (!profile) {
    const created = await createManualVerifiedTaxProfile({
      restaurantId,
      locationId: location.id,
      actorUserId: ownerId,
      configuration
    });
    profile = await prisma.locationTaxProfile.findUnique({ where: { id: created.id } });
  }
  if (profile.status === "REVIEW_REQUIRED") {
    await acknowledgeAndActivateTaxProfile({
      restaurantId,
      locationId: location.id,
      profileId: profile.id,
      actorUserId: ownerId,
      confirmed: true,
      configurationVersion: profile.configurationVersion
    });
    profile = await prisma.locationTaxProfile.findUnique({ where: { id: profile.id } });
  }
  return profile;
}

try {
  const fixtureState = [];
  for (const tenantFixture of tenantFixtures) {
    const { restaurant, owner } = await upsertTenant(tenantFixture);
    const locations = [];
    for (const locationFixture of tenantFixture.locations) {
      const location = await upsertLocation(restaurant.id, locationFixture);
      if (locationFixture.profileless) {
        await prisma.locationTaxProfile.deleteMany({
          where: { restaurantId: restaurant.id, locationId: location.id }
        });
        locations.push({ fixture: locationFixture, location, profile: null });
        continue;
      }
      if (locationFixture.previousProfile) {
        await ensureProfile({
          restaurantId: restaurant.id,
          location,
          ownerId: owner.id,
          configuration: manualConfiguration(locationFixture, owner.id, locationFixture.previousProfile)
        });
      }
      const profile = await ensureProfile({
        restaurantId: restaurant.id,
        location,
        ownerId: owner.id,
        configuration: manualConfiguration(locationFixture, owner.id)
      });
      locations.push({ fixture: locationFixture, location, profile });
    }
    fixtureState.push({ fixture: tenantFixture, restaurant, owner, locations });
  }

  const tenantA = fixtureState[0];
  const tenantB = fixtureState[1];
  const tenantADenver = tenantA.locations[0];
  const tenantABoulder = tenantA.locations[1];
  const tenantAProfileless = tenantA.locations[2];
  const tenantBZero = tenantB.locations[0];
  const [denverProfile, boulderProfile, zeroProfile, missingProfile] = await Promise.all([
    findValidLocationTaxConfiguration({ restaurantId: tenantA.restaurant.id, locationId: tenantADenver.location.id }),
    findValidLocationTaxConfiguration({ restaurantId: tenantA.restaurant.id, locationId: tenantABoulder.location.id }),
    findValidLocationTaxConfiguration({ restaurantId: tenantB.restaurant.id, locationId: tenantBZero.location.id }),
    findValidLocationTaxConfiguration({ restaurantId: tenantA.restaurant.id, locationId: tenantAProfileless.location.id })
  ]);

  assert.equal(denverProfile?.taxRateBps, 825, "Tenant A Denver must use its explicit 825-bps fixture.");
  assert.equal(boulderProfile?.taxRateBps, 625, "Tenant A Boulder must use its independent 625-bps fixture.");
  assert.equal(zeroProfile?.taxRateBps, 0, "Tenant B explicit zero-rate fixture must remain active.");
  assert.equal(missingProfile, null, "The profileless location must fail closed.");
  assert.equal(new Set([denverProfile.configurationVersion, boulderProfile.configurationVersion, zeroProfile.configurationVersion]).size, 3, "Fixture versions must remain independently scoped.");

  const wrongTenantLookup = await findValidLocationTaxConfiguration({
    restaurantId: tenantA.restaurant.id,
    locationId: tenantBZero.location.id
  });
  assert.equal(wrongTenantLookup, null, "Tenant A must not resolve Tenant B's active profile.");
  await assert.rejects(
    () => taxProfileHistory({ restaurantId: tenantA.restaurant.id, locationId: tenantBZero.location.id }),
    (error) => error.code === "TAX_LOCATION_NOT_FOUND",
    "Cross-tenant profile history must be rejected."
  );

  const denverHistory = await taxProfileHistory({
    restaurantId: tenantA.restaurant.id,
    locationId: tenantADenver.location.id
  });
  assert.ok(denverHistory.some((profile) => profile.taxRateBps === 750 && profile.status === "SUPERSEDED"), "Historical rate must remain immutable and superseded.");
  assert.ok(denverHistory.some((profile) => profile.taxRateBps === 825 && profile.status === "ACTIVE"), "Current rate must be active as a new version.");

  const [workspaceA, workspaceB] = await Promise.all([
    getTaxWorkspace({ restaurantId: tenantA.restaurant.id }),
    getTaxWorkspace({ restaurantId: tenantB.restaurant.id })
  ]);
  assert.deepEqual(workspaceA.counts, { activeLocations: 3, readyLocations: 2 }, "Tenant A readiness must expose its profileless blocker.");
  assert.equal(workspaceA.ready, false, "Tenant A must fail first-sale readiness while one active location is profileless.");
  assert.deepEqual(workspaceB.counts, { activeLocations: 1, readyLocations: 1 }, "Tenant B explicit zero-rate location must be ready.");
  assert.equal(workspaceB.ready, true, "An explicit verified zero rate must not be treated as missing.");

  const auditCount = await prisma.auditLog.count({
    where: {
      restaurantId: { in: [tenantA.restaurant.id, tenantB.restaurant.id] },
      action: { in: ["tax.profile.created", "tax.profile.manual_verified", "tax.profile.acknowledged", "tax.profile.activated", "tax.profile.superseded"] }
    }
  });
  assert.ok(auditCount >= 13, "Staging fixture lifecycle must leave a privileged audit trail.");

  console.log("Tax Service V1 isolated staging fixture certification passed.", {
    environment: appEnv,
    tenants: fixtureState.length,
    locations: fixtureState.reduce((sum, tenant) => sum + tenant.locations.length, 0),
    activeProfiles: 3,
    profilelessLocations: 1,
    explicitZeroRateProfiles: 1,
    historicalVersions: denverHistory.length,
    crossTenantIsolation: "PASS",
    tenantAReadiness: workspaceA.counts,
    tenantBReadiness: workspaceB.counts,
    auditEvents: auditCount
  });
} catch (error) {
  console.error(redactSensitiveText(error?.stack || error?.message || String(error)));
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}

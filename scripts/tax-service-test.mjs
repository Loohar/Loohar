import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ColoradoTaxProvider,
  ManualVerifiedTaxProvider,
  TAX_PROFILE_STATUS,
  TAX_VERIFICATION_STATUS,
  isActiveTaxProfile,
  normalizeBusinessAddress,
  taxConfigurationVersion,
  taxProfileReadiness,
  validateBusinessAddress
} from "../apps/api/src/services/taxDomain.js";
import { calculatePosPricingSnapshot } from "../apps/shared/posOfflinePricing.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const schema = read("apps/api/prisma/schema.prisma");
const migration = read("apps/api/prisma/migrations/20260816040000_tax_service_v1/migration.sql");
const domain = read("apps/api/src/services/taxDomain.js");
const service = read("apps/api/src/services/taxProfileService.js");
const routes = read("apps/api/src/routes/taxProfiles.js");
const server = read("apps/api/src/server.js");
const restaurantRoutes = read("apps/api/src/routes/restaurant.js");
const locationService = read("apps/api/src/services/restaurantMetricsService.js");
const posService = read("apps/api/src/services/posService.js");
const quoteService = read("apps/api/src/modules/orderPayments/quoteService.js");
const paymentService = read("apps/api/src/modules/orderPayments/orderPaymentService.js");
const offlinePricing = read("apps/web/src/apps/pos/offlinePricing.js");
const app = read("apps/web/src/App.jsx");
const superAdmin = read("apps/api/src/routes/superAdmin.js");
const stagingCertification = read("scripts/certify-tax-service-staging.mjs");

const completeLocation = {
  id: "location-a",
  restaurantId: "tenant-a",
  address: "100 Main Street",
  settingsJson: {
    address2: "Suite 2",
    city: "Denver",
    state: "CO",
    zip: "80202",
    country: "US",
    latitude: 39.75,
    longitude: -104.99
  }
};

const normalized = normalizeBusinessAddress(completeLocation);
assert.equal(normalized.addressLine1, "100 Main Street");
assert.equal(normalized.city, "Denver");
assert.equal(normalized.stateProvince, "CO");
assert.equal(normalized.country, "US");
assert.equal(validateBusinessAddress(normalized).valid, true, "complete physical address must validate");
assert.equal(validateBusinessAddress({ ...normalized, country: "" }).valid, false, "country must be explicit for tax verification");
assert.equal(validateBusinessAddress({ ...normalized, country: "USA" }).code, "TAX_ADDRESS_INVALID", "tax addresses must use an explicit ISO alpha-2 country code");

const incomplete = validateBusinessAddress({ postalCode: "80202", country: "US" });
assert.equal(incomplete.valid, false, "ZIP-only input must never be a jurisdiction key");
assert.ok(incomplete.missing.includes("addressLine1") && incomplete.missing.includes("city") && incomplete.missing.includes("stateProvince"));

await assert.rejects(
  () => new ColoradoTaxProvider().resolveJurisdiction({ address: normalized }),
  (error) => error.code === "TAX_PROVIDER_NOT_CONFIGURED",
  "Colorado must fail safely without authoritative provider credentials"
);
await assert.rejects(
  () => new ColoradoTaxProvider().resolveJurisdiction({ address: { ...normalized, stateProvince: "WY" } }),
  (error) => error.code === "TAX_UNSUPPORTED_JURISDICTION",
  "unsupported jurisdictions must be explicit"
);

const manualProvider = new ManualVerifiedTaxProvider();
const verifiedAt = new Date(Date.now() - 60_000).toISOString();
const effectiveAt = new Date(Date.now() - 60_000).toISOString();
async function manualConfiguration(taxRateBps, extra = {}) {
  return manualProvider.getTaxConfiguration({
    restaurantId: "tenant-a",
    locationId: "location-a",
    address: normalized,
    effectiveAt,
    manualConfiguration: {
      taxRateBps,
      jurisdictionCode: "US-CO-DENVER-TEST",
      county: "Denver",
      municipality: "Denver",
      sourceReference: `authoritative-record-${taxRateBps}`,
      verificationMethod: "document-review",
      verifiedBy: "tax-admin",
      verifiedAt,
      ...extra
    }
  });
}

const rate825 = await manualConfiguration(825);
const rate625 = await manualConfiguration(625);
const rate0 = await manualConfiguration(0);
assert.equal(rate825.taxRateBps, 825, "explicit 825-bps profile must work as data");
assert.equal(rate625.taxRateBps, 625, "independent explicit rates must work");
assert.equal(rate0.taxRateBps, 0, "explicit verified zero rate must remain valid");
assert.notEqual(rate825.configurationVersion, rate625.configurationVersion, "rate changes must create a distinct version");
const changedSourceVersion = taxConfigurationVersion({ ...rate825, restaurantId: "tenant-a", locationId: "location-a", normalizedAddress: normalized.normalizedAddress, sourceMetadata: { ...rate825.sourceMetadata, sourceReference: "different-authoritative-record" } });
const changedAddressVersion = taxConfigurationVersion({ ...rate825, restaurantId: "tenant-a", locationId: "location-a", normalizedAddress: "200 Main Street | Denver, CO, 80202 | US" });
assert.notEqual(rate825.configurationVersion, changedSourceVersion, "source metadata changes must create a distinct version");
assert.notEqual(rate825.configurationVersion, changedAddressVersion, "physical address changes must create a distinct version");
const fixtureProfiles = await Promise.all([
  manualProvider.getTaxConfiguration({ restaurantId: "tenant-a", locationId: "location-1", address: normalized, effectiveAt, manualConfiguration: { taxRateBps: 825, jurisdictionCode: "A-L1", county: "Denver", municipality: "Denver", sourceReference: "fixture-a-l1", verifiedBy: "tax-admin", verifiedAt } }),
  manualProvider.getTaxConfiguration({ restaurantId: "tenant-a", locationId: "location-2", address: { ...normalized, addressLine1: "200 Main Street", normalizedAddress: "200 Main Street | Denver, CO, 80202 | US" }, effectiveAt, manualConfiguration: { taxRateBps: 625, jurisdictionCode: "A-L2", county: "Denver", municipality: "Denver", sourceReference: "fixture-a-l2", verifiedBy: "tax-admin", verifiedAt } }),
  manualProvider.getTaxConfiguration({ restaurantId: "tenant-b", locationId: "location-1", address: normalized, effectiveAt, manualConfiguration: { taxRateBps: 0, jurisdictionCode: "B-L1-EXEMPT", county: "Denver", municipality: "Denver", sourceReference: "fixture-b-l1", verifiedBy: "tax-admin", verifiedAt, exemption: { type: "verified-zero-rate" } } })
]);
assert.equal(new Set(fixtureProfiles.map((profile) => profile.configurationVersion)).size, 3, "multi-location and multi-tenant fixture profiles must version independently");
const profilesByScope = new Map(fixtureProfiles.map((profile, index) => [["tenant-a:location-1", "tenant-a:location-2", "tenant-b:location-1"][index], profile]));
assert.equal(profilesByScope.get("tenant-a:location-2").taxRateBps, 625, "a second location must retain its independent rate");
assert.equal(profilesByScope.get("tenant-b:location-1").taxRateBps, 0, "an explicit zero-rate tenant fixture must remain distinct from a missing profile");
assert.equal(profilesByScope.has("tenant-b:profileless-location"), false, "a profileless location must remain unconfigured rather than inheriting another location's profile");
await assert.rejects(
  () => manualConfiguration(825, { taxComponents: [{ type: "STATE", name: "State", jurisdictionCode: "US-CO", rateBps: 500 }] }),
  (error) => error.code === "TAX_COMPONENT_TOTAL_MISMATCH",
  "component rates must reconcile to the authoritative combined rate"
);

function activeProfile(configuration = rate0, overrides = {}) {
  return {
    ...configuration,
    id: "profile-active",
    status: TAX_PROFILE_STATUS.ACTIVE,
    verificationStatus: TAX_VERIFICATION_STATUS.VERIFIED,
    enabled: true,
    acknowledgedByUserId: "owner-a",
    acknowledgedAt: new Date(Date.now() - 30_000),
    acknowledgementVersion: configuration.configurationVersion,
    effectiveAt: new Date(configuration.effectiveAt),
    verifiedAt: new Date(configuration.verifiedAt),
    updatedAt: new Date(),
    ...overrides
  };
}

assert.equal(isActiveTaxProfile(activeProfile(rate0)), true, "an acknowledged explicit zero-rate profile must be active");
assert.equal(isActiveTaxProfile(activeProfile(rate625, { acknowledgedAt: null })), false, "owner acknowledgement must be required");
assert.equal(isActiveTaxProfile(activeProfile(rate625, { acknowledgementVersion: "stale-version" })), false, "acknowledgement must match the exact active version");
assert.equal(isActiveTaxProfile(activeProfile(rate625, { effectiveAt: new Date(Date.now() + 60_000) })), false, "future profiles must not activate early");
assert.equal(isActiveTaxProfile(activeProfile(rate625, { expiresAt: new Date(Date.now() - 1) })), false, "expired profiles must fail closed");
assert.equal(isActiveTaxProfile(activeProfile(rate625, { nextVerificationAt: new Date(Date.now() - 1) })), false, "profiles due for reverification must fail closed");
assert.equal(taxProfileReadiness(null).code, "TAX_PROFILE_UNCONFIGURED", "missing and zero-rate profiles must remain distinct");
const inclusivePricing = calculatePosPricingSnapshot({ lineItems: [{ unitPriceCents: 1000, quantity: 1 }], taxRateBps: 1000, taxInclusive: true });
assert.deepEqual({ taxCents: inclusivePricing.taxCents, totalCents: inclusivePricing.totalCents }, { taxCents: 91, totalCents: 1000 }, "tax-inclusive profiles must extract tax without adding it twice");

for (const requiredStatus of ["UNCONFIGURED", "ADDRESS_REQUIRED", "VERIFYING", "REVIEW_REQUIRED", "ACTIVE", "EXPIRED", "REFRESH_REQUIRED", "PROVIDER_ERROR", "UNSUPPORTED_JURISDICTION", "DISABLED"]) {
  assert.ok(schema.includes(requiredStatus), `schema must model ${requiredStatus}`);
}
for (const field of ["countryCode", "stateCode", "county", "municipality", "specialDistrictsJson", "taxComponentsJson", "expiresAt", "acknowledgedByUserId", "acknowledgedAt", "nextVerificationAt", "configurationVersion"]) {
  assert.ok(schema.includes(field), `tax profiles must include ${field}`);
}
assert.ok(schema.includes("@@unique([restaurantId, locationId, configurationVersion])"), "profile versions must be unique per tenant location");
assert.equal(/model LocationTaxProfile[\s\S]*?taxRateBps\s+Int\s+@default/.test(schema), false, "tax rates must never have a global default");
assert.equal(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(migration), false, "Tax Service migration must not rewrite restaurant tax data");
assert.equal(migration.includes("825"), false, "migration must not install a hardcoded rate");
assert.ok(migration.includes('LocationTaxProfile_one_active_per_location_idx') && migration.includes('WHERE "status" = \'ACTIVE\' AND "enabled" = true'), "database must enforce one active profile per tenant location");

assert.ok(domain.includes("class TaxProvider") && domain.includes("class ColoradoTaxProvider") && domain.includes("class ManualVerifiedTaxProvider"), "provider adapters must remain behind a universal interface");
assert.ok(domain.includes("TAX_PROVIDER_NOT_CONFIGURED") && domain.includes("TAX_UNSUPPORTED_JURISDICTION"), "providers must fail safely without guessing");
assert.equal(/postalCode\s*===|zip\s*===/.test(domain), false, "jurisdiction logic must not resolve from ZIP alone");

assert.ok(routes.includes("requireAuth") && routes.includes("requireTenantAccess"), "all tax profile endpoints must authenticate and isolate tenants");
assert.ok(routes.includes("manualVerificationRoles = [\"RESTAURANT_ADMIN\", \"SUPER_ADMIN\"]"), "manual verification must be restricted to privileged administrators");
assert.equal(routes.includes("CASHIER"), false, "cashiers must not receive tax profile administration access");
assert.ok(routes.includes("tax-profile/acknowledge") && routes.includes("tax-profile/history") && routes.includes("tax-profile/refresh"), "review, history, and refresh endpoints must exist");
assert.ok(server.includes("taxProfileRoutes"), "Tax Service routes must be mounted in the API");

assert.ok(service.includes("where: { id: locationId, restaurantId }"), "location lookups must enforce tenant and location identity together");
assert.ok(service.includes("restaurantId_locationId_configurationVersion"), "candidate versions must be location and tenant scoped");
assert.ok(service.includes('error?.code !== "P2002"') && service.includes("TAX_PROFILE_VERSION_FINALIZED"), "candidate creation must handle concurrent retries without rewriting finalized versions");
assert.ok(service.includes("status: TAX_PROFILE_STATUS.SUPERSEDED") && service.includes("oldVersion") && service.includes("newVersion"), "rate updates must supersede without rewriting history");
assert.ok(service.includes("acknowledgementVersion: candidate.configurationVersion"), "acknowledgement must bind to the reviewed version");
assert.ok(service.includes("validatedLocationAddress(location)") && service.includes("TAX_ADDRESS_VERIFICATION_REQUIRED"), "activation must revalidate the current location address");
assert.ok(domain.includes("profile.acknowledgementVersion !== profile.configurationVersion"), "runtime readiness must require acknowledgement of the exact version");
assert.ok(service.includes("status: TAX_PROFILE_STATUS.ACTIVE") && service.includes("verificationStatus: TAX_VERIFICATION_STATUS.VERIFIED"), "runtime profile lookup must require active verified state");
assert.ok(service.includes("expiresAt: { gt: asOf }") && service.includes("effectiveAt: { lte: asOf }"), "runtime lookup must enforce effective and expiry dates");
assert.ok(service.includes("nextVerificationAt: { gt: asOf }"), "runtime lookup must enforce verification freshness");
for (const action of ["tax.profile.created", "tax.profile.resolved", "tax.profile.manual_verified", "tax.profile.acknowledged", "tax.profile.activated", "tax.profile.refreshed", "tax.profile.superseded", "tax.profile.refresh_requested"]) {
  assert.ok(service.includes(action), `audit trail must record ${action}`);
}

assert.ok(locationService.includes("TAX_LOCATION_ADDRESS_CHANGED") && locationService.includes("status: { in: [\"ACTIVE\", \"REVIEW_REQUIRED\"] }"), "address changes must invalidate active and candidate profiles");
assert.ok(locationService.includes('action: "tax.profile.disabled"') && locationService.includes('reason: "location_address_changed"'), "address invalidation must audit every disabled tax profile version");
assert.ok(restaurantRoutes.includes("taxReady") && restaurantRoutes.includes("Financial checkout stays unavailable"), "onboarding readiness must explain tax checkout blocking");
assert.ok(superAdmin.includes('router.get("/tax-status"'), "Master Admin must have safe tax status visibility");

assert.ok(posService.includes('import { findValidLocationTaxConfiguration } from "./taxProfileService.js"'), "POS must use the active Tax Service profile path");
assert.ok(posService.includes("taxConfigurationVersion: taxConfiguration.configurationVersion"), "POS quotes must retain the tax profile version");
assert.ok(posService.includes("requireCurrentQuoteTaxSnapshot(quote)"), "POS order submission must reject stale tax quote snapshots without a provider call");
assert.ok(posService.includes("tx.orderTaxSnapshot.create") && posService.includes("taxProfileId: quote.taxProfileId"), "online POS orders must retain immutable tax snapshots");
assert.ok(quoteService.includes("restaurant.locations.length === 1") && quoteService.includes("ORDER_LOCATION_REQUIRED"), "online quotes must select an explicit location and fail safely for ambiguous multi-location tenants");
assert.ok(quoteService.includes("findValidLocationTaxConfiguration") && quoteService.includes("configuredTaxRateBps(taxConfiguration)"), "online ordering must use the same active location profile");
assert.ok(paymentService.includes("taxConfigurationVersion: quote.taxConfigurationVersion"), "customer order snapshots must retain historical profile versions");
assert.ok(paymentService.includes("locationId: quote.locationId"), "customer orders must retain the tax profile location");
assert.ok(offlinePricing.includes("acknowledgementVersion") && offlinePricing.includes("Offline tax configuration has expired"), "Offline v1 must require the same acknowledged, unexpired profile");
assert.ok(posService.includes("taxInclusive: taxConfiguration.taxInclusive") && offlinePricing.includes("taxInclusive: initialization.config.taxConfiguration.taxInclusive"), "online and Offline v1 pricing must use the profile tax-inclusive setting");
assert.ok(posService.includes("configurationProof.taxConfiguration.nextVerificationAt") && offlinePricing.includes("Offline tax configuration must be refreshed"), "Offline v1 must enforce tax verification freshness on client and server");

assert.ok(app.includes('id: "taxes", label: "Tax Configuration"'), "restaurant settings must expose Tax Configuration");
assert.ok(app.includes("I confirm that this verified business location and tax information are correct for this location."), "owner review must require explicit acknowledgement");
assert.ok(app.includes("Confirm & activate tax profile") && app.includes("First-sale readiness"), "settings must support activation and readiness");
assert.ok(app.includes("Special districts") && app.includes("Acknowledged") && app.includes("readyLocations"), "owner review must expose full jurisdiction and readiness details");
assert.ok(app.includes('taxWorkspace.ready ? "POS tax ready" : "Checkout blocked"'), "settings readiness must use the active-location workspace summary");
assert.ok(app.includes('taxWorkspace.ready ? "All active locations have an acknowledged tax profile and financial checkout is tax ready."'), "first-sale readiness must not claim checkout is blocked after every active location is ready");
assert.equal(app.includes("What tax rate do you want?"), false, "owners must not be asked to invent a rate");
assert.equal(app.includes("0.0825"), false, "frontend must not contain an implicit tax rate");

assert.ok(stagingCertification.includes('appEnv !== "staging"') && stagingCertification.includes('required("EXPECTED_SUPABASE_PROJECT_REF")'), "staging certification fixtures must refuse non-staging databases");
assert.ok(stagingCertification.includes('STAGING_TAX_CERTIFICATION_CONFIRM') && stagingCertification.includes('TAX_SERVICE_V1_ISOLATED_ONLY'), "staging fixture writes must require explicit authorization");
assert.ok(stagingCertification.includes("tenant-a-denver") && stagingCertification.includes("tenant-a-boulder") && stagingCertification.includes("tenant-b-zero") && stagingCertification.includes("tenant-a-profileless"), "staging certification must cover multi-location, multi-tenant, zero-rate, and profileless fixtures");
assert.ok(stagingCertification.includes("Cross-tenant profile history must be rejected") && stagingCertification.includes("Historical rate must remain immutable and superseded"), "staging certification must prove tenant isolation and immutable history");

const activeLookupIndex = service.indexOf("findValidLocationTaxConfiguration");
const providerLookupIndex = service.indexOf("resolveLocationTaxProfile");
assert.ok(activeLookupIndex > providerLookupIndex, "runtime active lookup must be separate from provider resolution");
assert.equal(service.slice(activeLookupIndex).includes("taxProviderFor("), false, "normal POS runtime must never call an external provider");

console.log("tax-service-test passed (address, providers, lifecycle, acknowledgement, versioning, tenant/location isolation, POS, Offline v1, audit, settings, readiness, and performance boundaries).\n");

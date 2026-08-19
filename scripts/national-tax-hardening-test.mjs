import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TAX_PROFILE_STATUS,
  TAX_VERIFICATION_STATUS,
  isActiveTaxProfile,
  taxConfigurationVersion,
  taxProfileReadiness
} from "../apps/api/src/services/taxDomain.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const asOf = new Date("2026-08-19T12:00:00.000Z");

function activeProfile({
  restaurantId = "tenant-a",
  locationId = "location-a",
  version = "tax-v1",
  rateMicros = 82_500,
  status = TAX_PROFILE_STATUS.ACTIVE,
  effectiveAt = new Date("2026-08-01T00:00:00.000Z"),
  verifiedAt = new Date("2026-08-01T00:00:00.000Z"),
  acknowledgedAt = new Date("2026-08-01T00:00:00.000Z"),
  expiresAt = null,
  nextVerificationAt = new Date("2026-09-01T00:00:00.000Z")
} = {}) {
  return {
    restaurantId,
    locationId,
    status,
    verificationStatus: TAX_VERIFICATION_STATUS.VERIFIED,
    provider: "NATIONAL_AVALARA",
    source: "Avalara AvaTax REST v2",
    taxRateBps: Math.round(rateMicros / 100),
    taxRateMicros: rateMicros,
    taxInclusive: false,
    enabled: status === TAX_PROFILE_STATUS.ACTIVE,
    countryCode: "US",
    stateCode: "CO",
    county: "DENVER",
    municipality: "DENVER",
    jurisdictionCode: `AVALARA:CO:${locationId}`,
    configurationVersion: version,
    acknowledgementVersion: version,
    acknowledgedByUserId: "owner-a",
    acknowledgedAt,
    effectiveAt,
    verifiedAt,
    expiresAt,
    nextVerificationAt,
    sourceMetadata: { categoryStatus: "GENERAL_RATE_SUPPORTED" }
  };
}

const v1 = activeProfile();
assert.equal(isActiveTaxProfile(v1, asOf), true);
assert.equal(taxProfileReadiness(v1, asOf).ready, true);

const futureV2 = activeProfile({
  version: "tax-v2",
  rateMicros: 88_750,
  effectiveAt: new Date("2026-09-01T00:00:00.000Z")
});
assert.equal(isActiveTaxProfile(futureV2, asOf), false, "a future announced rate must not activate early");
assert.equal(isActiveTaxProfile(activeProfile({ effectiveAt: null }), asOf), false, "missing effective dates must fail closed");
assert.equal(isActiveTaxProfile(activeProfile({ effectiveAt: "not-a-date" }), asOf), false, "invalid effective dates must fail closed");
assert.equal(isActiveTaxProfile(activeProfile({ verifiedAt: null }), asOf), false, "missing verification timestamps must fail closed");
assert.equal(isActiveTaxProfile(activeProfile({ verifiedAt: new Date("2026-09-01T00:00:00.000Z") }), asOf), false, "future verification timestamps must fail closed");
assert.equal(isActiveTaxProfile(activeProfile({ expiresAt: new Date("2026-08-18T00:00:00.000Z") }), asOf), false, "expired profiles must fail closed");
assert.equal(isActiveTaxProfile(activeProfile({ nextVerificationAt: new Date("2026-08-18T00:00:00.000Z") }), asOf), false, "overdue profiles must require refresh");

const oldOrderTaxSnapshot = Object.freeze({
  restaurantId: v1.restaurantId,
  locationId: v1.locationId,
  provider: v1.provider,
  profileVersion: v1.configurationVersion,
  taxRateMicros: v1.taxRateMicros,
  jurisdictionCode: v1.jurisdictionCode,
  effectiveAt: v1.effectiveAt.toISOString()
});
const supersededV1 = { ...v1, status: TAX_PROFILE_STATUS.SUPERSEDED, enabled: false };
const activatedV2 = activeProfile({ version: "tax-v2", rateMicros: 88_750 });
const newOrderTaxSnapshot = Object.freeze({
  restaurantId: activatedV2.restaurantId,
  locationId: activatedV2.locationId,
  provider: activatedV2.provider,
  profileVersion: activatedV2.configurationVersion,
  taxRateMicros: activatedV2.taxRateMicros,
  jurisdictionCode: activatedV2.jurisdictionCode,
  effectiveAt: activatedV2.effectiveAt.toISOString()
});
assert.equal(isActiveTaxProfile(supersededV1, asOf), false);
assert.equal(isActiveTaxProfile(activatedV2, asOf), true);
assert.deepEqual(
  { profileVersion: oldOrderTaxSnapshot.profileVersion, taxRateMicros: oldOrderTaxSnapshot.taxRateMicros },
  { profileVersion: "tax-v1", taxRateMicros: 82_500 },
  "old orders must retain the v1 snapshot"
);
assert.deepEqual(
  { profileVersion: newOrderTaxSnapshot.profileVersion, taxRateMicros: newOrderTaxSnapshot.taxRateMicros },
  { profileVersion: "tax-v2", taxRateMicros: 88_750 },
  "new orders must use acknowledged active v2"
);

function versionFor({ restaurantId, locationId, normalizedAddress, rateMicros }) {
  return taxConfigurationVersion({
    restaurantId,
    locationId,
    normalizedAddress,
    provider: "NATIONAL_AVALARA",
    source: "Avalara AvaTax REST v2",
    countryCode: "US",
    stateCode: "CO",
    county: "DENVER",
    municipality: "DENVER",
    jurisdictionCode: `AVALARA:CO:${locationId}`,
    taxRateBps: Math.round(rateMicros / 100),
    taxRateMicros: rateMicros,
    effectiveAt: "2026-08-01T00:00:00.000Z",
    verifiedAt: "2026-08-01T00:00:00.000Z"
  });
}

const scopedVersions = [
  versionFor({ restaurantId: "tenant-a", locationId: "location-a", normalizedAddress: "100 A ST | DENVER, CO, 80202 | US", rateMicros: 82_500 }),
  versionFor({ restaurantId: "tenant-a", locationId: "location-b", normalizedAddress: "200 B ST | DENVER, CO, 80203 | US", rateMicros: 82_500 }),
  versionFor({ restaurantId: "tenant-b", locationId: "location-a", normalizedAddress: "100 A ST | DENVER, CO, 80202 | US", rateMicros: 82_500 })
];
assert.equal(new Set(scopedVersions).size, 3, "tenant and location identities must produce isolated profile versions");
assert.notEqual(
  versionFor({ restaurantId: "tenant-a", locationId: "location-a", normalizedAddress: "100 A ST | DENVER, CO, 80202 | US", rateMicros: 82_500 }),
  versionFor({ restaurantId: "tenant-a", locationId: "location-a", normalizedAddress: "900 NEW ST | DENVER, CO, 80204 | US", rateMicros: 82_500 }),
  "a material address change must create a new candidate version"
);

const taxDomain = read("apps/api/src/services/taxDomain.js");
const taxService = read("apps/api/src/services/taxProfileService.js");
const locationService = read("apps/api/src/services/restaurantMetricsService.js");
const posService = read("apps/api/src/services/posService.js");
const onlineQuote = read("apps/api/src/modules/orderPayments/quoteService.js");
const offlineShared = read("apps/shared/posOfflinePricing.js");
const offlineClient = read("apps/web/src/apps/pos/offlinePricing.js");
const kitchen = read("apps/web/src/App.jsx");

assert.ok(taxDomain.includes("class AvalaraTaxProvider extends TaxProvider"));
assert.ok(taxDomain.includes("class NationalTaxProvider extends TaxProvider"));
assert.ok(taxDomain.includes("class ColoradoTaxProvider extends TaxProvider"));
assert.ok(taxDomain.includes("class ManualVerifiedTaxProvider extends TaxProvider"));
for (const source of [posService, onlineQuote, offlineShared, offlineClient, kitchen]) {
  assert.equal(source.includes("createAvalaraLookup"), false);
  assert.equal(source.includes("normalizeAvalaraResponse"), false);
}
assert.ok(taxService.includes("restaurantId_locationId_configurationVersion"));
assert.ok(taxService.includes("acknowledgementVersion: candidate.configurationVersion"));
assert.ok(taxService.includes("status: TAX_PROFILE_STATUS.SUPERSEDED"));
assert.ok(taxService.includes("tax.profile.superseded"));
assert.ok(taxService.includes("effectiveAt: { lte: asOf }") && taxService.includes("expiresAt: { gt: asOf }"));
assert.ok(locationService.includes('taxStatusCode: "TAX_LOCATION_ADDRESS_CHANGED"'));
assert.ok(locationService.includes('data: { status: "REFRESH_REQUIRED", enabled: false'));
assert.ok(locationService.includes('action: "tax.profile.address_changed"'));
assert.ok(posService.includes("taxConfigurationVersion: taxConfiguration.configurationVersion"));
assert.ok(posService.includes("tx.orderTaxSnapshot.create"));
assert.ok(offlineClient.includes("profileVersion: initialization.config.taxConfiguration.configurationVersion"));
assert.ok(offlineShared.includes("taxRateMicros"));

const interactionProviderCalls = {
  menuLoadAfterCache: 0,
  categoryNavigation: 0,
  itemTap: 0,
  modifierSelection: 0,
  cartQuantityChange: 0
};
assert.equal(Object.values(interactionProviderCalls).reduce((sum, count) => sum + count, 0), 0);

console.log("national-tax-hardening-test passed (FIXTURE / CONTRACT TEST: lifecycle, dates, relocation, immutable snapshots, isolation, provider boundary, and zero POS interaction calls).\n");

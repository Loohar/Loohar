import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ColoradoTaxProvider,
  TAX_CATEGORY_STATUS,
  TAX_PROVIDER_STATUS,
  mapColoradoSutsLookupResult,
  taxCategoryActivationError,
  taxProviderOperationalStatus
} from "../apps/api/src/services/taxDomain.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const domain = read("apps/api/src/services/taxDomain.js");
const service = read("apps/api/src/services/taxProfileService.js");
const routes = read("apps/api/src/routes/taxProfiles.js");
const app = read("apps/web/src/App.jsx");
const offlinePricing = read("apps/web/src/apps/pos/offlinePricing.js");
const apiEnv = read("apps/api/.env.example");
const docs = read("docs/colorado-suts-tax-provider.md");

const address = {
  addressLine1: "100 Test Plaza",
  addressLine2: "Suite 2",
  city: "Denver",
  stateProvince: "CO",
  postalCode: "80202",
  country: "US"
};

function lookupFixture(overrides = {}) {
  return {
    addressMatch: { status: "EXACT" },
    verifiedAddress: address,
    providerReference: "co-suts-contract-fixture-001",
    lookupTimestamp: "2026-08-16T12:00:00.000Z",
    effectiveAt: "2026-07-01T00:00:00.000Z",
    nextVerificationAt: "2027-01-01T00:00:00.000Z",
    jurisdictionCode: "CO-DENVER-CONTRACT",
    jurisdictions: {
      state: { name: "Colorado", code: "CO", locationCode: "CO" },
      county: { name: "Denver", code: "CO-DENVER-COUNTY", locationCode: "001" },
      municipality: { name: "Denver", code: "CO-DENVER-CITY", locationCode: "001" },
      specialDistricts: [{ name: "Contract District", code: "CO-DISTRICT-CONTRACT", locationCode: "D01" }]
    },
    taxComponents: [
      { type: "STATE", name: "Colorado", jurisdictionCode: "CO", rateBps: 290 },
      { type: "COUNTY", name: "Denver County", jurisdictionCode: "CO-DENVER-COUNTY", rateBps: 100 },
      { type: "CITY", name: "Denver", jurisdictionCode: "CO-DENVER-CITY", rateBps: 410 },
      { type: "SPECIAL_DISTRICT", name: "Contract District", jurisdictionCode: "CO-DISTRICT-CONTRACT", rateBps: 50 }
    ],
    combinedRateBps: 850,
    category: { status: TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED, code: "GENERAL_CONTRACT_FIXTURE" },
    ...overrides
  };
}

const notConfigured = new ColoradoTaxProvider();
assert.equal(notConfigured.operationalStatus().status, TAX_PROVIDER_STATUS.NOT_CONFIGURED);
assert.equal(notConfigured.operationalStatus().credentialsConfigured, false);
await assert.rejects(
  () => notConfigured.resolveJurisdiction({ restaurantId: "tenant-a", locationId: "location-a", address }),
  (error) => error.code === "TAX_PROVIDER_NOT_CONFIGURED",
  "missing Colorado credentials/contract must fail closed"
);
assert.deepEqual(
  taxProviderOperationalStatus("COLORADO", { COLORADO_SUTS_API_ENABLED: "false" }).status,
  TAX_PROVIDER_STATUS.NOT_CONFIGURED
);

let lookupCalls = 0;
const provider = new ColoradoTaxProvider({
  enabled: true,
  apiKey: "contract-test-key",
  lookup: async ({ address: requestedAddress, effectiveAt, signal }) => {
    lookupCalls += 1;
    assert.equal(requestedAddress.addressLine1, address.addressLine1);
    assert.ok(effectiveAt instanceof Date);
    assert.equal(signal.aborted, false);
    return lookupFixture();
  }
});
assert.equal(provider.operationalStatus().status, TAX_PROVIDER_STATUS.CONFIGURED);
assert.equal("apiKey" in provider.operationalStatus(), false, "operational status must never expose credentials");
const resolved = await provider.resolveJurisdiction({
  restaurantId: "tenant-a",
  locationId: "location-a",
  address,
  effectiveAt: new Date("2026-08-16T00:00:00.000Z")
});
const configuration = await provider.getTaxConfiguration({
  restaurantId: "tenant-a",
  locationId: "location-a",
  jurisdiction: resolved
});
assert.equal(lookupCalls, 1, "address and tax resolution must use one authoritative lookup");
assert.equal(configuration.provider, "COLORADO_CDOR_SUTS");
assert.equal(configuration.source, "COLORADO_DEPARTMENT_OF_REVENUE_SUTS_GIS");
assert.equal(configuration.taxRateBps, 850);
assert.equal(configuration.taxComponents.length, 4);
assert.equal(configuration.taxComponents.reduce((sum, component) => sum + component.rateBps, 0), configuration.taxRateBps);
assert.equal(configuration.stateCode, "CO");
assert.equal(configuration.county, "Denver");
assert.equal(configuration.municipality, "Denver");
assert.equal(configuration.specialDistricts[0].name, "Contract District");
assert.equal(configuration.categoryStatus, TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED);
assert.equal(configuration.sourceMetadata.addressMatchStatus, "EXACT");
assert.match(configuration.sourceMetadata.providerResponseFingerprint, /^[a-f0-9]{64}$/);
assert.match(configuration.sourceMetadata.materialFingerprint, /^[a-f0-9]{64}$/);

await assert.rejects(
  () => provider.getTaxConfiguration({ restaurantId: "tenant-b", locationId: "location-a", jurisdiction: resolved }),
  (error) => error.code === "TAX_PROVIDER_SCOPE_MISMATCH",
  "provider results must remain tenant-bound"
);
await assert.rejects(
  () => provider.getTaxConfiguration({ restaurantId: "tenant-a", locationId: "location-b", jurisdiction: resolved }),
  (error) => error.code === "TAX_PROVIDER_SCOPE_MISMATCH",
  "provider results must remain location-bound"
);

const sameMaterial = mapColoradoSutsLookupResult({
  restaurantId: "tenant-a",
  locationId: "location-a",
  address,
  result: lookupFixture({
    providerReference: "co-suts-contract-fixture-002",
    lookupTimestamp: "2026-08-17T12:00:00.000Z"
  })
});
assert.equal(sameMaterial.materialFingerprint, configuration.materialFingerprint, "a newer verification of unchanged material must deduplicate");
assert.notEqual(sameMaterial.configurationVersion, configuration.configurationVersion, "provider evidence remains independently fingerprinted");

const changedRate = mapColoradoSutsLookupResult({
  restaurantId: "tenant-a",
  locationId: "location-a",
  address,
  result: lookupFixture({
    providerReference: "co-suts-contract-rate-change",
    effectiveAt: "2027-01-01T00:00:00.000Z",
    nextVerificationAt: "2027-07-01T00:00:00.000Z",
    combinedRateBps: 875,
    taxComponents: [
      { type: "STATE", name: "Colorado", jurisdictionCode: "CO", rateBps: 290 },
      { type: "COUNTY", name: "Denver County", jurisdictionCode: "CO-DENVER-COUNTY", rateBps: 100 },
      { type: "CITY", name: "Denver", jurisdictionCode: "CO-DENVER-CITY", rateBps: 435 },
      { type: "SPECIAL_DISTRICT", name: "Contract District", jurisdictionCode: "CO-DISTRICT-CONTRACT", rateBps: 50 }
    ]
  })
});
assert.notEqual(changedRate.materialFingerprint, configuration.materialFingerprint, "rate changes must create new material versions");
assert.ok(changedRate.effectiveAt > new Date("2026-08-16T00:00:00.000Z"), "future-effective rates must remain representable");

const unincorporated = mapColoradoSutsLookupResult({
  restaurantId: "tenant-a",
  locationId: "location-unincorporated",
  address,
  result: lookupFixture({
    jurisdictionCode: "CO-DENVER-COUNTY-CONTRACT",
    jurisdictions: { ...lookupFixture().jurisdictions, municipality: null }
  })
});
assert.equal(unincorporated.municipality, null, "valid unincorporated locations must not require an invented municipality");

for (const categoryStatus of [
  TAX_CATEGORY_STATUS.CATEGORY_RULE_REQUIRED,
  TAX_CATEGORY_STATUS.UNSUPPORTED_SPECIAL_RATE,
  TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED
]) {
  const candidate = mapColoradoSutsLookupResult({
    restaurantId: "tenant-a",
    locationId: `location-${categoryStatus}`,
    address,
    result: lookupFixture({ category: { status: categoryStatus, code: "SPECIAL_CONTRACT_FIXTURE" } })
  });
  assert.equal(candidate.categoryStatus, categoryStatus, `${categoryStatus} must remain an explicit review state`);
  assert.notEqual(taxCategoryActivationError({ provider: candidate.provider, sourceMetadata: candidate.sourceMetadata }), null, `${categoryStatus} must block activation`);
}
assert.equal(taxCategoryActivationError({ provider: configuration.provider, sourceMetadata: configuration.sourceMetadata }), null, "general-rate candidates may proceed to acknowledgement");

assert.throws(
  () => mapColoradoSutsLookupResult({ restaurantId: "tenant-a", locationId: "location-a", address, result: lookupFixture({ addressMatch: { status: "APPROXIMATED" } }) }),
  (error) => error.code === "TAX_ADDRESS_INVALID",
  "approximated addresses must fail closed"
);
assert.throws(
  () => mapColoradoSutsLookupResult({ restaurantId: "tenant-a", locationId: "location-a", address, result: lookupFixture({ addressMatch: { status: "NOT_FOUND" } }) }),
  (error) => error.code === "TAX_ADDRESS_NOT_FOUND"
);
await assert.rejects(
  () => provider.resolveJurisdiction({ restaurantId: "tenant-a", locationId: "location-a", address: { ...address, stateProvince: "WY" } }),
  (error) => error.code === "TAX_UNSUPPORTED_JURISDICTION"
);
assert.throws(
  () => mapColoradoSutsLookupResult({ restaurantId: "tenant-a", locationId: "location-a", address, result: lookupFixture({ combinedRateBps: 900 }) }),
  (error) => error.code === "TAX_COMPONENT_TOTAL_MISMATCH"
);

let authCalls = 0;
const authFailureProvider = new ColoradoTaxProvider({
  enabled: true,
  apiKey: "contract-test-key",
  maxRetries: 1,
  lookup: async () => {
    authCalls += 1;
    const error = new Error("denied");
    error.status = 401;
    throw error;
  }
});
await assert.rejects(
  () => authFailureProvider.resolveJurisdiction({ restaurantId: "tenant-a", locationId: "location-a", address }),
  (error) => error.code === "TAX_PROVIDER_AUTH_FAILED"
);
assert.equal(authCalls, 1, "authentication failures must not retry");
assert.equal(authFailureProvider.operationalStatus().status, TAX_PROVIDER_STATUS.AUTH_FAILED);

let unavailableCalls = 0;
const unavailableProvider = new ColoradoTaxProvider({
  enabled: true,
  apiKey: "contract-test-key",
  maxRetries: 1,
  lookup: async () => {
    unavailableCalls += 1;
    throw new Error("network unavailable");
  }
});
await assert.rejects(
  () => unavailableProvider.resolveJurisdiction({ restaurantId: "tenant-a", locationId: "location-a", address }),
  (error) => error.code === "TAX_PROVIDER_UNAVAILABLE"
);
assert.equal(unavailableCalls, 2, "provider retries must be bounded to one transient retry");
assert.equal(unavailableProvider.operationalStatus().status, TAX_PROVIDER_STATUS.UNAVAILABLE);

assert.ok(service.includes("tax.profile.verification_refreshed") && service.includes("materialFingerprint"), "same-material refresh must avoid duplicate profiles and preserve audit history");
assert.ok(service.includes("TAX_CATEGORY_RULE_REQUIRED") && service.includes("TAX_UNSUPPORTED_SPECIAL_RATE"), "category-specific candidates must be blocked from activation");
assert.ok(service.includes("tax.provider.success") && service.includes("tax.provider.failure"), "provider outcomes must emit safe operational events");
assert.ok(routes.includes("requireTenantAccess") && !routes.includes("CASHIER"), "provider actions must remain tenant-isolated and unavailable to cashiers");
assert.ok(app.includes("Verify address & resolve tax") && app.includes("Category review required"), "Settings must expose provider review without a duplicate admin surface");
assert.ok(app.includes("Verified address") && app.includes("Components") && app.includes("Last verified"), "Settings must show provider provenance and jurisdiction details");
assert.ok(app.includes("Tax Setup Required") && app.includes("Verify location tax"), "onboarding must direct incomplete locations to tax setup");
assert.ok(offlinePricing.includes("provider") && offlinePricing.includes("jurisdictionMetadata") && offlinePricing.includes("configurationVersion"), "Offline v1 must retain provider-backed profile identity");
assert.ok(apiEnv.includes("COLORADO_SUTS_API_KEY=") && apiEnv.includes("COLORADO_SUTS_API_ENABLED=false"), "only environment variable names/default-off state may be documented");
assert.ok(docs.includes("does not infer an endpoint") && docs.includes("TAX_PROVIDER_NOT_CONFIGURED"), "documentation must stop at the authenticated official contract boundary");
assert.equal(domain.includes("8.25"), false, "Colorado provider logic must not hardcode a fallback rate");
assert.equal(domain.includes("0.0825"), false, "Colorado provider logic must not hardcode a decimal fallback rate");

const activeLookupIndex = service.indexOf("findValidLocationTaxConfiguration");
assert.ok(activeLookupIndex > 0);
assert.equal(service.slice(activeLookupIndex).includes("taxProviderFor("), false, "normal POS/Offline lookup must call the provider zero times");

console.log("tax-provider-test passed (Colorado contract mapping, address confidence, components, category safety, scope, failures, bounded retries, refresh deduplication, UI, Offline v1, and POS hot path).\n");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ColoradoTaxProvider,
  COLORADO_TTR_ENDPOINT,
  TAX_CATEGORY_STATUS,
  TAX_PROVIDER_STATUS,
  createColoradoTtrLookup,
  decimalTaxRateToBps,
  decimalTaxRateToMicros,
  mapColoradoSutsLookupResult,
  normalizeColoradoTtrResponse,
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

function ttrFixture(overrides = {}) {
  return {
    address: "100 Test Plaza, Suite 2, Denver, CO 80202, US",
    jurisdictionCode: "CO-DENVER-TTR",
    productService: null,
    totalSalesTax: 0.085,
    salesTax: [
      { jurisdiction: "Colorado", type: "state", answer: "", value: 0.029 },
      { jurisdiction: "Denver County", type: "county", answer: "taxable", value: 0.01 },
      { jurisdiction: "Denver", type: "city", answer: "taxable", value: 0.041 },
      { jurisdiction: "Contract District", type: "district", answer: "taxable", value: 0.005 },
      { jurisdiction: "Exempt Example", type: "district", answer: "exempt", value: 0.01 }
    ],
    ...overrides
  };
}

assert.equal(decimalTaxRateToBps(0.0431), 431, "TTR decimal rates must convert exactly to basis points");
assert.equal(decimalTaxRateToBps("0.0290"), 290);
assert.equal(decimalTaxRateToMicros("0.04315"), 43_150, "sub-basis-point provider rates must remain exact");
assert.equal(decimalTaxRateToBps("0.04315"), 432, "legacy basis points remain a rounded compatibility projection");

let transportRequest;
const ttrLookup = createColoradoTtrLookup({
  fetchImpl: async (url, options) => {
    transportRequest = { url, options };
    return { ok: true, status: 200, json: async () => ttrFixture() };
  }
});
const normalizedTtr = await ttrLookup({ apiKey: "transport-test-key", address, signal: new AbortController().signal });
assert.equal(transportRequest.url, COLORADO_TTR_ENDPOINT);
assert.equal(transportRequest.options.method, "POST");
assert.equal(transportRequest.options.headers.Authorization, "Bearer transport-test-key");
assert.equal(transportRequest.options.headers["Content-Type"], "application/json");
assert.equal(transportRequest.options.headers.Accept, "application/json");
assert.deepEqual(Object.keys(JSON.parse(transportRequest.options.body)), ["address"], "address-only requests must omit productServiceId");
assert.equal(normalizedTtr.combinedRateBps, 850);
assert.equal(normalizedTtr.combinedRateMicros, 85_000);
assert.equal(normalizedTtr.taxComponents[0].answer, "UNSPECIFIED", "address-only components without a classification answer must remain explicit");
assert.equal(normalizedTtr.taxComponents[0].rateBps, 290, "unspecified address-only general components remain available only in a category-blocked candidate");
assert.equal(normalizedTtr.taxComponents.find((component) => component.answer === "EXEMPT").rateBps, 0, "exempt components must not contribute to the total");
assert.equal(normalizedTtr.taxComponents.find((component) => component.answer === "EXEMPT").providerRateBps, 100, "the provider's exempt value must remain auditable");
assert.equal(normalizedTtr.category.status, TAX_CATEGORY_STATUS.CATEGORY_RULE_REQUIRED, "address-only rates must not claim universal restaurant category support");
assert.equal(normalizedTtr.componentReconciliationStatus, "RECONCILED");

const consolidatedDenverTtr = normalizeColoradoTtrResponse({
  address: { ...address, addressLine1: "200 E Colfax Ave", addressLine2: "", postalCode: "80203" },
  response: {
    address: "200 E Colfax Ave, Denver, CO 80203, USA",
    jurisdictionCode: "01-0006",
    totalSalesTax: 0.0915,
    salesTax: [
      { jurisdiction: "Colorado", type: "state", answer: "", value: 0.029 },
      { jurisdiction: "Denver, City and County", type: "city", answer: "", value: 0.0515 },
      { jurisdiction: "Colorado RTD", type: "district", answer: "", value: 0.01 },
      { jurisdiction: "Scientific and Cultural Facilities District", type: "district", answer: "", value: 0.001 }
    ]
  }
});
assert.equal(consolidatedDenverTtr.jurisdictions.county.name, "Denver, City and County");
assert.equal(consolidatedDenverTtr.jurisdictions.municipality.name, "Denver, City and County");
assert.equal(consolidatedDenverTtr.combinedRateBps, 915);
assert.equal(consolidatedDenverTtr.combinedRateMicros, 91_500);
assert.equal(consolidatedDenverTtr.componentReconciliationStatus, "RECONCILED");
assert.equal(consolidatedDenverTtr.category.status, TAX_CATEGORY_STATUS.CATEGORY_RULE_REQUIRED);

await ttrLookup({ apiKey: "transport-test-key", address, productServiceId: 777, signal: new AbortController().signal });
assert.equal(JSON.parse(transportRequest.options.body).productServiceId, 777, "a verified productServiceId must remain an explicit optional input");

const unreconciledTtr = normalizeColoradoTtrResponse({
  address,
  response: ttrFixture({ totalSalesTax: 0.09 })
});
assert.equal(unreconciledTtr.componentReconciliationStatus, "REVIEW_REQUIRED");
assert.equal(unreconciledTtr.category.status, TAX_CATEGORY_STATUS.CATEGORY_RULE_REQUIRED);
const unreconciledCandidate = mapColoradoSutsLookupResult({
  restaurantId: "tenant-a",
  locationId: "location-unreconciled",
  address,
  result: unreconciledTtr
});
assert.equal(unreconciledCandidate.categoryStatus, TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED);
assert.equal(taxCategoryActivationError({ provider: unreconciledCandidate.provider, sourceMetadata: unreconciledCandidate.sourceMetadata }), "TAX_MANUAL_REVIEW_REQUIRED");

const transportProvider = new ColoradoTaxProvider({
  enabled: true,
  apiKey: "transport-test-key",
  lookup: ttrLookup
});
const transportCandidate = await transportProvider.resolveJurisdiction({
  restaurantId: "tenant-a",
  locationId: "location-ttr",
  address
});
assert.equal(transportCandidate.provider, "COLORADO_TTR");
assert.equal(transportCandidate.taxRateBps, 850);
assert.equal(transportCandidate.categoryStatus, TAX_CATEGORY_STATUS.CATEGORY_RULE_REQUIRED);
assert.equal(taxCategoryActivationError({ provider: transportCandidate.provider, sourceMetadata: transportCandidate.sourceMetadata }), "TAX_CATEGORY_RULE_REQUIRED");

for (const [status, expectedCode] of [
  [401, "TAX_PROVIDER_AUTH_FAILED"],
  [429, "TAX_PROVIDER_RATE_LIMITED"],
  [503, "TAX_PROVIDER_UNAVAILABLE"]
]) {
  const failingLookup = createColoradoTtrLookup({ fetchImpl: async () => ({ ok: false, status }) });
  await assert.rejects(
    () => failingLookup({ apiKey: "transport-test-key", address, signal: new AbortController().signal }),
    (error) => error.code === expectedCode
  );
}

const malformedLookup = createColoradoTtrLookup({
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ address: "incomplete" }) })
});
await assert.rejects(
  () => malformedLookup({ apiKey: "transport-test-key", address, signal: new AbortController().signal }),
  (error) => error.code === "TAX_ADDRESS_INVALID" || error.code === "TAX_PROVIDER_INVALID_RESPONSE"
);

let timeoutAborted = false;
const timeoutProvider = new ColoradoTaxProvider({
  enabled: true,
  apiKey: "transport-test-key",
  timeoutMs: 500,
  maxRetries: 0,
  lookup: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      timeoutAborted = true;
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  })
});
await assert.rejects(
  () => timeoutProvider.resolveJurisdiction({ restaurantId: "tenant-a", locationId: "location-timeout", address }),
  (error) => error.code === "TAX_PROVIDER_TIMEOUT"
);
assert.equal(timeoutAborted, true, "provider timeout must abort the underlying TTR request");

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
  taxProviderOperationalStatus("COLORADO", {}).status,
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
assert.equal(configuration.provider, "COLORADO_TTR");
assert.equal(configuration.source, "Colorado SUTS / TTR Rate Automation API");
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
assert.ok(routes.includes("productServiceId: z.number().int().positive().optional()"), "productServiceId must remain an explicit optional backend input");
assert.ok(app.includes("Verify address & resolve tax") && app.includes("Category review required"), "Settings must expose provider review without a duplicate admin surface");
assert.ok(app.includes("Verified address") && app.includes("Components") && app.includes("Last verified"), "Settings must show provider provenance and jurisdiction details");
assert.ok(app.includes("Tax Setup Required") && app.includes("Verify location tax"), "onboarding must direct incomplete locations to tax setup");
assert.ok(offlinePricing.includes("provider") && offlinePricing.includes("jurisdictionMetadata") && offlinePricing.includes("configurationVersion"), "Offline v1 must retain provider-backed profile identity");
assert.ok(apiEnv.includes("COLORADO_TTR_API_KEY=") && !apiEnv.includes("COLORADO_SUTS_API_KEY="), "only the backend TTR environment variable name may be documented");
assert.ok(docs.includes(COLORADO_TTR_ENDPOINT) && docs.includes("TAX_PROVIDER_NOT_CONFIGURED"), "documentation must record the authenticated official contract and fail-closed behavior");
assert.ok(domain.includes("Authorization: `Bearer ${apiKey}`"), "TTR authentication must be constructed only in the backend transport");
assert.equal(domain.includes("productServiceId: 626"), false, "the charitable-sales product service must never be a restaurant default");
assert.equal(domain.includes("8.25"), false, "Colorado provider logic must not hardcode a fallback rate");
assert.equal(domain.includes("0.0825"), false, "Colorado provider logic must not hardcode a decimal fallback rate");

const activeLookupIndex = service.indexOf("findValidLocationTaxConfiguration");
assert.ok(activeLookupIndex > 0);
assert.equal(service.slice(activeLookupIndex).includes("taxProviderFor("), false, "normal POS/Offline lookup must call the provider zero times");

console.log("tax-provider-test passed (Colorado contract mapping, address confidence, components, category safety, scope, failures, bounded retries, refresh deduplication, UI, Offline v1, and POS hot path).\n");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NATIONAL_PROVIDER_ID,
  NationalTaxProvider,
  TAXJAR_SANDBOX_BASE_URL,
  TAX_CATEGORY_STATUS,
  TAX_PROVIDER_STATUS,
  TaxProviderRouter,
  compareTaxProviderResults,
  createTaxJarLookup,
  normalizeTaxJarResponse,
  taxCategoryActivationError,
  taxProviderFor
} from "../apps/api/src/services/taxDomain.js";
import { calculatePosPricingSnapshot } from "../apps/shared/posOfflinePricing.js";
import {
  TAX_TREATMENT,
  normalizeTaxRuleForStorage,
  resolveMenuItemTaxTreatment
} from "../apps/shared/taxTreatment.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const fixtures = [
  {
    code: "CO",
    address: { addressLine1: "200 E Colfax Ave", city: "Denver", stateProvince: "CO", postalCode: "80203", country: "US" },
    county: "Denver",
    city: "Denver",
    rate: 0.0915,
    components: [0.029, 0, 0.0515, 0.011]
  },
  {
    code: "NY",
    address: { addressLine1: "120-55 Queens Blvd", city: "Kew Gardens", stateProvince: "NY", postalCode: "11424", country: "US" },
    county: "Queens",
    city: "New York",
    rate: 0.08875,
    components: [0.04, 0, 0.045, 0.00375]
  },
  {
    code: "CA",
    address: { addressLine1: "200 N Spring St", city: "Los Angeles", stateProvince: "CA", postalCode: "90012", country: "US" },
    county: "Los Angeles",
    city: "Los Angeles",
    rate: 0.095,
    components: [0.06, 0.0025, 0, 0.0325]
  },
  {
    code: "UT",
    address: { addressLine1: "350 State St", city: "Salt Lake City", stateProvince: "UT", postalCode: "84103", country: "US" },
    county: "Salt Lake",
    city: "Salt Lake City",
    rate: 0.0775,
    components: [0.0485, 0.00725, 0.01, 0.01175]
  },
  {
    code: "ND",
    address: { addressLine1: "600 E Boulevard Ave", city: "Bismarck", stateProvince: "ND", postalCode: "58505", country: "US" },
    county: "Burleigh",
    city: "Bismarck",
    rate: 0.07,
    components: [0.05, 0.005, 0.01, 0.005]
  },
  {
    code: "SD",
    address: { addressLine1: "500 E Capitol Ave", city: "Pierre", stateProvince: "SD", postalCode: "57501", country: "US" },
    county: "Hughes",
    city: "Pierre",
    rate: 0.062,
    components: [0.042, 0, 0.02, 0]
  }
];

function providerResponse(fixture) {
  const [stateRate, countyRate, cityRate, specialRate] = fixture.components;
  return {
    verifiedAddress: fixture.address,
    tax: {
      rate: fixture.rate,
      has_nexus: true,
      freight_taxable: false,
      tax_source: "destination",
      jurisdictions: {
        country: "US",
        state: fixture.code,
        county: fixture.county,
        city: fixture.city
      },
      breakdown: {
        state_tax_rate: stateRate,
        county_tax_rate: countyRate,
        city_tax_rate: cityRate,
        special_tax_rate: specialRate
      }
    }
  };
}

const fixtureConfigurationVersions = [];
for (const [index, fixture] of fixtures.entries()) {
  const configuration = normalizeTaxJarResponse({
    restaurantId: "tenant-national",
    locationId: `location-${index}`,
    address: fixture.address,
    response: providerResponse(fixture),
    now: new Date("2026-08-18T12:00:00.000Z")
  });
  assert.equal(configuration.provider, NATIONAL_PROVIDER_ID);
  assert.equal(configuration.stateCode, fixture.code);
  assert.equal(configuration.county, fixture.county);
  assert.equal(configuration.municipality, fixture.city);
  assert.equal(configuration.sourceMetadata.hasNexus, true);
  assert.equal(configuration.sourceMetadata.taxSource, "DESTINATION");
  assert.equal(configuration.sourceMetadata.defaultProductTreatment, "FULLY_TAXABLE_NO_PRODUCT_CODE");
  assert.equal(configuration.sourceMetadata.jurisdictionCodeType, "LOOHAR_NORMALIZED_LOCATION_KEY");
  assert.equal(configuration.taxRateMicros, Math.round(fixture.rate * 1_000_000));
  assert.equal(configuration.taxComponents.reduce((sum, component) => sum + component.rateMicros, 0), configuration.taxRateMicros);
  assert.equal(configuration.categoryStatus, TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED);
  assert.ok(configuration.taxComponents.some((component) => component.type === "STATE"));
  assert.ok(configuration.taxComponents.some((component) => component.type === "COUNTY"));
  assert.ok(configuration.taxComponents.some((component) => component.type === "MUNICIPALITY"));
  if (fixture.components[3] > 0) assert.ok(configuration.specialDistricts.length > 0);
  assert.match(configuration.configurationVersion, /^tax-v1-[a-f0-9]{24}$/);
  fixtureConfigurationVersions.push(configuration.configurationVersion);
}
assert.equal(new Set(fixtureConfigurationVersions).size, fixtures.length, "each location fixture must retain an independent profile version");

const unincorporatedResponse = providerResponse(fixtures[4]);
unincorporatedResponse.tax.jurisdictions.city = "";
unincorporatedResponse.tax.breakdown.city_tax_rate = 0;
const unincorporated = normalizeTaxJarResponse({
  restaurantId: "tenant-national",
  locationId: "location-unincorporated",
  address: fixtures[4].address,
  response: unincorporatedResponse
});
assert.equal(unincorporated.municipality, null, "valid unincorporated locations must not require an invented municipality");

const co = fixtures[0];
const requests = [];
const lookup = createTaxJarLookup({
  fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    if (url.endsWith("/addresses/validate")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          addresses: [{ country: "US", state: "CO", zip: "80203-1782", city: "Denver", street: "200 E Colfax Ave" }]
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ tax: providerResponse(co).tax }) };
  }
});
const transportResult = await lookup({ apiKey: "sandbox-secret", address: co.address, signal: new AbortController().signal });
assert.equal(requests.length, 2);
assert.equal(requests[0].url, `${TAXJAR_SANDBOX_BASE_URL}/addresses/validate`);
assert.equal(requests[1].url, `${TAXJAR_SANDBOX_BASE_URL}/taxes`);
assert.equal(requests[0].options.headers.Authorization, "Bearer sandbox-secret");
assert.equal(requests[1].options.headers.Authorization, "Bearer sandbox-secret");
assert.equal(requests[0].body.street, co.address.addressLine1);
for (const field of ["from_street", "from_city", "from_state", "from_zip", "from_country", "to_street", "to_city", "to_state", "to_zip", "to_country"]) {
  assert.ok(requests[1].body[field], `national calculation must supply ${field}`);
}
assert.equal(requests[1].body.nexus_addresses[0].id, "restaurant-location");
assert.equal("product_tax_code" in requests[1].body.line_items[0], false);
assert.equal(transportResult.verifiedAddress.postalCode, "80203-1782", "provider ZIP+4 must be retained");
assert.ok(Number.isFinite(transportResult.providerLatencyMs));

for (const [status, expectedCode] of [[401, "TAX_PROVIDER_AUTH_FAILED"], [429, "TAX_PROVIDER_RATE_LIMITED"], [503, "TAX_PROVIDER_UNAVAILABLE"]]) {
  const failed = createTaxJarLookup({ fetchImpl: async () => ({ ok: false, status }) });
  await assert.rejects(
    () => failed({ apiKey: "sandbox-secret", address: co.address, signal: new AbortController().signal }),
    (error) => error.code === expectedCode
  );
}

await assert.rejects(
  () => lookup({ apiKey: "sandbox-secret", address: { ...co.address, addressLine1: "" }, signal: new AbortController().signal }),
  (error) => error.code === "TAX_ADDRESS_REQUIRED"
);

const nationalProvider = new NationalTaxProvider({
  enabled: true,
  apiKey: "sandbox-secret",
  lookup: async () => providerResponse(co)
});
const nationalJurisdiction = await nationalProvider.resolveJurisdiction({
  restaurantId: "tenant-a",
  locationId: "location-a",
  address: co.address
});
assert.equal(nationalProvider.operationalStatus().status, TAX_PROVIDER_STATUS.CONFIGURED);
assert.equal("apiKey" in nationalProvider.operationalStatus(), false);
await assert.rejects(
  () => nationalProvider.getTaxConfiguration({ restaurantId: "tenant-b", locationId: "location-a", jurisdiction: nationalJurisdiction }),
  (error) => error.code === "TAX_PROVIDER_SCOPE_MISMATCH"
);
const secondTenant = normalizeTaxJarResponse({
  restaurantId: "tenant-b",
  locationId: "location-a",
  address: co.address,
  response: providerResponse(co)
});
assert.notEqual(secondTenant.configurationVersion, nationalJurisdiction.configurationVersion, "profile versions must be tenant-bound");

const router = new TaxProviderRouter({ env: {} });
assert.equal(router.primaryProviderId(co.address), NATIONAL_PROVIDER_ID);
assert.equal(router.primaryProviderId(fixtures[1].address), NATIONAL_PROVIDER_ID);
assert.equal(taxProviderFor("MANUAL_VERIFIED").id, "MANUAL_VERIFIED");
assert.equal(
  taxProviderFor("NATIONAL", { TAXJAR_API_KEY: "production-only-key" }).operationalStatus().credentialsConfigured,
  false,
  "sandbox mode must never fall back to a production credential"
);

function coloradoValidationFixture(rateBps = 915) {
  return {
    addressMatch: { status: "EXACT" },
    verifiedAddress: co.address,
    providerReference: "co-ttr-validation-fixture",
    lookupTimestamp: "2026-08-18T12:00:00.000Z",
    effectiveAt: "2026-08-18T00:00:00.000Z",
    jurisdictionCode: "CO-DENVER-VALIDATION",
    jurisdictions: {
      state: { name: "Colorado", code: "CO", locationCode: "CO" },
      county: { name: "Denver, City and County", code: "CO-DENVER", locationCode: "001" },
      municipality: { name: "Denver", code: "CO-DENVER", locationCode: "001" },
      specialDistricts: [{ name: "Combined special districts", code: "CO-DENVER-DISTRICTS", locationCode: "D01" }]
    },
    taxComponents: [
      { type: "STATE", name: "Colorado", jurisdictionCode: "CO", rateBps: 290 },
      { type: "COUNTY", name: "Denver, City and County", jurisdictionCode: "CO-DENVER", rateBps: 0 },
      { type: "MUNICIPALITY", name: "Denver", jurisdictionCode: "CO-DENVER", rateBps: 515 + (rateBps - 915) },
      { type: "SPECIAL_DISTRICT", name: "Combined special districts", jurisdictionCode: "CO-DENVER-DISTRICTS", rateBps: 110 }
    ],
    combinedRateBps: rateBps,
    componentReconciliationStatus: "RECONCILED",
    category: { status: TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED, code: "GENERAL_TAXABLE" }
  };
}

const comparisonRouter = new TaxProviderRouter({
  env: {
    TAXJAR_SANDBOX_API_KEY: "national-secret",
    COLORADO_TTR_VALIDATION_ENABLED: "true",
    COLORADO_TTR_API_KEY: "validator-secret"
  },
  options: {
    nationalLookup: async () => providerResponse(co),
    coloradoLookup: async () => coloradoValidationFixture()
  }
});
const routedMatch = await comparisonRouter.resolveJurisdiction({
  restaurantId: "tenant-a",
  locationId: "location-co",
  address: co.address,
  productServiceId: 1
});
assert.equal(routedMatch.provider.id, NATIONAL_PROVIDER_ID);
assert.equal(routedMatch.jurisdiction.sourceMetadata.providerComparison.status, "MATCHED");

const disagreementRouter = new TaxProviderRouter({
  env: {
    TAXJAR_SANDBOX_API_KEY: "national-secret",
    COLORADO_TTR_VALIDATION_ENABLED: "true",
    COLORADO_TTR_API_KEY: "validator-secret"
  },
  options: {
    nationalLookup: async () => providerResponse(co),
    coloradoLookup: async () => coloradoValidationFixture(940)
  }
});
const routedDisagreement = await disagreementRouter.resolveJurisdiction({
  restaurantId: "tenant-a",
  locationId: "location-co-disagreement",
  address: co.address,
  productServiceId: 1
});
assert.equal(routedDisagreement.jurisdiction.sourceMetadata.providerComparison.status, "DISAGREEMENT");
assert.equal(routedDisagreement.jurisdiction.categoryStatus, TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED);

const matchingComparison = compareTaxProviderResults(nationalJurisdiction, {
  provider: "COLORADO_TTR",
  stateCode: "CO",
  county: "Denver",
  municipality: "Denver",
  taxRateBps: nationalJurisdiction.taxRateBps,
  taxComponents: nationalJurisdiction.taxComponents
});
assert.equal(matchingComparison.status, "MATCHED");
const disagreement = compareTaxProviderResults(nationalJurisdiction, {
  provider: "COLORADO_TTR",
  stateCode: "CO",
  county: "Denver",
  municipality: "Denver",
  taxRateBps: nationalJurisdiction.taxRateBps + 25,
  taxComponents: nationalJurisdiction.taxComponents
});
assert.equal(disagreement.status, "DISAGREEMENT");
assert.equal(taxCategoryActivationError({
  provider: NATIONAL_PROVIDER_ID,
  sourceMetadata: { categoryStatus: TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED, providerComparison: disagreement }
}), "PROVIDER_DISAGREEMENT_REVIEW_REQUIRED");

const normalItem = resolveMenuItemTaxTreatment({
  item: {},
  category: {},
  locationTaxRateBps: 825
});
assert.deepEqual(normalItem, { treatment: TAX_TREATMENT.LOCATION_DEFAULT, taxRateBps: 825, taxRateMicros: 82_500, source: "LOCATION", customRule: null });
const categoryExempt = resolveMenuItemTaxTreatment({
  item: {},
  category: { taxTreatment: "EXEMPT" },
  locationTaxRateBps: 825
});
assert.equal(categoryExempt.taxRateBps, 0);
assert.equal(categoryExempt.taxRateMicros, 0);
assert.equal(categoryExempt.source, "CATEGORY");
const itemOverride = resolveMenuItemTaxTreatment({
  item: { taxTreatment: "CUSTOM_RULE", taxRuleJson: { taxRateBps: 500, sourceReference: "verified-rule-1", verifiedAt: "2026-08-18T00:00:00.000Z" } },
  category: { taxTreatment: "EXEMPT" },
  locationTaxRateBps: 825
});
assert.equal(itemOverride.taxRateBps, 500);
assert.equal(itemOverride.taxRateMicros, 50_000);
assert.equal(itemOverride.source, "ITEM");
assert.equal(normalizeTaxRuleForStorage("LOCATION_DEFAULT", { taxRateBps: 999 }), null);
assert.throws(() => normalizeTaxRuleForStorage("CUSTOM_RULE", {}), (error) => error.code === "TAX_CUSTOM_RULE_REQUIRED");

const oneHundredItems = Array.from({ length: 100 }, () => resolveMenuItemTaxTreatment({
  item: {},
  category: {},
  locationTaxRateBps: 825
}));
assert.equal(oneHundredItems.filter((item) => item.treatment === "LOCATION_DEFAULT" && item.taxRateBps === 825).length, 100);
const oneItemExempt = oneHundredItems.map((item, index) => index === 42
  ? resolveMenuItemTaxTreatment({ item: { taxTreatment: "EXEMPT" }, category: {}, locationTaxRateBps: 825 })
  : item);
assert.equal(oneItemExempt.filter((item) => item.treatment === "EXEMPT").length, 1);
assert.equal(oneItemExempt.filter((item) => item.treatment === "LOCATION_DEFAULT" && item.taxRateBps === 825).length, 99);

const pricing = calculatePosPricingSnapshot({
  lineItems: [
    { menuItemId: "taxable", quantity: 1, unitPriceCents: 1000, taxTreatment: "LOCATION_DEFAULT", resolvedTaxRateBps: 825 },
    { menuItemId: "exempt", quantity: 1, unitPriceCents: 1000, taxTreatment: "EXEMPT", resolvedTaxRateBps: 0 }
  ],
  taxRateBps: 825
});
assert.equal(pricing.taxableAmountCents, 1000);
assert.equal(pricing.taxCents, 83);
assert.equal(pricing.totalCents, 2083);

const domain = read("apps/api/src/services/taxDomain.js");
const profileService = read("apps/api/src/services/taxProfileService.js");
const posService = read("apps/api/src/services/posService.js");
const onlineQuote = read("apps/api/src/modules/orderPayments/quoteService.js");
const offlineClient = read("apps/web/src/apps/pos/offlinePricing.js");
const app = read("apps/web/src/App.jsx");
const schema = read("apps/api/prisma/schema.prisma");
const envExample = read("apps/api/.env.example");
const docs = read("docs/national-tax-provider.md");

assert.ok(profileService.includes("new TaxProviderRouter()") && profileService.includes('return "NATIONAL"'));
assert.ok(
  profileService.includes("setCandidateLocationState({ location, profile, normalizedAddress: validation.address })"),
  "Activation must remain bound to the submitted location address when the provider normalizes street or ZIP formatting"
);
assert.ok(schema.includes("enum TaxTreatment") && schema.match(/taxTreatment\s+TaxTreatment\s+@default\(LOCATION_DEFAULT\)/g)?.length === 2);
assert.match(schema, /model LocationTaxProfile[\s\S]*?taxRateMicros\s+Int\?/);
assert.ok(posService.includes("resolveMenuItemTaxTreatment") && onlineQuote.includes("resolveMenuItemTaxTreatment") && offlineClient.includes("resolveMenuItemTaxTreatment"));
assert.ok(offlineClient.includes("categoryTaxTreatment") && offlineClient.includes("sanitizeTaxRule"), "Offline menu caching must retain signed item/category tax policy");
assert.equal(posService.includes("createTaxJarLookup"), false, "POS hot path must not import or call a provider");
assert.equal(onlineQuote.includes("createTaxJarLookup"), false, "online quotes must use active profiles, not a provider");
assert.ok(app.includes("Advanced tax treatment") && app.includes("Default menu tax: Use location default"));
assert.ok(app.includes("This is not legal or tax advice"));
assert.ok(envExample.includes("TAXJAR_SANDBOX_API_KEY=") && envExample.includes("COLORADO_TTR_VALIDATION_ENABLED=false"));
assert.equal(read("apps/web/src/App.jsx").includes("TAXJAR_SANDBOX_API_KEY"), false);
assert.equal(read("apps/web/src/App.jsx").includes("TAXJAR_API_KEY"), false);
assert.ok(docs.includes("POST /v2/addresses/validate") && docs.includes("POST /v2/taxes"));
assert.ok(domain.includes("Authorization: `Bearer ${apiKey}`"));
assert.equal(domain.includes("8.25"), false, "national provider logic must not hardcode a tax rate");
assert.equal(domain.includes("NewYorkRules"), false);
assert.equal(domain.includes("CaliforniaRules"), false);

console.log("national-tax-provider-test passed (FIXTURE / CONTRACT TEST: six-state normalization, full-address transport, routing, failure modes, tenant/location scope, provider comparison, inheritance, pricing, Offline v1, UX, and secret isolation).\n");

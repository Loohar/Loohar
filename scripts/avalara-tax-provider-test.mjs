import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AVALARA_CLIENT_HEADER,
  AVALARA_PROVIDER_ID,
  AVALARA_SANDBOX_BASE_URL,
  AvalaraTaxProvider,
  NATIONAL_PROVIDER_ID,
  TAX_CATEGORY_STATUS,
  TAX_PROVIDER_STATUS,
  TaxProviderRouter,
  createAvalaraLookup,
  normalizeAvalaraResponse,
  taxProviderFor
} from "../apps/api/src/services/taxDomain.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const address = {
  addressLine1: "200 E Colfax Ave",
  city: "Denver",
  stateProvince: "CO",
  postalCode: "80203",
  country: "US"
};

function avalaraResponse({ cityRate = "0.0515", totalTax = "9.15" } = {}) {
  return {
    verifiedAddress: { ...address, postalCode: "80203-1782" },
    resolutionQuality: "ROOFTOP",
    taxAuthorities: [
      { jurisdictionName: "COLORADO", jurisdictionType: "State" },
      { jurisdictionName: "DENVER", jurisdictionType: "County" },
      { jurisdictionName: "DENVER", jurisdictionType: "City" }
    ],
    companyConfigurationFingerprint: "company-fingerprint-only",
    providerLatencyMs: 31,
    transaction: {
      type: "SalesOrder",
      date: "2026-08-18",
      taxDate: "2026-08-18",
      totalTaxable: "100.00",
      totalExempt: "0.00",
      totalTax,
      totalTaxCalculated: totalTax,
      summary: [
        { region: "CO", jurisType: "State", jurisCode: "08", jurisName: "COLORADO", rate: "0.029" },
        { region: "CO", jurisType: "County", jurisCode: "031", jurisName: "DENVER", rate: "0" },
        { region: "CO", jurisType: "City", jurisCode: "200000", jurisName: "DENVER", rate: cityRate },
        { region: "CO", jurisType: "Special", jurisCode: "RTA", jurisName: "REGIONAL DISTRICT", rate: "0.011" }
      ]
    }
  };
}

const requests = [];
const lookup = createAvalaraLookup({
  fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    if (url.endsWith("/api/v2/addresses/resolve")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          resolutionQuality: "Rooftop",
          validatedAddresses: [{
            line1: "200 E COLFAX AVE",
            city: "DENVER",
            region: "CO",
            country: "US",
            postalCode: "80203-1782",
            latitude: 39.7392,
            longitude: -104.9903
          }],
          taxAuthorities: avalaraResponse().taxAuthorities
        })
      };
    }
    return { ok: true, status: 201, json: async () => avalaraResponse().transaction };
  }
});

const fakeAccountId = "sandbox-account";
const fakeLicenseKey = "sandbox-license-key";
const transport = await lookup({
  accountId: fakeAccountId,
  licenseKey: fakeLicenseKey,
  companyCode: "DEFAULT",
  restaurantId: "tenant-a",
  locationId: "location-a",
  address,
  effectiveAt: new Date("2026-08-18T12:00:00.000Z"),
  signal: new AbortController().signal
});
assert.equal(requests.length, 2);
assert.equal(requests[0].url, `${AVALARA_SANDBOX_BASE_URL}/api/v2/addresses/resolve`);
assert.equal(requests[1].url, `${AVALARA_SANDBOX_BASE_URL}/api/v2/transactions/create?$include=Summary%2CAddresses%2CLines%2CDetails`);
assert.equal(requests[0].options.headers["X-Avalara-Client"], AVALARA_CLIENT_HEADER);
assert.equal(requests[1].options.headers["X-Avalara-Client"], AVALARA_CLIENT_HEADER);
const expectedAuthorization = `Basic ${Buffer.from(`${fakeAccountId}:${fakeLicenseKey}`).toString("base64")}`;
assert.equal(requests[0].options.headers.Authorization, expectedAuthorization);
assert.equal(requests[1].options.headers.Authorization, expectedAuthorization);
assert.equal(requests[0].body.line1, address.addressLine1);
assert.equal(requests[0].body.textCase, "Upper");
assert.equal(requests[1].body.type, "SalesOrder");
assert.equal(requests[1].body.commit, false);
assert.equal(requests[1].body.companyCode, "DEFAULT");
assert.equal(requests[1].body.addresses.singleLocation.line1, "200 E COLFAX AVE");
assert.equal("textCase" in requests[1].body.addresses.singleLocation, false);
assert.equal("taxCode" in requests[1].body.lines[0], false, "LOCATION_DEFAULT must use Avalara's documented P0000000 default");
assert.equal(transport.resolutionQuality, "ROOFTOP");
assert.equal(transport.verifiedAddress.postalCode, "80203-1782");
assert.ok(Number.isFinite(transport.providerLatencyMs));

const normalized = normalizeAvalaraResponse({
  restaurantId: "tenant-a",
  locationId: "location-a",
  address,
  response: avalaraResponse(),
  now: new Date("2026-08-18T12:00:00.000Z")
});
assert.equal(normalized.provider, AVALARA_PROVIDER_ID);
assert.equal(normalized.source, "Avalara AvaTax REST v2");
assert.equal(normalized.taxRateMicros, 91_500);
assert.equal(normalized.taxRateBps, 915);
assert.equal(normalized.stateCode, "CO");
assert.equal(normalized.county, "DENVER");
assert.equal(normalized.municipality, "DENVER");
assert.equal(normalized.taxComponents.reduce((sum, component) => sum + component.rateMicros, 0), 91_500);
assert.equal(normalized.sourceMetadata.componentReconciliationStatus, "RECONCILED");
assert.equal(normalized.sourceMetadata.defaultProductTreatment, "AVALARA_DEFAULT_P0000000");
assert.equal(normalized.sourceMetadata.transactionType, "SALES_ORDER_ESTIMATE");
assert.equal(normalized.sourceMetadata.transactionCommitted, false);
assert.equal(normalized.categoryStatus, TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED);
assert.equal(JSON.stringify(normalized).includes(fakeAccountId), false);
assert.equal(JSON.stringify(normalized).includes(fakeLicenseKey), false);
assert.match(normalized.configurationVersion, /^tax-v1-[a-f0-9]{24}$/);

const precise = normalizeAvalaraResponse({
  restaurantId: "tenant-a",
  locationId: "location-precise",
  address,
  response: avalaraResponse({ cityRate: "0.04875", totalTax: "8.88" }),
  now: new Date("2026-08-18T12:00:00.000Z")
});
assert.equal(precise.taxRateMicros, 88_750, "8.875% must not be rounded to whole basis points");
assert.equal(precise.taxRateBps, 888, "basis points remain a rounded compatibility projection");
assert.equal(precise.sourceMetadata.deterministicTaxCents, 888);

const provider = new AvalaraTaxProvider({
  enabled: true,
  accountId: fakeAccountId,
  licenseKey: fakeLicenseKey,
  companyCode: "DEFAULT",
  lookup: async () => avalaraResponse()
});
const jurisdiction = await provider.resolveJurisdiction({
  restaurantId: "tenant-a",
  locationId: "location-a",
  address,
  effectiveAt: new Date("2026-08-18T12:00:00.000Z")
});
assert.equal(provider.operationalStatus().status, TAX_PROVIDER_STATUS.CONFIGURED);
assert.equal("accountId" in provider.operationalStatus(), false);
assert.equal("licenseKey" in provider.operationalStatus(), false);
assert.equal("companyCode" in provider.operationalStatus(), false);
await assert.rejects(
  () => provider.getTaxConfiguration({ restaurantId: "tenant-b", locationId: "location-a", jurisdiction }),
  (error) => error.code === "TAX_PROVIDER_SCOPE_MISMATCH"
);

const env = {
  NATIONAL_TAX_PROVIDER: "AVALARA",
  AVALARA_SANDBOX_ACCOUNT_ID: fakeAccountId,
  AVALARA_SANDBOX_LICENSE_KEY: fakeLicenseKey,
  AVALARA_SANDBOX_COMPANY_CODE: "DEFAULT"
};
const router = new TaxProviderRouter({ env, options: { avalaraLookup: async () => avalaraResponse() } });
assert.equal(router.primaryProviderId(address), AVALARA_PROVIDER_ID);
const routed = await router.resolveJurisdiction({
  restaurantId: "tenant-a",
  locationId: "location-a",
  address,
  effectiveAt: new Date("2026-08-18T12:00:00.000Z")
});
assert.equal(routed.provider.id, AVALARA_PROVIDER_ID);

const comparisonRouter = new TaxProviderRouter({
  env: {
    ...env,
    COLORADO_TTR_VALIDATION_ENABLED: "true",
    COLORADO_TTR_API_KEY: "fake-validator-key"
  },
  options: {
    avalaraLookup: async () => avalaraResponse(),
    coloradoLookup: async () => ({
      addressMatch: { status: "EXACT" },
      verifiedAddress: address,
      providerReference: "co-validator-fixture",
      lookupTimestamp: "2026-08-18T12:00:00.000Z",
      effectiveAt: "2026-08-18T00:00:00.000Z",
      jurisdictionCode: "CO-DENVER-VALIDATION",
      jurisdictions: {
        state: { name: "Colorado", code: "CO", locationCode: "CO" },
        county: { name: "Denver", code: "CO-DENVER", locationCode: "031" },
        municipality: { name: "Denver", code: "CO-DENVER", locationCode: "200000" },
        specialDistricts: [{ name: "Regional District", code: "RTA", locationCode: "RTA" }]
      },
      taxComponents: [
        { type: "STATE", name: "Colorado", jurisdictionCode: "CO", rateBps: 290, rateMicros: 29_000 },
        { type: "COUNTY", name: "Denver", jurisdictionCode: "CO-DENVER", rateBps: 0, rateMicros: 0 },
        { type: "MUNICIPALITY", name: "Denver", jurisdictionCode: "CO-DENVER", rateBps: 515, rateMicros: 51_500 },
        { type: "SPECIAL_DISTRICT", name: "Regional District", jurisdictionCode: "RTA", rateBps: 110, rateMicros: 11_000 }
      ],
      combinedRateBps: 915,
      combinedRateMicros: 91_500,
      componentReconciliationStatus: "RECONCILED",
      category: { status: TAX_CATEGORY_STATUS.GENERAL_RATE_SUPPORTED, code: "GENERAL_TAXABLE" }
    })
  }
});
const compared = await comparisonRouter.resolveJurisdiction({
  restaurantId: "tenant-a",
  locationId: "location-co-comparison",
  address,
  effectiveAt: new Date("2026-08-18T12:00:00.000Z"),
  productServiceId: 1
});
assert.equal(compared.jurisdiction.sourceMetadata.providerComparison.status, "MATCHED");
assert.equal(new TaxProviderRouter({ env: {} }).primaryProviderId(address), NATIONAL_PROVIDER_ID, "TaxJar must remain the compatibility default");
assert.equal(taxProviderFor("TAXJAR", {}).id, NATIONAL_PROVIDER_ID);
assert.equal(taxProviderFor("MANUAL_VERIFIED", {}).id, "MANUAL_VERIFIED");
assert.equal(taxProviderFor("AVALARA", {}).operationalStatus().credentialsConfigured, false);
await assert.rejects(
  () => taxProviderFor("AVALARA", {}).resolveJurisdiction({
    restaurantId: "tenant-a",
    locationId: "location-a",
    address
  }),
  (error) => error.code === "TAX_PROVIDER_NOT_CONFIGURED"
);
assert.throws(
  () => new TaxProviderRouter({ env: { NATIONAL_TAX_PROVIDER: "UNKNOWN" } }).primaryProviderId(address),
  (error) => error.code === "TAX_PROVIDER_CONFIGURATION_INVALID"
);

for (const [status, expectedCode] of [
  [401, "TAX_PROVIDER_AUTH_FAILED"],
  [403, "TAX_PROVIDER_AUTH_FAILED"],
  [429, "TAX_PROVIDER_RATE_LIMITED"],
  [500, "TAX_PROVIDER_UNAVAILABLE"],
  [503, "TAX_PROVIDER_UNAVAILABLE"]
]) {
  const failed = createAvalaraLookup({ fetchImpl: async () => ({ ok: false, status }) });
  await assert.rejects(
    () => failed({
      accountId: fakeAccountId,
      licenseKey: fakeLicenseKey,
      companyCode: "DEFAULT",
      restaurantId: "tenant-a",
      locationId: "location-a",
      address,
      signal: new AbortController().signal
    }),
    (error) => error.code === expectedCode
  );
}

const networkFailure = createAvalaraLookup({ fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); } });
await assert.rejects(
  () => networkFailure({
    accountId: fakeAccountId,
    licenseKey: fakeLicenseKey,
    companyCode: "DEFAULT",
    restaurantId: "tenant-a",
    locationId: "location-a",
    address,
    signal: new AbortController().signal
  }),
  (error) => error.code === "TAX_PROVIDER_UNAVAILABLE"
);

const aborted = createAvalaraLookup({
  fetchImpl: async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }
});
await assert.rejects(
  () => aborted({
    accountId: fakeAccountId,
    licenseKey: fakeLicenseKey,
    companyCode: "DEFAULT",
    restaurantId: "tenant-a",
    locationId: "location-a",
    address,
    signal: new AbortController().signal
  }),
  (error) => error.code === "TAX_PROVIDER_TIMEOUT"
);

const invalidJson = createAvalaraLookup({
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } })
});
await assert.rejects(
  () => invalidJson({
    accountId: fakeAccountId,
    licenseKey: fakeLicenseKey,
    companyCode: "DEFAULT",
    restaurantId: "tenant-a",
    locationId: "location-a",
    address,
    signal: new AbortController().signal
  }),
  (error) => error.code === "TAX_PROVIDER_INVALID_RESPONSE"
);
await assert.rejects(
  () => lookup({
    accountId: fakeAccountId,
    licenseKey: fakeLicenseKey,
    companyCode: "DEFAULT",
    restaurantId: "tenant-a",
    locationId: "location-a",
    address: { ...address, addressLine1: "" },
    signal: new AbortController().signal
  }),
  (error) => error.code === "TAX_ADDRESS_REQUIRED"
);
await assert.rejects(
  () => lookup({
    accountId: fakeAccountId,
    licenseKey: fakeLicenseKey,
    companyCode: "DEFAULT",
    restaurantId: "tenant-a",
    locationId: "location-ca",
    address: { ...address, country: "CA" },
    signal: new AbortController().signal
  }),
  (error) => error.code === "TAX_UNSUPPORTED_JURISDICTION"
);
assert.throws(
  () => createAvalaraLookup({ baseUrl: "https://rest.avatax.com" }),
  (error) => error.code === "TAX_PROVIDER_ENVIRONMENT_INVALID",
  "production AvaTax must be impossible in this sandbox-only phase"
);

const malformed = avalaraResponse();
malformed.transaction.summary = [];
assert.throws(
  () => normalizeAvalaraResponse({ restaurantId: "tenant-a", locationId: "location-a", address, response: malformed }),
  (error) => error.code === "TAX_COMPONENT_INVALID"
);
const missingRate = avalaraResponse();
delete missingRate.transaction.summary[0].rate;
assert.throws(
  () => normalizeAvalaraResponse({ restaurantId: "tenant-a", locationId: "location-a", address, response: missingRate }),
  (error) => error.code === "TAX_PROVIDER_INVALID_RESPONSE"
);
const unreconciled = normalizeAvalaraResponse({
  restaurantId: "tenant-a",
  locationId: "location-review",
  address,
  response: avalaraResponse({ totalTax: "9.16" })
});
assert.equal(unreconciled.categoryStatus, TAX_CATEGORY_STATUS.MANUAL_REVIEW_REQUIRED);
assert.equal(unreconciled.sourceMetadata.componentReconciliationStatus, "REVIEW_REQUIRED");

const domain = read("apps/api/src/services/taxDomain.js");
const envExample = read("apps/api/.env.example");
const webApp = read("apps/web/src/App.jsx");
const posService = read("apps/api/src/services/posService.js");
const onlineQuote = read("apps/api/src/modules/orderPayments/quoteService.js");
const docs = read("docs/avalara-avatax-provider.md");
for (const variable of ["AVALARA_SANDBOX_ACCOUNT_ID", "AVALARA_SANDBOX_LICENSE_KEY", "AVALARA_SANDBOX_COMPANY_CODE"]) {
  assert.ok(envExample.includes(`${variable}=`));
  assert.equal(webApp.includes(variable), false);
}
assert.ok(domain.includes("class AvalaraTaxProvider extends TaxProvider"));
assert.equal(posService.includes("createAvalaraLookup"), false, "POS item/cart paths must not call Avalara");
assert.equal(onlineQuote.includes("createAvalaraLookup"), false, "online pickup quotes must consume active profiles");
assert.ok(docs.includes("/api/v2/addresses/resolve") && docs.includes("/api/v2/transactions/create"));
assert.equal(domain.includes("8.25"), false);

console.log("avalara-tax-provider-test passed (official sandbox contract, fixed-point normalization, routing, scope, failure modes, and credential isolation).\n");

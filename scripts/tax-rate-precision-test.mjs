import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeTaxJarResponse } from "../apps/api/src/services/taxDomain.js";
import { calculatePosPricingSnapshot, validatePosOfflinePricingSnapshot } from "../apps/shared/posOfflinePricing.js";
import {
  calculateTaxCents,
  fractionalTaxRateToMicros,
  taxRateBpsFromMicros,
  taxRateMicrosFromBps
} from "../apps/shared/taxRate.js";
import { buildPosOfflineInitialization, calculatePosOfflineQuote } from "../apps/web/src/apps/pos/offlinePricing.js";

const precisionCases = [
  { fractional: "0", micros: 0, amountCents: 100_000, taxCents: 0 },
  { fractional: "0.0825", micros: 82_500, amountCents: 100_000, taxCents: 8_250 },
  { fractional: "0.08875", micros: 88_750, amountCents: 100_000, taxCents: 8_875 },
  { fractional: "0.07125", micros: 71_250, amountCents: 100_000, taxCents: 7_125 },
  { fractional: "0.043125", micros: 43_125, amountCents: 100_000, taxCents: 4_313 },
  { fractional: "0.000001", micros: 1, amountCents: 1_000_000, taxCents: 1 }
];

for (const fixture of precisionCases) {
  assert.equal(fractionalTaxRateToMicros(fixture.fractional), fixture.micros);
  const pricing = calculatePosPricingSnapshot({
    lineItems: [{ menuItemId: "item-1", quantity: 1, unitPriceCents: fixture.amountCents }],
    taxRateBps: taxRateBpsFromMicros(fixture.micros),
    taxRateMicros: fixture.micros
  });
  assert.equal(pricing.taxRateMicros, fixture.micros);
  assert.equal(pricing.taxCents, fixture.taxCents);
}

const legacyPricing = calculatePosPricingSnapshot({
  lineItems: [{ menuItemId: "legacy", quantity: 1, unitPriceCents: 100_000 }],
  taxRateBps: 825
});
assert.equal(legacyPricing.taxRateMicros, 82_500);
assert.equal(legacyPricing.taxRateBps, 825);
assert.equal(legacyPricing.taxCents, 8_250);
assert.equal(taxRateMicrosFromBps(825), 82_500);
assert.equal(taxRateBpsFromMicros(82_500), 825);
assert.equal(calculateTaxCents({ taxableAmountCents: 100_000, taxRateMicros: 82_500 }), 8_250);

const combinedJurisdictionMicros = [40_000, 8_750, 40_000, 0].reduce((sum, rate) => sum + rate, 0);
assert.equal(combinedJurisdictionMicros, 88_750);
assert.equal(calculateTaxCents({ taxableAmountCents: 100_000, taxRateMicros: combinedJurisdictionMicros }), 8_875);

const legacyTransaction = {
  orderSnapshot: {
    lineItems: [{ menuItemId: "legacy", quantity: 1, unitPriceCents: 10_000 }],
    subtotalCents: 10_000,
    discountCents: 0,
    deliveryFeeCents: 0,
    taxCents: 825,
    tipCents: 0,
    totalCents: 10_825
  },
  taxSnapshot: { taxRateBps: 825, taxInclusive: false, taxableAmountCents: 10_000, taxCents: 825 }
};
assert.equal(validatePosOfflinePricingSnapshot(legacyTransaction).taxRateMicros, 82_500);

const now = new Date();
const future = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
const preciseMicros = 88_750;
const preciseBps = taxRateBpsFromMicros(preciseMicros);
const config = {
  restaurant: { id: "restaurant-precision", slug: "precision", name: "Precision", timezone: "America/Denver", deliveryFeeCents: 0 },
  staff: { id: "staff-1", userId: "user-1", role: "CASHIER" },
  locations: [{ id: "location-1", name: "Main", active: true }],
  deliveryZones: [],
  permissions: ["POS_ACCESS", "POS_ACCEPT_CASH", "POS_SEND_TO_KITCHEN"],
  device: { id: "terminal-1", deviceType: "MAIN_TERMINAL", status: "ACTIVE", locationId: "location-1", cashDrawerId: "drawer-1" },
  shift: { id: "shift-1", status: "OPEN", employeeUserId: "user-1", locationId: "location-1", cashDrawerId: "drawer-1", openedAt: now.toISOString() },
  cashDrawers: [{ id: "drawer-1", status: "OPEN", locationId: "location-1", active: true }],
  taxConfiguration: {
    id: "tax-profile-precision",
    locationId: "location-1",
    provider: "NATIONAL_TAXJAR",
    source: "TaxJar Sales Tax API",
    taxRateBps: preciseBps,
    taxRateMicros: preciseMicros,
    taxInclusive: false,
    enabled: true,
    jurisdictionCode: "TAXJAR:CO:80203:DENVER:DENVER",
    jurisdictionMetadata: {},
    sourceMetadata: {},
    effectiveAt: now.toISOString(),
    verifiedAt: now.toISOString(),
    configurationVersion: "tax-precision-v1",
    acknowledgementVersion: "tax-precision-v1",
    acknowledgedAt: now.toISOString(),
    updatedAt: now.toISOString()
  },
  configurationVersion: "config-precision-v1",
  offlineConfigurationProof: "signed-config-proof",
  offlineValidUntil: future,
  serverTime: now.toISOString()
};
const menu = {
  menuVersion: "menu-precision-v1",
  generatedAt: now.toISOString(),
  tenantId: config.restaurant.id,
  locationId: "location-1",
  categories: [{
    id: "category-1",
    name: "Menu",
    items: [{
      id: "item-1",
      categoryId: "category-1",
      name: "Precision item",
      priceCents: 100_000,
      available: true,
      taxTreatment: "LOCATION_DEFAULT",
      categoryTaxTreatment: "LOCATION_DEFAULT",
      offlinePricingProof: "signed-item-proof",
      options: [],
      optionGroups: []
    }]
  }]
};
const initialization = buildPosOfflineInitialization({ config, menu, registerKey: "precision-register" });
const offline = calculatePosOfflineQuote({
  initialization,
  cart: [{ menuItemId: "item-1", name: "Precision item", priceCents: 100_000, quantity: 1, modifiers: [] }],
  orderType: "WALK_IN",
  locationId: "location-1"
});
const online = calculatePosPricingSnapshot({
  lineItems: [{ menuItemId: "item-1", quantity: 1, unitPriceCents: 100_000, resolvedTaxRateMicros: preciseMicros }],
  taxRateBps: preciseBps,
  taxRateMicros: preciseMicros
});
assert.deepEqual(
  { taxRateMicros: offline.taxRateMicros, taxCents: offline.taxCents, totalCents: offline.totalCents },
  { taxRateMicros: online.taxRateMicros, taxCents: online.taxCents, totalCents: online.totalCents },
  "online and Offline v1 must calculate the same cents from the same precise profile"
);
assert.equal(offline.taxSnapshot.taxRateMicros, preciseMicros);

const address = {
  addressLine1: "200 E Colfax Ave",
  city: "Denver",
  stateProvince: "CO",
  postalCode: "80203-1782",
  country: "US"
};
const normalized = normalizeTaxJarResponse({
  restaurantId: "tenant-precision",
  locationId: "location-precision",
  address,
  response: {
    verifiedAddress: address,
    tax: {
      rate: 0.08875,
      has_nexus: true,
      tax_source: "destination",
      freight_taxable: false,
      jurisdictions: { state: "CO", county: "DENVER", city: "DENVER" },
      breakdown: { state_tax_rate: 0.04, county_tax_rate: 0.00875, city_tax_rate: 0.04, special_tax_rate: 0 }
    }
  }
});
assert.equal(normalized.taxRateMicros, 88_750);
assert.equal(normalized.taxRateBps, 888);
assert.equal(normalized.taxComponents.reduce((sum, component) => sum + component.rateMicros, 0), 88_750);
assert.equal(normalized.sourceMetadata.providerRate, "0.08875");

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "apps/api/prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(root, "apps/api/prisma/migrations/20260818100000_tax_rate_micro_precision/migration.sql"), "utf8");
const posService = readFileSync(resolve(root, "apps/api/src/services/posService.js"), "utf8");
assert.match(schema, /model LocationTaxProfile[\s\S]*?taxRateMicros\s+Int\?/);
assert.match(schema, /model OrderTaxSnapshot[\s\S]*?taxRateMicros\s+Int\?/);
assert.ok(migration.includes('ADD COLUMN "taxRateMicros" INTEGER'));
assert.ok(posService.includes("taxRateMicros: taxSnapshot.taxRateMicros"));
assert.ok(posService.includes("taxRateMicros: validated.transaction.taxSnapshot.taxRateMicros"));

console.log("Tax rate precision tests passed.");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculatePosPricingSnapshot } from "../apps/shared/posOfflinePricing.js";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const posService = read("apps/api/src/services/posService.js");
const quoteService = read("apps/api/src/modules/orderPayments/quoteService.js");
const orderPaymentService = read("apps/api/src/modules/orderPayments/orderPaymentService.js");
const errorHandler = read("apps/api/src/middleware/errorHandler.js");
const publicRoutes = read("apps/api/src/routes/public.js");
const app = read("apps/web/src/App.jsx");
const schema = read("apps/api/prisma/schema.prisma");
const migration = read("apps/api/prisma/migrations/20260815200000_remove_tax_rate_defaults/migration.sql");
const apiEnvExample = read("apps/api/.env.example");
const stagingProfileWriter = read("scripts/configure-staging-tax-profile.mjs");
const offlinePricing = read("apps/web/src/apps/pos/offlinePricing.js");

assert.equal(posService.includes("?? 825"), false, "POS must not use an implicit 825-bps fallback");
assert.equal(quoteService.includes("DEFAULT_TAX_RATE_BPS"), false, "Customer quotes must not use an environment tax fallback");
assert.equal(apiEnvExample.includes("DEFAULT_TAX_RATE_BPS"), false, "Environment examples must not advertise a global tax fallback");
assert.equal(app.includes("0.0825"), false, "Frontend must not estimate tax using a hardcoded rate");
assert.equal(publicRoutes.includes("taxRatePlaceholder"), false, "Public APIs must not expose a fake tax placeholder");

assert.ok(posService.includes("findValidLocationTaxConfiguration"), "POS quotes must resolve a location tax profile");
assert.ok(posService.includes("POS_TAX_CONFIGURATION_REQUIRED"), "POS must return a stable missing-tax error code");
assert.ok(posService.indexOf("requireLocationTaxConfiguration(taxConfiguration)") < posService.indexOf("prisma.orderQuote.create"), "POS quote creation must fail before persistence when tax is missing");
assert.ok(quoteService.includes("ORDER_TAX_CONFIGURATION_REQUIRED"), "Customer quotes must return a stable missing-tax error code");
assert.ok(quoteService.includes("configuredTaxRateBps(restaurant.taxConfigurations?.[0])"), "Customer quote tax must use explicit configuration only");
assert.ok(orderPaymentService.indexOf("calculateOrderQuote") < orderPaymentService.indexOf("prisma.$transaction"), "Missing tax must fail before customer order settlement starts");
assert.ok(errorHandler.includes("error.code ? { code: error.code }"), "Controlled tax errors must expose their stable code");

for (const model of ["OrderTaxSnapshot", "TaxConfiguration"]) {
  const block = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] || "";
  assert.ok(/taxRateBps\s+Int(?:\s|$)/.test(block), `${model} must keep an explicit required tax rate`);
  assert.equal(/taxRateBps\s+Int\s+@default/.test(block), false, `${model} must not inherit a tax rate default`);
}
assert.ok(migration.includes('ALTER TABLE "OrderTaxSnapshot"') && migration.includes('ALTER TABLE "TaxConfiguration"'), "Migration must remove both legacy defaults");
assert.equal(/\b(UPDATE|INSERT|DELETE)\b/i.test(migration), false, "Migration must not rewrite explicit tax data");
assert.equal(stagingProfileWriter.includes("825"), false, "Synthetic staging rate must remain runtime data, not application code");

function totalsFor(taxRateBps) {
  return calculatePosPricingSnapshot({
    lineItems: [{ quantity: 1, unitPriceCents: 10_000 }],
    discountCents: 0,
    deliveryFeeCents: 0,
    taxRateBps,
    tipCents: 0
  });
}

assert.equal(totalsFor(825).taxCents, 825, "Explicit 825-bps configuration must remain valid");
assert.equal(totalsFor(625).taxCents, 625, "An explicit non-staging rate must drive tax calculation");
assert.equal(totalsFor(0).taxCents, 0, "Explicit zero-rate configuration must remain valid");
assert.throws(() => totalsFor(undefined), (error) => error?.code === "POS_OFFLINE_TAX_INVALID", "Missing Offline v1 tax configuration must fail closed");
assert.ok(offlinePricing.includes("Offline sales require a synchronized tax configuration."), "Offline v1 missing-profile guard must remain active");
assert.ok(app.includes("Configured at checkout") && app.includes("apiOnline && !quote"), "Frontend must wait for an authoritative configured-tax quote");

console.log("tax-default-removal-test passed (explicit rates, zero rate, backend/frontend fail-closed behavior, schema defaults, migration safety, and Offline v1 regression).\n");

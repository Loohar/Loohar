import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isMerchantAccountPaymentReady,
  normalizeMerchantPaymentReadiness
} from "../apps/api/src/modules/orderPayments/merchantReadiness.js";

const root = process.cwd();

function read(filePath) {
  const absolutePath = join(root, filePath);
  assert.ok(existsSync(absolutePath), `Missing required file: ${filePath}`);
  return readFileSync(absolutePath, "utf8");
}

function readyMerchantAccount(overrides = {}) {
  return {
    provider: "STRIPE_CONNECT",
    status: "ENABLED",
    stripeAccountId: "acct_ready",
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
    requirementsJson: { currently_due: [], past_due: [], disabled_reason: null },
    disabledReason: null,
    ...overrides
  };
}

const ready = normalizeMerchantPaymentReadiness(readyMerchantAccount());
assert.equal(ready.ready, true, "onboarding readiness returns paymentReady=true when RestaurantMerchantAccount is ready");
assert.equal(ready.accountPresent, true, "ready merchant account reports account present");
assert.equal(ready.chargesEnabled, true, "ready merchant account reports charges enabled");
assert.equal(ready.payoutsEnabled, true, "ready merchant account reports payouts enabled");
assert.equal(ready.requirementsBlocking, false, "ready merchant account has no blocking requirements");

const actionRequired = normalizeMerchantPaymentReadiness(readyMerchantAccount({
  status: "ACTION_REQUIRED",
  stripeChargesEnabled: false,
  requirementsJson: { currently_due: ["business_profile.url"], past_due: [] }
}));
assert.equal(actionRequired.ready, false, "onboarding readiness returns paymentReady=false when merchant account is not ready");
assert.equal(actionRequired.requirementsBlocking, true, "action-required merchant account reports blocking requirements");

assert.equal(isMerchantAccountPaymentReady(readyMerchantAccount()), true, "shared helper preserves payment-service ready behavior");
assert.equal(isMerchantAccountPaymentReady(readyMerchantAccount({ stripeAccountId: null })), false, "shared helper rejects missing Stripe account");
assert.equal(isMerchantAccountPaymentReady(readyMerchantAccount({ provider: "MANUAL" })), false, "shared helper rejects non-Stripe merchant account");

const restaurantRoutes = read("apps/api/src/routes/restaurant.js");
const app = read("apps/web/src/App.jsx");
const orderPaymentService = read("apps/api/src/modules/orderPayments/orderPaymentService.js");

assert.ok(
  restaurantRoutes.includes("normalizeMerchantPaymentReadiness(merchantAccount)") &&
    restaurantRoutes.includes('merchantAccounts: { where: { provider: "STRIPE_CONNECT" }, take: 1 }'),
  "onboarding readiness loads and normalizes RestaurantMerchantAccount"
);
assert.equal(
  restaurantRoutes.includes("settings.paymentSetup || settings.payments"),
  false,
  "legacy settingsJson payment fields no longer override live merchant readiness"
);
assert.ok(
  restaurantRoutes.includes("paymentReadiness") &&
    restaurantRoutes.includes("sections.fulfillment && sections.menu && sections.tax && paymentReady"),
  "onboarding response exposes merchant payment readiness and still gates ordering readiness"
);

assert.ok(
  app.includes("const merchantPaymentReady = Boolean(") &&
    app.includes("merchantAccount?.provider === \"STRIPE_CONNECT\"") &&
    app.includes("Paid online ordering is connected for this restaurant."),
  "frontend renders connected payment guidance when merchant readiness is ready"
);
assert.ok(
  app.includes("merchantPaymentReady") &&
    app.includes("Paid online ordering stays blocked until the restaurant merchant account is enabled."),
  "frontend keeps action-required payment guidance when merchant readiness is not ready"
);
assert.ok(
  app.includes('const restaurantKey = initialSlug || user?.restaurantSlug || routeRestaurantId || user?.restaurantId || "";') &&
    app.includes("loohar-restaurant"),
  "tenant routing keeps slug-based loohar-restaurant support"
);
assert.ok(
  orderPaymentService.includes('restaurantId_provider: { restaurantId: quote.restaurant.id, provider: "STRIPE_CONNECT" }') &&
    orderPaymentService.includes('restaurantId_provider: { restaurantId: user.restaurantId, provider: "STRIPE_CONNECT" }'),
  "merchant account remains mapped to the active tenant context"
);

console.log("onboarding-payment-readiness-test passed.");

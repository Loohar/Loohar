import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  entitlementDecision,
  FEATURE,
  normalizeSubscriptionStatus,
  subscriptionAccessForStatus
} from "../apps/api/src/config/entitlements.js";

function entitlement(status) {
  return {
    planCode: "ENTERPRISE",
    subscriptionStatus: status,
    enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"]
  };
}

const expectedStates = {
  ACTIVE: "FULL",
  TRIALING: "FULL",
  PAST_DUE: "FULL",
  UNPAID: "READ_ONLY",
  CANCELLED: "READ_ONLY",
  SUSPENDED: "NONE"
};

for (const [status, mode] of Object.entries(expectedStates)) {
  assert.equal(subscriptionAccessForStatus(status).mode, mode, `${status} should resolve to ${mode}`);
}

assert.equal(normalizeSubscriptionStatus("CANCELED"), "CANCELLED", "Stripe CANCELED should normalize to app CANCELLED spelling");
assert.equal(entitlementDecision(entitlement("ACTIVE"), FEATURE.ANALYTICS, "POST").allowed, true, "ACTIVE should allow entitled writes");
assert.equal(entitlementDecision(entitlement("TRIALING"), FEATURE.ANALYTICS, "POST").allowed, true, "TRIALING should allow entitled writes");
assert.equal(entitlementDecision(entitlement("PAST_DUE"), FEATURE.ANALYTICS, "POST").allowed, true, "PAST_DUE should allow writes with warning");
assert.ok(entitlementDecision(entitlement("PAST_DUE"), FEATURE.ANALYTICS, "GET").warning, "PAST_DUE should expose warning context");
assert.equal(entitlementDecision(entitlement("UNPAID"), FEATURE.ANALYTICS, "GET").allowed, true, "UNPAID should allow reads");
assert.equal(entitlementDecision(entitlement("UNPAID"), FEATURE.ANALYTICS, "POST").code, "SUBSCRIPTION_READ_ONLY", "UNPAID should deny writes");
assert.equal(entitlementDecision(entitlement("CANCELLED"), FEATURE.ANALYTICS, "POST").code, "SUBSCRIPTION_READ_ONLY", "CANCELLED should deny writes");
assert.equal(entitlementDecision(entitlement("SUSPENDED"), FEATURE.ANALYTICS, "GET").code, "SUBSCRIPTION_SUSPENDED", "SUSPENDED should deny all access");

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
for (const required of [
  "model PlatformSubscription",
  "status                   PlatformBillingStatus",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "trialEndsAt",
  "model TenantSubscription",
  "active             Boolean",
  "model User",
  "role            UserRole",
  "model Restaurant"
]) {
  assert.ok(schema.includes(required), `Schema must include ${required}`);
}

const middleware = readFileSync("apps/api/src/middleware/entitlements.js", "utf8");
assert.ok(middleware.includes("platformSubscription ? \"PLATFORM_SUBSCRIPTION\""), "Platform subscription should be preferred over legacy tenant subscription");
assert.ok(middleware.includes("tenantStatus: restaurant.status"), "Tenant status should be included in entitlement context");

const platformBillingRoutes = readFileSync("apps/api/src/routes/platformBilling.js", "utf8");
assert.ok(platformBillingRoutes.includes("res.status(501)"), "Direct plan changes must not mutate subscription state");

const webhookRoutes = readFileSync("apps/api/src/routes/webhooks.js", "utf8");
assert.ok(webhookRoutes.includes("verifyStripeWebhook"), "Stripe webhook routes must verify signatures");
assert.ok(webhookRoutes.includes("STRIPE_PLATFORM_WEBHOOK_SECRET"), "Platform billing webhook must use Stripe platform webhook secret");

const billingService = readFileSync("apps/api/src/modules/platformBilling/platformBillingService.js", "utf8");
assert.ok(billingService.includes("export async function handleStripePlatformWebhook"), "Platform billing service must expose Stripe webhook handler");
assert.ok(billingService.includes("eventType?.startsWith(\"customer.subscription.\")"), "Stripe subscription events must be handled");
const cancelFunction = billingService.slice(billingService.indexOf("export async function cancelPlatformSubscription"), billingService.indexOf("function statusFromStripe"));
assert.ok(!cancelFunction.includes("prisma.platformSubscription.update"), "Cancel request must not locally change subscription truth before Stripe webhook");
assert.ok(cancelFunction.includes("pendingWebhook: true"), "Cancel request should tell callers local truth is awaiting webhook");

console.log("Subscription tests passed.");

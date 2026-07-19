import assert from "node:assert/strict";
import {
  entitlementDecision,
  entitlementLimitForPlan,
  FEATURE,
  FEATURE_ORDER,
  FEATURE_REQUIRED_PLAN,
  moduleAllowsFeature,
  planAllowsFeature,
  usageLimitDecision,
  USAGE_LIMIT
} from "../apps/api/src/config/entitlements.js";

const allModules = [
  "RESTAURANT_ORDERING",
  "PICKUP",
  "DELIVERY",
  "DRIVER_MANAGEMENT",
  "LOYALTY",
  "COUPONS",
  "DELIVERY_ZONES",
  "FOOD_CATALOG"
];

function entitlement(planCode, status = "ACTIVE", enabledModules = allModules) {
  return { planCode, subscriptionStatus: status, enabledModules };
}

for (const feature of FEATURE_ORDER) {
  assert.ok(FEATURE_REQUIRED_PLAN[feature], `${feature} must declare a required plan`);
  assert.equal(planAllowsFeature("ENTERPRISE", feature), true, `Enterprise should allow ${feature}`);
}

for (const feature of [
  FEATURE.LOYALTY,
  FEATURE.COUPONS,
  FEATURE.DELIVERY_ZONES,
  FEATURE.CUSTOMER_CRM,
  FEATURE.ANALYTICS,
  FEATURE.REPORTS,
  FEATURE.MENU_INSIGHTS,
  FEATURE.MULTI_LOCATION,
  FEATURE.WHITE_LABEL,
  FEATURE.CUSTOM_DOMAIN
]) {
  const decision = entitlementDecision(entitlement("STARTER"), feature, "POST");
  assert.equal(decision.allowed, false, `Starter must not mutate ${feature}`);
  assert.equal(decision.status, 403, `Starter ${feature} denial must be 403`);
  assert.match(decision.error, /Feature not included|disabled|read-only|suspended/i);
}

for (const feature of [
  FEATURE.LOYALTY,
  FEATURE.COUPONS,
  FEATURE.DELIVERY,
  FEATURE.DRIVER_MANAGEMENT,
  FEATURE.DELIVERY_ZONES,
  FEATURE.KITCHEN_DISPLAY,
  FEATURE.PRINTING,
  FEATURE.NOTIFICATIONS,
  FEATURE.INVENTORY
]) {
  assert.equal(entitlementDecision(entitlement("PROFESSIONAL"), feature, "GET").allowed, true, `Professional should read ${feature}`);
}

for (const feature of [
  FEATURE.ANALYTICS,
  FEATURE.REPORTS,
  FEATURE.MENU_INSIGHTS,
  FEATURE.MULTI_LOCATION,
  FEATURE.WHITE_LABEL,
  FEATURE.CUSTOM_DOMAIN,
  FEATURE.POS
]) {
  const decision = entitlementDecision(entitlement("PROFESSIONAL"), feature, "GET");
  assert.equal(decision.allowed, false, `Professional must not access Enterprise feature ${feature}`);
  assert.equal(decision.code, "FEATURE_NOT_INCLUDED");
}

const readOnlyRead = entitlementDecision(entitlement("PROFESSIONAL", "UNPAID"), FEATURE.LOYALTY, "GET");
assert.equal(readOnlyRead.allowed, true, "UNPAID subscriptions may read allowed features");
assert.ok(readOnlyRead.warning, "UNPAID reads should carry warning context");

const readOnlyWrite = entitlementDecision(entitlement("PROFESSIONAL", "UNPAID"), FEATURE.LOYALTY, "POST");
assert.equal(readOnlyWrite.allowed, false, "UNPAID subscriptions must not mutate features");
assert.equal(readOnlyWrite.code, "SUBSCRIPTION_READ_ONLY");

for (const status of ["SUSPENDED", "DELETED", "PENDING"]) {
  const decision = entitlementDecision(entitlement("ENTERPRISE", status), FEATURE.BASIC_DASHBOARD, "GET");
  assert.equal(decision.allowed, false, `${status} tenants must have no access`);
  assert.equal(decision.code, "SUBSCRIPTION_SUSPENDED");
}

assert.equal(moduleAllowsFeature(["RESTAURANT_ORDERING"], FEATURE.LOYALTY), false, "Disabled module must deny a feature even when plan allows it");
assert.equal(entitlementDecision(entitlement("ENTERPRISE", "ACTIVE", ["RESTAURANT_ORDERING"]), FEATURE.LOYALTY, "GET").code, "FEATURE_DISABLED");

assert.equal(entitlementLimitForPlan("STARTER", USAGE_LIMIT.MENU_ITEMS), 50, "Starter menu item limit should be explicit");
assert.equal(entitlementLimitForPlan("PROFESSIONAL", USAGE_LIMIT.DELIVERY_ZONES), 10, "Professional delivery zone limit should be explicit");
assert.equal(entitlementLimitForPlan("ENTERPRISE", USAGE_LIMIT.MENU_ITEMS), null, "Enterprise menu item limit should be unmetered");

assert.equal(usageLimitDecision({ entitlement: entitlement("STARTER"), limitCode: USAGE_LIMIT.MENU_ITEMS, used: 49, requestedIncrement: 1 }).allowed, true, "Starter can create up to its menu item limit");
const starterMenuLimit = usageLimitDecision({ entitlement: entitlement("STARTER"), limitCode: USAGE_LIMIT.MENU_ITEMS, used: 50, requestedIncrement: 1 });
assert.equal(starterMenuLimit.allowed, false, "Starter cannot exceed its menu item limit");
assert.equal(starterMenuLimit.code, "USAGE_LIMIT_REACHED");
assert.equal(starterMenuLimit.status, 403);

const starterZoneLimit = usageLimitDecision({ entitlement: entitlement("STARTER"), limitCode: USAGE_LIMIT.DELIVERY_ZONES, used: 0, requestedIncrement: 1 });
assert.equal(starterZoneLimit.allowed, false, "Starter cannot create delivery zones");
assert.equal(starterZoneLimit.maxAllowed, 0);

assert.equal(usageLimitDecision({ entitlement: entitlement("ENTERPRISE"), limitCode: USAGE_LIMIT.GALLERY_IMAGES, used: 1000, requestedIncrement: 100 }).allowed, true, "Enterprise usage limits are unmetered");

console.log("Entitlement tests passed.");

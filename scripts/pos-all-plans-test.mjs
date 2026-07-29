import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  entitlementDecision,
  FEATURE,
  FEATURE_REQUIRED_PLAN,
  planAllowsFeature
} from "../apps/api/src/config/entitlements.js";

const corePosFeatures = [
  FEATURE.POS_REGISTER,
  FEATURE.POS_KIOSK_MODE,
  FEATURE.POS_DEVICE_MANAGEMENT,
  FEATURE.POS_CASH_PAYMENTS,
  FEATURE.POS_CARD_PAYMENTS,
  FEATURE.POS_SHIFTS,
  FEATURE.POS_RECEIPTS
];

const plans = ["STARTER", "PROFESSIONAL", "ENTERPRISE"];

function entitlement(planCode, status = "ACTIVE") {
  return { planCode, subscriptionStatus: status, enabledModules: [] };
}

for (const feature of corePosFeatures) {
  assert.equal(FEATURE_REQUIRED_PLAN[feature], "STARTER", `${feature} must be included from Starter`);
  for (const plan of plans) {
    assert.equal(planAllowsFeature(plan, feature), true, `${plan} must include ${feature}`);
    assert.equal(entitlementDecision(entitlement(plan), feature, "GET").allowed, true, `${plan} must read ${feature}`);
    assert.equal(entitlementDecision(entitlement(plan), feature, "POST").allowed, true, `${plan} must mutate ${feature}`);
  }
}

assert.equal(FEATURE_REQUIRED_PLAN[FEATURE.POS], "ENTERPRISE", "Advanced POS integrations should remain Enterprise");
assert.equal(entitlementDecision(entitlement("PROFESSIONAL"), FEATURE.POS, "GET").allowed, false, "Professional should still be denied advanced POS integrations");

const routeAndService = `${readFileSync("apps/api/src/routes/pos.js", "utf8")}\n${readFileSync("apps/api/src/services/posService.js", "utf8")}`;
assert.ok(routeAndService.includes("featureGuard(FEATURE.POS_REGISTER"), "POS route must use central feature guard");
assert.ok(routeAndService.includes("assertFeatureForRestaurant({ restaurantId, feature: FEATURE.POS_REGISTER"), "POS service must use central entitlement assertion");
assert.ok(!/plan(Code)?\s*={0,2}\s*["']STARTER/.test(routeAndService), "POS route/service must not hardcode a Starter bypass");

console.log("POS all-plan entitlement tests passed.");

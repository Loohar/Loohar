import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FEATURE,
  FEATURE_LABELS,
  FEATURE_ORDER,
  FEATURE_REQUIRED_PLAN,
  planAllowsFeature,
  planMatrixRows
} from "../apps/api/src/config/entitlements.js";

const matrix = planMatrixRows();
assert.equal(matrix.length, FEATURE_ORDER.length, "Plan matrix must include every ordered feature");

for (const row of matrix) {
  assert.ok(FEATURE_LABELS[row.feature], `${row.feature} needs a user-facing label`);
  assert.ok(FEATURE_REQUIRED_PLAN[row.feature], `${row.feature} needs a required plan`);
  assert.equal(row.starter, planAllowsFeature("STARTER", row.feature), `${row.feature} starter matrix mismatch`);
  assert.equal(row.professional, planAllowsFeature("PROFESSIONAL", row.feature), `${row.feature} professional matrix mismatch`);
  assert.equal(row.enterprise, true, `${row.feature} must be available on Enterprise`);
  if (row.starter) assert.equal(row.professional, true, `${row.feature} cannot disappear from Professional`);
  if (row.professional) assert.equal(row.enterprise, true, `${row.feature} cannot disappear from Enterprise`);
}

for (const feature of [
  FEATURE.RESTAURANT_ORDERING,
  FEATURE.PICKUP,
  FEATURE.ORDER_PAYMENTS,
  FEATURE.ORDER_TRACKING,
  FEATURE.FOOD_CATALOG,
  FEATURE.MENU_MANAGEMENT,
  FEATURE.BASIC_WEBSITE,
  FEATURE.BRANDING,
  FEATURE.BASIC_SETTINGS,
  FEATURE.ONBOARDING
]) {
  assert.equal(planAllowsFeature("STARTER", feature), true, `Starter should include ${feature}`);
}

for (const feature of [
  FEATURE.DELIVERY,
  FEATURE.DRIVER_MANAGEMENT,
  FEATURE.DISPATCH_CENTER,
  FEATURE.DELIVERY_ZONES,
  FEATURE.CUSTOMER_CRM,
  FEATURE.LOYALTY,
  FEATURE.COUPONS,
  FEATURE.KITCHEN_DISPLAY,
  FEATURE.PRINTING,
  FEATURE.NOTIFICATIONS,
  FEATURE.INVENTORY,
  FEATURE.STRIPE_CONNECT
]) {
  assert.equal(planAllowsFeature("STARTER", feature), false, `Starter should not include ${feature}`);
  assert.equal(planAllowsFeature("PROFESSIONAL", feature), true, `Professional should include ${feature}`);
}

for (const feature of [
  FEATURE.REPORTS,
  FEATURE.ANALYTICS,
  FEATURE.MENU_INSIGHTS,
  FEATURE.MULTI_LOCATION,
  FEATURE.WHITE_LABEL,
  FEATURE.CUSTOM_DOMAIN,
  FEATURE.ADVANCED_CRM,
  FEATURE.POS
]) {
  assert.equal(planAllowsFeature("PROFESSIONAL", feature), false, `Professional should not include Enterprise feature ${feature}`);
  assert.equal(planAllowsFeature("ENTERPRISE", feature), true, `Enterprise should include ${feature}`);
}

const billingService = readFileSync("apps/api/src/modules/platformBilling/platformBillingService.js", "utf8");
for (const envName of [
  "STRIPE_PLATFORM_STARTER_MONTHLY_PRICE_ID",
  "STRIPE_PLATFORM_STARTER_ANNUAL_PRICE_ID",
  "STRIPE_PLATFORM_PRO_MONTHLY_PRICE_ID",
  "STRIPE_PLATFORM_PRO_ANNUAL_PRICE_ID",
  "STRIPE_PLATFORM_ENTERPRISE_MONTHLY_PRICE_ID",
  "STRIPE_PLATFORM_ENTERPRISE_ANNUAL_PRICE_ID"
]) {
  assert.ok(billingService.includes(envName), `Stripe price mapping must include ${envName}`);
}

console.log("Plan tests passed.");

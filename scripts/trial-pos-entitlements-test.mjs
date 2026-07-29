import assert from "node:assert/strict";
import {
  entitlementDecision,
  FEATURE,
  subscriptionAccessForStatus
} from "../apps/api/src/config/entitlements.js";

const corePosFeatures = [
  FEATURE.POS_REGISTER,
  FEATURE.POS_KIOSK_MODE,
  FEATURE.POS_CASH_PAYMENTS,
  FEATURE.POS_SHIFTS,
  FEATURE.POS_RECEIPTS
];

function entitlement(overrides = {}) {
  return {
    planCode: "STARTER",
    subscriptionStatus: "TRIALING",
    enabledModules: [],
    ...overrides
  };
}

for (const planCode of ["STARTER", "PROFESSIONAL", "ENTERPRISE"]) {
  for (const feature of corePosFeatures) {
    const decision = entitlementDecision(entitlement({ planCode }), feature, "POST");
    assert.equal(decision.allowed, true, `${planCode} trial must allow ${feature}`);
    assert.equal(decision.subscriptionStatus, "TRIALING", `${planCode} trial status should remain TRIALING`);
  }
}

for (const fullAccessSource of ["COMPLIMENTARY", "MANUAL_INVOICE"]) {
  const decision = entitlementDecision(entitlement({
    subscriptionStatus: "ACTIVE",
    fullAccess: true,
    fullAccessSource
  }), FEATURE.POS_REGISTER, "POST");
  assert.equal(decision.allowed, true, `${fullAccessSource} account should retain POS register`);
  assert.equal(decision.fullAccessSource, fullAccessSource);
}

assert.equal(subscriptionAccessForStatus("TRIALING").mode, "FULL", "TRIALING must be a full operational subscription state");

const expiredTrial = entitlementDecision(entitlement({ subscriptionStatus: "CANCELLED" }), FEATURE.POS_REGISTER, "POST");
assert.equal(expiredTrial.allowed, false, "Expired/cancelled trial must not mutate POS");
assert.equal(expiredTrial.code, "SUBSCRIPTION_READ_ONLY");

const unpaidRead = entitlementDecision(entitlement({ subscriptionStatus: "UNPAID" }), FEATURE.POS_REGISTER, "GET");
assert.equal(unpaidRead.allowed, true, "UNPAID tenants may read POS state");
assert.ok(unpaidRead.warning, "UNPAID read should include warning context");

const unpaidWrite = entitlementDecision(entitlement({ subscriptionStatus: "UNPAID" }), FEATURE.POS_REGISTER, "POST");
assert.equal(unpaidWrite.allowed, false, "UNPAID tenants must not mutate POS");
assert.equal(unpaidWrite.code, "SUBSCRIPTION_READ_ONLY");

const suspended = entitlementDecision(entitlement({ subscriptionStatus: "SUSPENDED" }), FEATURE.POS_REGISTER, "GET");
assert.equal(suspended.allowed, false, "Suspended tenant cannot read POS");
assert.equal(suspended.code, "SUBSCRIPTION_SUSPENDED");

console.log("Trial POS entitlement tests passed.");

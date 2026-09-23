// A usage limit must never be reported as a missing feature.
//
//   node --test scripts/plan-limit-message-test.mjs
//
// The POS register is included on Starter. A restaurant using its one register and trying to add a
// second was told "POS register is not included in the current plan. Required plan: Professional."
// Both halves were false: the feature is included, and the remedy may be to retire a register
// rather than to pay more. This drives the real error the server builds, not a hand-written shape.
import assert from "node:assert/strict";
import { test } from "node:test";

const { usageLimitDecision } = await import("../apps/api/src/config/entitlements.js");
const { nextPlanRaisingLimit } = await import("../apps/shared/planEntitlements.js");
const { normalizedPosError } = await import("../apps/web/src/shared/posErrorMessage.js");

const OWNER = { role: "RESTAURANT_OWNER" };
const CASHIER = { role: "CASHIER" };

// Exactly what assertUsageWithinEntitlement throws, built from the server's own decision.
function serverRefusal({ planCode = "STARTER", limitCode = "POS_REGISTERS", used = 1 }) {
  const decision = usageLimitDecision({ entitlement: { planCode }, limitCode, used, requestedIncrement: 1 });
  assert.equal(decision.allowed, false, "this fixture must be a refusal");
  const error = new Error(decision.error);
  error.status = decision.status;
  error.payload = {
    code: decision.code,
    limitCode,
    limitLabel: decision.limitLabel,
    currentPlan: decision.currentPlan,
    used: decision.used,
    requestedIncrement: decision.requestedIncrement,
    maxAllowed: decision.maxAllowed,
    upgradeRequired: Boolean(decision.upgradeRequired)
  };
  return error;
}

test("a second register on Starter is not called a missing feature", () => {
  const shown = normalizedPosError(serverRefusal({}), OWNER);

  assert.doesNotMatch(shown.title, /not included/i, `still claims the feature is missing: ${shown.title}`);
  assert.doesNotMatch(`${shown.title} ${shown.detail}`, /Required plan/i, "a usage limit has no required plan");
  assert.match(shown.title, /POS registers limit reached/i, shown.title);
  assert.match(shown.title, /STARTER/, "it names the plan actually in force");
  assert.match(shown.detail, /includes 1\./, `it states the real allowance: ${shown.detail}`);
  assert.match(shown.detail, /1 in use/, shown.detail);
});

test("an upgrade is only offered when a higher plan would actually lift the limit", () => {
  const starter = normalizedPosError(serverRefusal({}), OWNER);
  assert.match(starter.detail, /upgrade to Professional/, starter.detail);
  assert.equal(starter.action, "Review subscription");

  // Professional already has unlimited registers, so no upgrade could raise it.
  assert.equal(nextPlanRaisingLimit("PROFESSIONAL", "POS_REGISTERS"), null);

  // Menu items do rise with the plan, so that refusal may legitimately suggest one.
  const menu = normalizedPosError(serverRefusal({ limitCode: "MENU_ITEMS", used: 50 }), OWNER);
  assert.match(menu.title, /Menu items limit reached/i, menu.title);
  assert.match(menu.detail, /upgrade to Professional/, menu.detail);
});

test("a cashier is not shown billing wording", () => {
  const shown = normalizedPosError(serverRefusal({}), CASHIER);
  assert.doesNotMatch(`${shown.title} ${shown.detail}`, /upgrade|plan|subscription/i, `${shown.title} ${shown.detail}`);
  assert.match(shown.detail, /manager/i);
});

test("a genuine feature gate is still reported as one, without inventing a plan", () => {
  const error = new Error("Feature not included in plan.");
  error.status = 403;
  error.payload = { code: "FEATURE_NOT_INCLUDED", featureLabel: "Delivery", currentPlan: "STARTER", requiredPlan: "PROFESSIONAL", upgradeRequired: true };
  const shown = normalizedPosError(error, OWNER);
  assert.match(shown.title, /Delivery is not included/i, shown.title);
  assert.match(shown.detail, /Required plan: PROFESSIONAL/, shown.detail);

  // When the server names no plan, the interface must not make one up.
  const vague = new Error("Feature not included in plan.");
  vague.status = 403;
  vague.payload = { code: "FEATURE_NOT_INCLUDED", currentPlan: "STARTER", upgradeRequired: true };
  const shownVague = normalizedPosError(vague, OWNER);
  assert.doesNotMatch(shownVague.detail, /Professional/, `invented a plan: ${shownVague.detail}`);
});

test("rate limiting is untouched by this change", () => {
  const error = new Error("429");
  error.status = 429;
  error.payload = { code: "RATE_LIMITED" };
  assert.match(normalizedPosError(error, OWNER).title, /too many requests/i);
});

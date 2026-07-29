import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("apps/api/src/services/posService.js", "utf8");
const app = readFileSync("apps/web/src/App.jsx", "utf8");

function sectionBetween(content, start, end) {
  const startIndex = content.indexOf(start);
  assert.notEqual(startIndex, -1, `${start} section is missing`);
  const endIndex = content.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${end} boundary is missing after ${start}`);
  return content.slice(startIndex, endIndex);
}

const cashSection = sectionBetween(service, "export async function cashPayment", "export async function cardPaymentIntent");
const cardSection = sectionBetween(service, "export async function cardPaymentIntent", "export async function registerPosDevice");

assert.ok(cashSection.includes("requireCashRegisterAccess"), "Cash POS must require register/device/shift readiness");
assert.ok(cashSection.includes('provider: "manual_cash"'), "Cash POS must use manual cash payment provider");
assert.ok(cashSection.includes('source: "POS_CASH"'), "Cash POS must record zero platform fee cash source");
assert.ok(!cashSection.includes("restaurantMerchantAccount"), "Cash POS must not require Stripe Connect merchant account");
assert.ok(!cashSection.includes("stripeChargesEnabled"), "Cash POS must not require Stripe charges");
assert.ok(!cashSection.includes("STRIPE_CONNECT"), "Cash POS must not use Stripe Connect provider");

assert.ok(cardSection.includes("restaurantMerchantAccount"), "Card POS must inspect restaurant merchant account");
assert.ok(cardSection.includes('provider: "STRIPE_CONNECT"'), "Card POS must use Stripe Connect provider");
assert.ok(cardSection.includes("stripeChargesEnabled"), "Card POS must require Stripe charges");
assert.ok(cardSection.includes("POS_CARD_MERCHANT_NOT_READY"), "Card POS must fail with merchant-not-ready state when Connect is absent");

assert.ok(app.includes("Your Loohar introductory program is active. No subscription payment is required today."), "Owner-facing trial billing copy must be product-safe");
assert.ok(app.includes("Connect your restaurant merchant account to accept online card payments and receive payouts."), "Merchant card payment copy must be distinct from Loohar SaaS billing");
const platformSecretEnvName = ["STRIPE", "PLATFORM", "SECRET", "KEY"].join("_");
assert.ok(!app.includes(platformSecretEnvName), "Restaurant owner UI must not expose platform billing env var names");

console.log("POS payment separation tests passed.");

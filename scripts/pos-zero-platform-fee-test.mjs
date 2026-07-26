import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const schema = readFileSync(join(root, "apps/api/prisma/schema.prisma"), "utf8");
const quoteService = readFileSync(join(root, "apps/api/src/modules/orderPayments/quoteService.js"), "utf8");
const paymentService = readFileSync(join(root, "apps/api/src/modules/orderPayments/orderPaymentService.js"), "utf8");
const posService = readFileSync(join(root, "apps/api/src/services/posService.js"), "utf8");
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const failures = [];

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function assertCheck(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

const requiredScripts = [
  "test:zero-platform-fee",
  "test:connected-account-routing",
  "test:payment-reporting"
];

assertCheck(requiredScripts.every((scriptName) => packageJson.scripts?.[scriptName]?.includes("pos-zero-platform-fee-test.mjs")), "Zero-platform-fee payment release scripts are registered");

if (mode === "all" || mode === "zero-fee") {
  assertCheck(includesAll(quoteService, [
    "ZERO_LOOHAR_PLATFORM_FEE_DISCLOSURE",
    "function platformFeeCents()",
    "return 0",
    "looharPlatformFeeCents: 0",
    "zeroLooharPlatformFee: true",
    "processorFeesMayApply: true",
    "paymentFeeDisclosure",
    "restaurantNetCents = restaurantGrossCents"
  ]), "Public order quotes always disclose zero Loohar platform fee while preserving processor-fee notice");
  assertCheck(includesAll(posService, [
    "ZERO_LOOHAR_PLATFORM_FEE_DISCLOSURE",
    "zeroPlatformFeeQuoteJson",
    "platformFeeCents: 0",
    "looharPlatformFeeCents: 0",
    "zeroLooharPlatformFee: true",
    "processorFeesMayApply: true"
  ]), "POS cash/card records store zero Loohar platform-fee quote metadata");
  assertCheck(includesAll(schema, [
    "platformFeeCents",
    "restaurantGrossCents",
    "restaurantNetCents",
    "quoteJson"
  ]), "Payment schema keeps fee, gross, net, and quote audit fields");
}

if (mode === "all" || mode === "connected-account-routing") {
  assertCheck(includesAll(paymentService, [
    "quote.platformFeeCents > 0 ? { application_fee_amount: quote.platformFeeCents } : {}",
    "...feeParams",
    "\"metadata[connectedAccountId]\": merchant.stripeAccountId",
    "stripeAccount: merchant.stripeAccountId"
  ]), "Stripe Connect payment intents charge directly on the restaurant connected account and omit app fees when zero");
  assertCheck(!paymentService.includes("\"transfer_data[destination]\"") && !paymentService.includes("transfer_data[destination]"), "Stripe destination-charge transfer data is not used for restaurant payments");
  assertCheck(includesAll(paymentService, [
    "merchantReady",
    "provider === \"STRIPE_CONNECT\"",
    "stripeChargesEnabled",
    "Complete Stripe Connect onboarding"
  ]), "Payments require a ready restaurant Stripe Connect merchant account");
}

if (mode === "all" || mode === "payment-reporting") {
  assertCheck(includesAll(paymentService, [
    "platformFeeCents: quote.platformFeeCents",
    "restaurantGrossCents: quote.restaurantGrossCents",
    "restaurantNetCents: quote.restaurantNetCents",
    "zeroLooharPlatformFee: quote.zeroLooharPlatformFee",
    "looharPlatformFeeCents: quote.looharPlatformFeeCents",
    "processorFeesMayApply: quote.processorFeesMayApply",
    "paymentFeeDisclosure: quote.paymentFeeDisclosure"
  ]), "Restaurant order payments persist zero-fee reporting fields from the quote");
  assertCheck(includesAll(posService, [
    "restaurantGrossCents: order.totalCents",
    "restaurantNetCents: order.totalCents",
    "quoteJson: zeroPlatformFeeQuoteJson",
    "paymentFeeDisclosure: ZERO_LOOHAR_PLATFORM_FEE_DISCLOSURE"
  ]), "POS cash/card reporting keeps restaurant gross and net equal when Loohar fee is zero");
  assertCheck(includesAll(app, [
    "No Loohar transaction fee",
    "processor fees may still apply",
    "looharPlatformFeeCents",
    "zeroLooharPlatformFee"
  ]), "Frontend exposes zero-platform-fee payment messaging and fields");
}

if (failures.length) {
  console.error(`pos-zero-platform-fee-test (${mode}) failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`pos-zero-platform-fee-test (${mode}) passed.`);

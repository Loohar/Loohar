import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyStripeWebhook } from "../apps/api/src/modules/paymentProviders/stripeRest.js";

const failures = [];
function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
}

function verificationError(options) {
  try {
    verifyStripeWebhook(options);
    return null;
  } catch (error) {
    return error;
  }
}

const secret = "whsec_static_test_only";
const rawBody = JSON.stringify({ id: "evt_static", type: "payment_intent.succeeded" });
const now = 1_900_000_000;
const sign = (timestamp, key = secret) => `t=${timestamp},v1=${crypto.createHmac("sha256", key).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;

assertCheck(verificationError({ rawBody, signatureHeader: sign(now), webhookSecret: secret, nowSeconds: now }) === null, "Correctly signed current event verifies");
assertCheck(verificationError({ rawBody, signatureHeader: sign(now), webhookSecret: "", nowSeconds: now })?.status === 503, "Missing webhook secret fails closed with 503");
assertCheck(verificationError({ rawBody, signatureHeader: sign(now, "whsec_other"), webhookSecret: secret, nowSeconds: now })?.status === 400, "Signature from a different secret is rejected");
assertCheck(/replay tolerance/.test(verificationError({ rawBody, signatureHeader: sign(now - 301), webhookSecret: secret, nowSeconds: now })?.message || ""), "Signed event older than five minutes is rejected");
assertCheck(/replay tolerance/.test(verificationError({ rawBody, signatureHeader: sign(now + 301), webhookSecret: secret, nowSeconds: now })?.message || ""), "Signed event from the future beyond tolerance is rejected");
assertCheck(verificationError({ rawBody, signatureHeader: sign(now - 299), webhookSecret: secret, nowSeconds: now }) === null, "Stripe retries inside the tolerance window still verify");

const legacyRoutes = readFileSync("apps/api/src/routes/payments.js", "utf8");
const orderService = readFileSync("apps/api/src/modules/orderPayments/orderPaymentService.js", "utf8");
const ledger = readFileSync("apps/api/src/modules/paymentProviders/stripeWebhookEvents.js", "utf8");
const platformBilling = readFileSync("apps/api/src/modules/platformBilling/platformBillingService.js", "utf8");

assertCheck(!legacyRoutes.includes("if (!webhookSecret) return;"), "Legacy webhook no longer skips verification when the secret is missing");
assertCheck(legacyRoutes.includes("verifyStripeWebhook({") && legacyRoutes.includes("webhookSecret: process.env.STRIPE_WEBHOOK_SECRET"), "Legacy webhook uses the shared fail-closed Stripe verifier");
assertCheck(!legacyRoutes.includes("createHmac"), "Legacy webhook has no private signature implementation");
assertCheck(legacyRoutes.includes("processStripeWebhookEventOnce(") && legacyRoutes.includes("providerEventId: `stripe_legacy:${payload.id}`"), "Legacy webhook events are deduplicated by Stripe event id in their own namespace");
assertCheck(legacyRoutes.includes('reason: "payment_already_settled"') && legacyRoutes.includes('reason: "payment_already_refunded"'), "Legacy webhook guards settled payments against repeated side effects");
assertCheck(orderService.includes("return processStripeWebhookEventOnce(eventRecord, () => applyStripeConnectEvent(") && !orderService.includes("restaurantPaymentEvent.upsert({\n    where: { providerEventId },"), "Stripe Connect webhook records events before processing and skips processed redeliveries");
assertCheck(orderService.includes('if (ORDER_PAYMENT_SETTLED_STATUSES.has(payment.status)) return { received: true, ignored: true, reason: "payment_already_settled" };'), "Stripe Connect webhook guards settled payments");
assertCheck(ledger.includes("processedAt: null") && ledger.includes("await completeStripeWebhookEvent(event, ledger, completionData(result));") && ledger.includes("if (event?.processedAt) return { event, duplicate: true };") && ledger.includes("STRIPE_EVENT_IN_PROGRESS"), "Events are marked processed only after side effects succeed");

assertCheck(platformBilling.includes("{ ledger: prisma.platformBillingEvent, completionData:") && !platformBilling.includes("platformBillingEvent.upsert("), "Platform billing webhook uses the event ledger and skips processed redeliveries");

if (failures.length) {
  console.error(`\n${failures.length} Stripe webhook hardening check(s) failed.`);
  process.exit(1);
}
console.log("\nStripe webhook hardening checks passed.");

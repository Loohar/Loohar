import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeSensitiveFields } from "../apps/api/src/utils/sanitize.js";

const root = process.cwd();
const failures = [];

function read(filePath) {
  const absolutePath = join(root, filePath);
  if (!existsSync(absolutePath)) {
    failures.push(`Missing required file: ${filePath}`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function sectionBetween(content, start, end) {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) return "";
  return content.slice(startIndex, endIndex);
}

function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
    return;
  }
  failures.push(message);
  console.error(`FAIL ${message}`);
}

const orderPaymentRoutes = read("apps/api/src/routes/orderPayments.js");
const orderPaymentService = read("apps/api/src/modules/orderPayments/orderPaymentService.js");
const customerRoutes = read("apps/api/src/routes/customer.js");
const orderWorkflow = read("apps/api/src/services/orderWorkflowService.js");
const sanitizer = read("apps/api/src/utils/sanitize.js");
const realtimeService = read("apps/api/src/services/realtimeService.js");
const app = read("apps/web/src/App.jsx");

const publicStatusSection = sectionBetween(orderPaymentService, "export async function publicStatusForOrder", "export async function receiptForOrder");
const publicReceiptSection = sectionBetween(orderPaymentService, "export async function publicReceiptForOrder", "export async function handleStripeConnectWebhook");
const publicPaymentSection = sectionBetween(orderPaymentService, "export function publicOrderPaymentStatus", "export async function getMerchantAccount");
const customerStatusSection = sectionBetween(customerRoutes, "export async function getOrderStatus", 'router.get("/orders/:orderId/status"');

assertCheck(orderWorkflow.includes("createTrackingToken") && orderWorkflow.includes("hashToken") && orderWorkflow.includes("trackingTokenHash"), "Tracking tokens are server-generated and hash-stored");
assertCheck(orderPaymentService.includes("trackingTokenHash: hashToken(initialTrackingToken)") && orderPaymentService.includes("tracking: { token: trackingToken, ...customerTrackingUrls(order, trackingToken) }") && orderPaymentService.includes("trackingToken: initialTrackingToken"), "Checkout creation stores a hashed token and returns the one-time customer token");
assertCheck(orderPaymentService.includes("providerClientSecret: intent.client_secret || null") && orderPaymentService.includes("clientSecret: payment.providerClientSecret || null"), "Checkout creation still returns the Stripe one-time client secret");

assertCheck(orderPaymentRoutes.includes("publicStatusForOrder") && orderPaymentRoutes.includes("publicReceiptForOrder"), "Public order-payment routes use token-gated public handlers");
assertCheck(orderPaymentRoutes.includes("authenticateAccessToken") && orderPaymentRoutes.includes("statusForOrder({ orderId: req.params.orderId, user: access.user })"), "Authenticated restaurant status access goes through bearer auth");
assertCheck(orderPaymentRoutes.includes("receiptForOrder({ orderId: req.params.orderId, user: access.user })"), "Authenticated restaurant receipt access goes through bearer auth");
assertCheck(!orderPaymentRoutes.includes("statusForOrder({ orderId: req.params.orderId })") && !orderPaymentRoutes.includes("receiptForOrder({ orderId: req.params.orderId })"), "Order-payment status and receipt no longer read by bare order ID");

assertCheck(publicStatusSection.includes("findOrderForTracking(orderId, token)") && publicStatusSection.includes("ORDER_ACCESS_TOKEN_REQUIRED"), "Public order-payment status requires a valid tracking token");
assertCheck(publicStatusSection.includes("limitedTrackingOrder(order)") && publicStatusSection.includes("publicOrderPaymentStatus"), "Public order-payment status returns limited customer-facing order and payment fields");
assertCheck(publicReceiptSection.includes("findOrderForTracking(orderId, token)") && publicReceiptSection.includes("buildReceiptPayload(order, { kind: \"customer\", trackingToken: token })"), "Public order-payment receipt requires token proof and returns customer receipt payload");
assertCheck(!publicPaymentSection.includes("providerClientSecret") && !publicPaymentSection.includes("providerPaymentIntentId") && !publicPaymentSection.includes("providerChargeId"), "Public payment status omits provider secrets and provider identifiers");

assertCheck(orderPaymentService.includes("\"SUPER_ADMIN\"") && orderPaymentService.includes("\"TENANT_OWNER\"") && orderPaymentService.includes("\"CASHIER\""), "Owner, manager, cashier, and super-admin order-payment readers remain authorized");
assertCheck(orderPaymentService.includes("if (!canReadOrderPayment(user, order)) throw accessError(\"Order access denied\", 403, \"ORDER_ACCESS_DENIED\")"), "Authenticated order-payment access enforces tenant authorization");

assertCheck(customerStatusSection.includes("findOrderForTracking(req.params.orderId, token)") && customerStatusSection.includes("ORDER_ACCESS_TOKEN_REQUIRED"), "Customer/public status route requires token proof when no authenticated session is supplied");
assertCheck(customerStatusSection.includes("authenticateAccessToken(bearerToken)") && customerStatusSection.includes("canReadCustomerOrderStatus(user, order)"), "Signed-in customer history refresh still uses authenticated access");
assertCheck(!customerStatusSection.includes("res.json({ order: limitedTrackingOrder(order) });") || customerStatusSection.includes("canReadCustomerOrderStatus(user, order)"), "Customer status fallback is authorization-gated");

assertCheck(sanitizer.includes("\"providerClientSecret\""), "Global response sanitizer removes persisted provider client secrets");
assertCheck(sanitizer.includes("\"client_secret\""), "Global response sanitizer removes raw provider client_secret values");
const sanitized = sanitizeSensitiveFields({
  order: { trackingTokenHash: "hash" },
  payment: {
    providerClientSecret: "redacted-provider-client-value",
    client_secret: "redacted-raw-provider-value",
    providerPaymentIntentId: "redacted-provider-intent-id"
  },
  clientSecret: "redacted-checkout-client-value"
});
assertCheck(!Object.prototype.hasOwnProperty.call(sanitized.order, "trackingTokenHash"), "Tracking token hash is removed from serialized responses");
assertCheck(!Object.prototype.hasOwnProperty.call(sanitized.payment, "providerClientSecret"), "Persisted provider client secret is removed from serialized responses");
assertCheck(!Object.prototype.hasOwnProperty.call(sanitized.payment, "client_secret"), "Raw provider client_secret is removed from serialized responses");
assertCheck(sanitized.clientSecret === "redacted-checkout-client-value", "Checkout clientSecret response remains available for Stripe.js handoff");

assertCheck(!realtimeService.includes("providerClientSecret"), "Realtime and KDS payloads do not include persisted provider client secrets");
assertCheck(app.includes("trackingToken ? { skipAuth: true } : {}") && app.includes("payload.order?.totals?.totalCents"), "Customer tracking refresh carries token proof without attaching session auth and preserves total display");

if (failures.length) {
  console.error(`order-payment-public-access failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("order-payment-public-access passed.");

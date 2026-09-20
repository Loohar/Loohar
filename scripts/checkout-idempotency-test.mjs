import { readFileSync } from "node:fs";
import {
  checkoutIdempotencyKeyHash,
  checkoutRequestHash,
  checkoutTrackingToken,
  isStripeIdempotencyInProgress,
  isUniqueConflictOn,
  normalizeCheckoutIdempotencyKey,
  orderPaymentIntentIdempotencyKey
} from "../apps/api/src/modules/orderPayments/checkoutIdempotency.js";

const failures = [];

function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
}

function errorCode(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.code;
  }
}

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const read = (path) => readFileSync(path, "utf8");
const orderService = read("apps/api/src/modules/orderPayments/orderPaymentService.js");
const orderRoutes = read("apps/api/src/routes/orderPayments.js");
const schema = read("apps/api/prisma/schema.prisma");
const migration = read("apps/api/prisma/migrations/20260916090000_checkout_idempotency/migration.sql");
const app = read("apps/web/src/App.jsx");
const sanitizer = read("apps/api/src/utils/sanitize.js");

// Key validation
assertCheck(errorCode(() => normalizeCheckoutIdempotencyKey("")) === "CHECKOUT_IDEMPOTENCY_KEY_REQUIRED", "Missing checkout Idempotency-Key is rejected");
assertCheck(errorCode(() => normalizeCheckoutIdempotencyKey("short")) === "CHECKOUT_IDEMPOTENCY_KEY_INVALID", "Too-short checkout Idempotency-Key is rejected");
assertCheck(errorCode(() => normalizeCheckoutIdempotencyKey("bad key with spaces!!")) === "CHECKOUT_IDEMPOTENCY_KEY_INVALID", "Checkout Idempotency-Key with unsafe characters is rejected");
assertCheck(normalizeCheckoutIdempotencyKey(" checkout-6f1c2a4e-9b7d-4c1e-8a55-0d3f2b9e7c11 ") === "checkout-6f1c2a4e-9b7d-4c1e-8a55-0d3f2b9e7c11", "Browser-generated checkout key is accepted and trimmed");

// Hashing and tenant scoping
const key = "checkout-6f1c2a4e-9b7d-4c1e-8a55-0d3f2b9e7c11";
const hashA = checkoutIdempotencyKeyHash({ restaurantId: "restaurant-a", idempotencyKey: key });
const hashB = checkoutIdempotencyKeyHash({ restaurantId: "restaurant-b", idempotencyKey: key });
assertCheck(hashA !== hashB, "The same client key is scoped per restaurant");
assertCheck(/^[a-f0-9]{64}$/.test(hashA) && !hashA.includes(key), "Only a SHA-256 hash of the key is stored");
assertCheck(
  checkoutRequestHash({ b: 1, a: { d: [1, 2], c: "x" }, skip: undefined }) === checkoutRequestHash({ a: { c: "x", d: [1, 2] }, b: 1 }),
  "Request fingerprint is stable across key order and undefined fields"
);
assertCheck(checkoutRequestHash({ items: [{ quantity: 1 }] }) !== checkoutRequestHash({ items: [{ quantity: 2 }] }), "Request fingerprint changes when the cart changes");

// Tracking token derivation
const env = { JWT_SECRET: "test-secret-one" };
const tokenA = checkoutTrackingToken({ keyHash: hashA, env });
assertCheck(tokenA === checkoutTrackingToken({ keyHash: hashA, env }), "Replay derives the same tracking token");
assertCheck(tokenA !== checkoutTrackingToken({ keyHash: hashB, env }), "Different checkout attempts derive different tracking tokens");
assertCheck(tokenA !== checkoutTrackingToken({ keyHash: hashA, env: { JWT_SECRET: "test-secret-two" } }), "Tracking token depends on the server secret");
assertCheck(/^[A-Za-z0-9_-]{43}$/.test(tokenA), "Tracking token has 256 bits of URL-safe entropy");
assertCheck(throws(() => checkoutTrackingToken({ keyHash: hashA, env: { NODE_ENV: "production" } })), "Production refuses to derive tracking tokens without a server secret");

// Error classification
assertCheck(orderPaymentIntentIdempotencyKey("pay_123") === "loohar:order-payment-intent:v1:pay_123", "Stripe PaymentIntent idempotency key is bound to the payment row");
assertCheck(isUniqueConflictOn({ code: "P2002", meta: { target: ["checkoutIdempotencyKeyHash"] } }, "checkoutIdempotencyKeyHash"), "Prisma array targets are classified");
assertCheck(isUniqueConflictOn({ code: "P2002", meta: { target: "Order_restaurantId_orderNumber_key" } }, "orderNumber"), "Prisma index-name targets are classified");
assertCheck(!isUniqueConflictOn({ code: "P2025", meta: { target: ["orderNumber"] } }, "orderNumber"), "Non-unique Prisma errors are not treated as conflicts");
assertCheck(isStripeIdempotencyInProgress({ status: 409 }) && !isStripeIdempotencyInProgress({ status: 402 }), "Only Stripe in-progress conflicts are non-terminal");

// Wiring
assertCheck(sanitizer.includes('"checkoutIdempotencyKeyHash"') && sanitizer.includes('"checkoutRequestHash"'), "Checkout idempotency hashes are stripped from API responses");
assertCheck(orderRoutes.includes("createOrderPayment({ body: req.body, idempotencyKey: req.get(CHECKOUT_IDEMPOTENCY_HEADER) })"), "Checkout route forwards the Idempotency-Key header to the service");
assertCheck(schema.includes("checkoutIdempotencyKeyHash String?            @unique") && schema.includes("checkoutRequestHash        String?"), "Payment rows carry a unique checkout key hash and request fingerprint");
assertCheck(migration.includes('ADD COLUMN IF NOT EXISTS "checkoutIdempotencyKeyHash" TEXT') && migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantOrderPayment_checkoutIdempotencyKeyHash_key"'), "Migration is additive with a unique index");
assertCheck(!/DROP|DELETE|UPDATE /i.test(migration), "Migration does not drop, delete, or rewrite data");
assertCheck(orderService.includes("checkoutIdempotencyKeyHash: keyHash,") && orderService.includes("checkoutRequestHash: requestHash,"), "Key hash is written in the same transaction as the order and payment");
assertCheck(orderService.includes("idempotencyKey: idempotencyKey || orderPaymentIntentIdempotencyKey(payment.id)"), "PaymentIntent creation sends a Stripe idempotency key, defaulting to the per-payment key");
assertCheck(orderService.includes("orderPaymentIntentReplacementIdempotencyKey(payment.id, intent.id)"), "A replacement PaymentIntent uses its own key derived from the intent it replaces (L-13)");
assertCheck(orderService.includes("createStripePaymentIntent({ quote: paymentIntentAmounts(payment), order, payment, merchant })"), "PaymentIntent amounts come from the persisted server-side payment row");
assertCheck(orderService.includes("if (existing.checkoutRequestHash !== requestHash) throw checkoutKeyReusedError();"), "Reusing a key for a different cart is rejected");
assertCheck(orderService.includes("if (isStripeIdempotencyInProgress(error)) throw checkoutInProgressError();"), "Concurrent Stripe idempotency conflicts do not cancel the order");
assertCheck(!/body\.(totalCents|subtotalCents|taxCents|unitPriceCents|priceCents)/.test(orderService), "Checkout service never reads client monetary fields");
assertCheck(app.includes('headers: { "Idempotency-Key": checkoutAttemptRef.current.key }') && app.includes("if (placingOrderRef.current) return;"), "Customer checkout sends a stable key and blocks double submission");
assertCheck(app.includes("checkoutAttemptRef.current?.fingerprint !== fingerprint"), "Customer checkout rotates the key only when the cart or details change");

if (failures.length) {
  console.error(`\n${failures.length} checkout idempotency check(s) failed.`);
  process.exit(1);
}
console.log("\nCheckout idempotency checks passed.");

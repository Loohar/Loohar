// Database-backed concurrency test for checkout idempotency.
// Requires a DISPOSABLE local PostgreSQL database with migrations applied:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --experimental-test-module-mocks scripts/checkout-idempotency-db-test.mjs
// Stripe is replaced by an in-process fake; no network calls are made.
import assert from "node:assert/strict";
import { mock, test, after } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP checkout idempotency DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}

process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = databaseUrl;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "local-checkout-idempotency-test-secret";
process.env.STRIPE_CONNECT_SECRET_KEY = "sk_test_local_fake_checkout_idempotency";

// Fake Stripe with real idempotency semantics: same key returns the same object, and a key
// that is still in flight answers 409 like Stripe does.
const stripe = { intents: new Map(), inFlight: new Set(), createCalls: 0, failKeys: new Set(), conflictOnce: new Set() };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).startsWith("https://api.stripe.com/v1/payment_intents")) return realFetch(url, options);
  const key = options.headers?.["Idempotency-Key"];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (!key) return json(400, { error: { message: "test fake requires idempotency" } });
  const params = new URLSearchParams(options.body);
  if (stripe.failKeys.has(params.get("metadata[restaurantId]"))) {
    return json(402, { error: { type: "card_error", message: "Simulated Stripe failure" } });
  }
  if (stripe.conflictOnce.has(params.get("metadata[restaurantId]"))) {
    stripe.conflictOnce.delete(params.get("metadata[restaurantId]"));
    return json(409, { error: { type: "idempotency_error", code: "idempotency_key_in_use", message: "in progress" } });
  }
  if (stripe.intents.has(key)) return json(200, stripe.intents.get(key));
  if (stripe.inFlight.has(key)) return json(409, { error: { type: "idempotency_error", code: "idempotency_key_in_use", message: "in progress" } });
  stripe.inFlight.add(key);
  await new Promise((resolve) => setTimeout(resolve, 40));
  stripe.createCalls += 1;
  const intent = { id: `pi_test_${stripe.createCalls}`, client_secret: `pi_test_${stripe.createCalls}_secret_fake`, status: "requires_payment_method", amount: Number(params.get("amount")) };
  stripe.intents.set(key, intent);
  stripe.inFlight.delete(key);
  return json(200, intent);
};

// Server-side quote stand-in: pricing authority is certified separately by the L-02 suite.
mock.module(new URL("../apps/api/src/modules/orderPayments/quoteService.js", import.meta.url).href, {
  namedExports: {
    calculateOrderQuote: async ({ restaurantId, body }) => {
      const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, include: { locations: true } });
      const quantity = body.items.reduce((sum, item) => sum + item.quantity, 0);
      const subtotalCents = 1250 * quantity;
      const taxCents = Math.round(subtotalCents * 0.08);
      return {
        restaurant,
        locationId: restaurant.locations[0].id,
        currency: "usd",
        items: body.items.map((item) => ({ menuItemId: item.menuItemId, name: "Test item", quantity: item.quantity, unitPriceCents: 1250 })),
        subtotalCents, discountCents: 0, couponCode: null, deliveryFeeCents: 0, taxCents, taxableAmountCents: subtotalCents,
        tipCents: 0, restaurantTipCents: 0, driverTipCents: 0, customTipCents: 0, tipPercentage: null, tipType: "NONE",
        serviceFeeCents: 0, totalCents: subtotalCents + taxCents, platformFeeCents: 0,
        restaurantGrossCents: subtotalCents + taxCents, restaurantNetCents: subtotalCents + taxCents,
        breakdown: {}, taxRateBps: 800, taxInclusive: false, taxProfileId: null, taxConfigurationVersion: "test-v1",
        zeroLooharPlatformFee: true, looharPlatformFeeCents: 0, processorFeesMayApply: true, paymentFeeDisclosure: "test",
        taxConfiguration: { provider: "TEST", source: "TEST", jurisdictionCode: "TEST", jurisdictionMetadata: {}, effectiveAt: null, verifiedAt: null }
      };
    }
  }
});

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { createOrderPayment } = await import("../apps/api/src/modules/orderPayments/orderPaymentService.js");
const { hashToken } = await import("../apps/api/src/services/orderWorkflowService.js");

const runId = `l03${Date.now().toString(36)}`;
async function seedRestaurant(label) {
  const restaurant = await prisma.restaurant.create({
    data: { name: `L03 ${label}`, slug: `${runId}-${label}`, status: "ACTIVE", locations: { create: { name: "Main" } } }
  });
  await prisma.restaurantMerchantAccount.create({
    data: { restaurantId: restaurant.id, provider: "STRIPE_CONNECT", status: "ENABLED", stripeAccountId: `acct_test_${runId}_${label}`, stripeChargesEnabled: true }
  });
  const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Mains" } });
  const menuItem = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: "Test item", priceCents: 1250 } });
  return { ...restaurant, menuItemId: menuItem.id };
}

const bodyFor = (restaurant, overrides = {}) => ({
  restaurantId: restaurant.id,
  type: "PICKUP",
  items: [{ menuItemId: restaurant.menuItemId, quantity: 2 }],
  customer: { name: "Pilot Tester", email: `pilot-${runId}@example.test` },
  ...overrides
});
const keyFor = (label) => `checkout-${runId}-${label}-0000000000`;
const ordersFor = (restaurant) => prisma.order.count({ where: { restaurantId: restaurant.id } });
const outcome = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code, status: error.status }));

const restaurantA = await seedRestaurant("a");
const restaurantB = await seedRestaurant("b");

after(async () => {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
});

test("missing key is rejected before any order is created", async () => {
  const result = await outcome(createOrderPayment({ body: bodyFor(restaurantA), idempotencyKey: undefined }));
  assert.equal(result.code, "CHECKOUT_IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await ordersFor(restaurantA), 0);
});

test("sequential retry replays the original order, PaymentIntent, and tracking token", async () => {
  const body = bodyFor(restaurantA);
  const first = await createOrderPayment({ body, idempotencyKey: keyFor("seq") });
  const second = await createOrderPayment({ body, idempotencyKey: keyFor("seq") });
  assert.equal(first.checkout.idempotentReplay, false);
  assert.equal(second.checkout.idempotentReplay, true);
  assert.equal(second.order.id, first.order.id);
  assert.equal(second.payment.providerPaymentIntentId, first.payment.providerPaymentIntentId);
  assert.equal(second.clientSecret, first.clientSecret);
  assert.equal(second.tracking.token, first.tracking.token);
  const stored = await prisma.order.findUnique({ where: { id: first.order.id } });
  assert.equal(stored.trackingTokenHash, hashToken(first.tracking.token));
  assert.equal(await ordersFor(restaurantA), 1);
});

test("ten concurrent submissions with one key create exactly one order and one PaymentIntent", async () => {
  const body = bodyFor(restaurantA, { items: [{ menuItemId: restaurantA.menuItemId, quantity: 3 }] });
  const before = await ordersFor(restaurantA);
  const callsBefore = stripe.createCalls;
  const results = await Promise.all(Array.from({ length: 10 }, () => outcome(createOrderPayment({ body, idempotencyKey: keyFor("burst") }))));
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  assert.ok(successes.length >= 1, "at least one request succeeds");
  assert.ok(failures.every((result) => result.code === "CHECKOUT_IN_PROGRESS"), `only in-progress conflicts are allowed: ${JSON.stringify(failures)}`);
  assert.equal(new Set(successes.map((result) => result.value.order.id)).size, 1);
  assert.equal(await ordersFor(restaurantA), before + 1);
  assert.equal(stripe.createCalls - callsBefore, 1);
  const retry = await createOrderPayment({ body, idempotencyKey: keyFor("burst") });
  assert.equal(retry.order.id, successes[0].value.order.id);
  assert.equal(await prisma.restaurantOrderPayment.count({ where: { orderId: retry.order.id } }), 1);
});

test("reusing a key for a different cart is rejected without creating an order", async () => {
  await createOrderPayment({ body: bodyFor(restaurantA, { notes: "original" }), idempotencyKey: keyFor("reuse") });
  const before = await ordersFor(restaurantA);
  const result = await outcome(createOrderPayment({ body: bodyFor(restaurantA, { notes: "changed" }), idempotencyKey: keyFor("reuse") }));
  assert.equal(result.code, "CHECKOUT_IDEMPOTENCY_KEY_REUSED");
  assert.equal(await ordersFor(restaurantA), before);
});

test("distinct keys with the same new customer email succeed concurrently", async () => {
  const email = `concurrent-${runId}@example.test`;
  const before = await ordersFor(restaurantA);
  const results = await Promise.all(Array.from({ length: 5 }, (_, index) => outcome(createOrderPayment({
    body: bodyFor(restaurantA, { customer: { name: "Concurrent Customer", email } }),
    idempotencyKey: keyFor(`distinct${index}`)
  }))));
  assert.ok(results.every((result) => result.ok), JSON.stringify(results.filter((result) => !result.ok)));
  assert.equal(await ordersFor(restaurantA), before + 5);
  assert.equal(await prisma.customer.count({ where: { restaurantId: restaurantA.id, email } }), 1);
});

test("the same client key is isolated per restaurant", async () => {
  const onA = await createOrderPayment({ body: bodyFor(restaurantA), idempotencyKey: keyFor("tenant") });
  const onB = await createOrderPayment({ body: bodyFor(restaurantB), idempotencyKey: keyFor("tenant") });
  assert.notEqual(onA.order.id, onB.order.id);
  assert.equal(onB.order.restaurantId, restaurantB.id);
  assert.equal(onB.checkout.idempotentReplay, false);
  assert.notEqual(onA.tracking.token, onB.tracking.token);
});

test("a Stripe in-progress conflict leaves the order intact and a retry completes it", async () => {
  stripe.conflictOnce.add(restaurantB.id);
  const body = bodyFor(restaurantB, { notes: "conflict" });
  const first = await outcome(createOrderPayment({ body, idempotencyKey: keyFor("conflict") }));
  assert.equal(first.code, "CHECKOUT_IN_PROGRESS");
  const pending = await prisma.restaurantOrderPayment.findFirst({ where: { restaurantId: restaurantB.id, providerPaymentIntentId: null, status: { not: "FAILED" } } });
  assert.ok(pending, "payment row survives without a PaymentIntent");
  const retry = await createOrderPayment({ body, idempotencyKey: keyFor("conflict") });
  assert.equal(retry.order.id, pending.orderId);
  assert.ok(retry.payment.providerPaymentIntentId);
  assert.equal(retry.order.status, "PENDING");
});

test("a terminal PaymentIntent failure cancels once and replays as a failed attempt", async () => {
  const restaurantC = await seedRestaurant("c");
  stripe.failKeys.add(restaurantC.id);
  const body = bodyFor(restaurantC);
  const first = await outcome(createOrderPayment({ body, idempotencyKey: keyFor("fail") }));
  assert.equal(first.status, 402);
  const orders = await prisma.order.findMany({ where: { restaurantId: restaurantC.id }, include: { restaurantOrderPayment: true } });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, "CANCELLED");
  assert.equal(orders[0].restaurantOrderPayment.status, "FAILED");
  const retry = await outcome(createOrderPayment({ body, idempotencyKey: keyFor("fail") }));
  assert.equal(retry.code, "CHECKOUT_ATTEMPT_FAILED");
  assert.equal(await ordersFor(restaurantC), 1);
  stripe.failKeys.delete(restaurantC.id);
});

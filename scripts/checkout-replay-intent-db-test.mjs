// L-13: a checkout replay must never hand the customer a PaymentIntent that cannot be paid.
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --experimental-test-module-mocks scripts/checkout-replay-intent-db-test.mjs
//
// Stripe is an in-process fake supporting create, retrieve and cancel; no network calls are made.
// Before this fix, a replay returned the stored client secret without asking Stripe about it, so a
// customer retrying checkout against a cancelled intent could only fail, and one retrying after the
// payment had already succeeded was invited to confirm a second time.
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
  console.log("SKIP checkout replay intent DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}

process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = databaseUrl;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "local-checkout-replay-test-secret";
process.env.STRIPE_CONNECT_SECRET_KEY = "sk_test_local_fake_checkout_replay";

const STRIPE_INTENTS = "https://api.stripe.com/v1/payment_intents";
const stripe = { byId: new Map(), byKey: new Map(), creates: 0, cancels: [], retrieveFails: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (!target.startsWith(STRIPE_INTENTS)) return realFetch(url, options);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const path = target.slice(STRIPE_INTENTS.length);
  const method = options.method || "POST";

  if (method === "GET") {
    if (stripe.retrieveFails) return json(500, { error: { message: "simulated Stripe outage" } });
    const intent = stripe.byId.get(path.replace(/^\//, ""));
    return intent ? json(200, { ...intent }) : json(404, { error: { message: "No such payment_intent" } });
  }
  if (path.endsWith("/cancel")) {
    const intent = stripe.byId.get(path.slice(1).replace(/\/cancel$/, ""));
    if (!intent) return json(404, { error: { message: "No such payment_intent" } });
    intent.status = "canceled";
    stripe.cancels.push(intent.id);
    return json(200, { ...intent });
  }
  const key = options.headers?.["Idempotency-Key"];
  if (!key) return json(400, { error: { message: "the fake requires an idempotency key on create" } });
  if (stripe.byKey.has(key)) return json(200, { ...stripe.byKey.get(key) });
  stripe.creates += 1;
  const intent = {
    id: `pi_fake_${stripe.creates}`,
    client_secret: `pi_fake_${stripe.creates}_secret`,
    status: "requires_payment_method",
    amount: Number(new URLSearchParams(options.body).get("amount"))
  };
  stripe.byId.set(intent.id, intent);
  stripe.byKey.set(key, intent);
  return json(200, { ...intent });
};

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

const runId = `l13${Date.now().toString(36)}`;
async function seedRestaurant(label) {
  const restaurant = await prisma.restaurant.create({
    data: { name: `L13 ${label}`, slug: `${runId}-${label}`, status: "ACTIVE", locations: { create: { name: "Main" } } }
  });
  await prisma.restaurantMerchantAccount.create({
    data: { restaurantId: restaurant.id, provider: "STRIPE_CONNECT", status: "ENABLED", stripeAccountId: `acct_${runId}_${label}`, stripeChargesEnabled: true }
  });
  const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Mains" } });
  const menuItem = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: "Test item", priceCents: 1250 } });
  return { ...restaurant, menuItemId: menuItem.id };
}
const bodyFor = (restaurant) => ({
  restaurantId: restaurant.id,
  type: "PICKUP",
  items: [{ menuItemId: restaurant.menuItemId, quantity: 2 }],
  customer: { name: "Replay Tester", email: `replay-${runId}@example.test` }
});
const keyFor = (label) => `checkout-${runId}-${label}-0000000000`;

// Each case gets its own restaurant so one case cannot disturb another.
async function startCheckout(label) {
  const restaurant = await seedRestaurant(label);
  const body = bodyFor(restaurant);
  const key = keyFor(label);
  const first = await createOrderPayment({ body, idempotencyKey: key });
  return { restaurant, body, key, first, replay: () => createOrderPayment({ body, idempotencyKey: key }) };
}
const auditCount = (restaurantId) => prisma.auditLog.count({ where: { restaurantId, action: "order_payment.intent.replaced" } });

after(async () => {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
});

test("a replay of a cancelled PaymentIntent returns a usable replacement", async () => {
  const { restaurant, first, replay } = await startCheckout("cancelled");
  const original = first.payment.providerPaymentIntentId;
  stripe.byId.get(original).status = "canceled";
  const creates = stripe.creates;

  const second = await replay();
  assert.equal(second.checkout.idempotentReplay, true);
  assert.equal(second.order.id, first.order.id, "the same order is kept");
  assert.notEqual(second.payment.providerPaymentIntentId, original, "a dead intent is not handed back");
  assert.equal(stripe.creates, creates + 1, "exactly one replacement is created");
  assert.equal(second.clientSecret, stripe.byId.get(second.payment.providerPaymentIntentId).client_secret);
  assert.equal(stripe.byId.get(second.payment.providerPaymentIntentId).amount, 2700, "the replacement charges the server total, not a client amount");

  const stored = await prisma.restaurantOrderPayment.findUnique({ where: { id: second.payment.id } });
  assert.equal(stored.providerPaymentIntentId, second.payment.providerPaymentIntentId);
  assert.equal(stored.totalCents, 2700, "the payment row total never changes");
  assert.equal(await auditCount(restaurant.id), 1, "the replacement is audited");
});

test("concurrent replays of the same dead intent create one replacement, not two", async () => {
  const { first, replay } = await startCheckout("concurrent");
  stripe.byId.get(first.payment.providerPaymentIntentId).status = "canceled";
  const creates = stripe.creates;

  const [a, b] = await Promise.all([replay(), replay()]);
  assert.equal(stripe.creates, creates + 1, "the replacement key is deterministic, so Stripe returns one intent");
  assert.equal(a.payment.providerPaymentIntentId, b.payment.providerPaymentIntentId);
  assert.notEqual(a.payment.providerPaymentIntentId, first.payment.providerPaymentIntentId);
});

test("a replay after the payment already succeeded offers no client secret to confirm again", async () => {
  const { restaurant, first, replay } = await startCheckout("succeeded");
  stripe.byId.get(first.payment.providerPaymentIntentId).status = "succeeded";
  const creates = stripe.creates;

  const second = await replay();
  assert.equal(second.clientSecret, null, "never invite a second confirmation");
  assert.equal(second.payment.providerPaymentIntentId, first.payment.providerPaymentIntentId, "the paid intent is kept");
  assert.equal(stripe.creates, creates, "money is never re-created");
  assert.equal(await auditCount(restaurant.id), 0);
});

test("a replay of a healthy intent is unchanged", async () => {
  const { first, replay } = await startCheckout("healthy");
  const creates = stripe.creates;
  const second = await replay();
  assert.equal(second.payment.providerPaymentIntentId, first.payment.providerPaymentIntentId);
  assert.equal(second.clientSecret, first.clientSecret);
  assert.equal(stripe.creates, creates);
});

test("a live intent for the wrong amount is cancelled and replaced", async () => {
  const { first, replay } = await startCheckout("amount");
  const original = first.payment.providerPaymentIntentId;
  stripe.byId.get(original).amount = 9999;
  const creates = stripe.creates;

  const second = await replay();
  assert.ok(stripe.cancels.includes(original), "the wrong-amount intent is closed so it cannot be paid");
  assert.equal(stripe.byId.get(original).status, "canceled");
  assert.notEqual(second.payment.providerPaymentIntentId, original);
  assert.equal(stripe.creates, creates + 1);
  assert.equal(stripe.byId.get(second.payment.providerPaymentIntentId).amount, 2700);
});

test("when Stripe cannot be reached the replay still returns the stored secret", async () => {
  const { first, replay } = await startCheckout("outage");
  const creates = stripe.creates;
  stripe.retrieveFails = true;
  try {
    const second = await replay();
    assert.equal(second.payment.providerPaymentIntentId, first.payment.providerPaymentIntentId);
    assert.equal(second.clientSecret, first.clientSecret);
    assert.equal(stripe.creates, creates, "an outage must not create a second intent");
  } finally {
    stripe.retrieveFails = false;
  }
});

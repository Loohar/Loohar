// Database-backed test for restaurant order refunds: idempotency, remaining-balance caps under
// concurrency, connected-account routing, and tenant checks. Requires a DISPOSABLE local
// PostgreSQL database with migrations applied:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/refund-idempotency-db-test.mjs
// Stripe is replaced by an in-process fake; no network calls are made.
import assert from "node:assert/strict";
import { after, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP refund idempotency DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  JWT_SECRET: "local-refund-test-secret",
  STRIPE_CONNECT_SECRET_KEY: "sk_test_local_fake_refunds"
});

const stripe = { refunds: new Map(), inFlight: new Set(), creates: 0, calls: [], failAccounts: new Set(), dropResponseOnce: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).startsWith("https://api.stripe.com/v1/refunds")) return realFetch(url, options);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const key = options.headers?.["Idempotency-Key"];
  const account = options.headers?.["Stripe-Account"];
  stripe.calls.push({ key, account });
  if (!account) return json(404, { error: { type: "invalid_request_error", message: "No such payment_intent on platform account" } });
  if (stripe.failAccounts.has(account)) return json(400, { error: { type: "invalid_request_error", message: "Simulated refund failure" } });
  if (stripe.refunds.has(key)) return json(200, stripe.refunds.get(key));
  if (stripe.inFlight.has(key)) return json(409, { error: { type: "idempotency_error", code: "idempotency_key_in_use" } });
  stripe.inFlight.add(key);
  await new Promise((resolve) => setTimeout(resolve, 30));
  stripe.creates += 1;
  const params = new URLSearchParams(options.body);
  const refund = { id: `re_test_${process.pid}_${Date.now()}_${stripe.creates}`, status: "succeeded", amount: Number(params.get("amount")) };
  stripe.refunds.set(key, refund);
  stripe.inFlight.delete(key);
  if (stripe.dropResponseOnce) {
    // Stripe created the refund but the response never arrived.
    stripe.dropResponseOnce = false;
    throw new TypeError("fetch failed");
  }
  return json(200, refund);
};

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { refundOrderPayment } = await import("../apps/api/src/modules/orderPayments/orderPaymentService.js");

const runId = `l07${Date.now().toString(36)}`;
const outcome = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code, status: error.status }));
const key = (label) => `refund-${runId}-${label}-000000`;

const restaurant = await prisma.restaurant.create({ data: { name: `L07 ${runId}`, slug: `${runId}-refunds`, status: "ACTIVE" } });
const otherRestaurant = await prisma.restaurant.create({ data: { name: `L07 other ${runId}`, slug: `${runId}-other`, status: "ACTIVE" } });
const merchant = await prisma.restaurantMerchantAccount.create({
  data: { restaurantId: restaurant.id, provider: "STRIPE_CONNECT", status: "ENABLED", stripeAccountId: `acct_${runId}`, stripeChargesEnabled: true }
});
const customer = await prisma.customer.create({ data: { restaurantId: restaurant.id, name: "Refund Tester", email: `refund-${runId}@example.test` } });
const owner = { id: null, role: "RESTAURANT_OWNER", restaurantId: restaurant.id };
const outsider = { id: null, role: "RESTAURANT_OWNER", restaurantId: otherRestaurant.id };

let orderCounter = 0;
async function paidOrder({ totalCents = 1000, status = "PAID" } = {}) {
  orderCounter += 1;
  const order = await prisma.order.create({
    data: {
      restaurant: { connect: { id: restaurant.id } },
      customer: { connect: { id: customer.id } },
      orderNumber: `${runId}-${orderCounter}`,
      type: "PICKUP",
      subtotalCents: totalCents,
      totalCents
    }
  });
  await prisma.restaurantOrderPayment.create({
    data: {
      restaurantId: restaurant.id, orderId: order.id, status, subtotalCents: totalCents, totalCents,
      restaurantGrossCents: totalCents, restaurantNetCents: totalCents, providerPaymentIntentId: `pi_${runId}_${orderCounter}`
    }
  });
  return order;
}
const refundsFor = (orderId) => prisma.restaurantRefund.findMany({ where: { orderPayment: { orderId } }, orderBy: { createdAt: "asc" } });

after(async () => {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
});

test("refunds require an idempotency key and a paid payment", async () => {
  const order = await paidOrder();
  assert.equal((await outcome(refundOrderPayment({ orderId: order.id, user: owner }))).code, "REFUND_IDEMPOTENCY_KEY_REQUIRED");
  const unpaid = await paidOrder({ status: "REQUIRES_PAYMENT_METHOD" });
  assert.equal((await outcome(refundOrderPayment({ orderId: unpaid.id, user: owner, idempotencyKey: key("unpaid") }))).code, "REFUND_PAYMENT_NOT_REFUNDABLE");
  assert.equal((await refundsFor(unpaid.id)).length, 0);
});

test("a refund runs on the restaurant's connected account and replays by key", async () => {
  const order = await paidOrder();
  const createsBefore = stripe.creates;
  const first = await refundOrderPayment({ orderId: order.id, user: owner, idempotencyKey: key("full") });
  const replay = await refundOrderPayment({ orderId: order.id, user: owner, idempotencyKey: key("full") });
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(first.amountCents, 1000);
  assert.equal(replay.id, first.id);
  assert.equal(stripe.creates - createsBefore, 1);
  assert.equal(stripe.calls.at(-1).account, merchant.stripeAccountId);
  assert.equal((await refundsFor(order.id)).length, 1);
});

test("partial refunds are capped at the remaining balance", async () => {
  const order = await paidOrder({ totalCents: 1000 });
  await refundOrderPayment({ orderId: order.id, user: owner, amountCents: 400, idempotencyKey: key("p1") });
  await refundOrderPayment({ orderId: order.id, user: owner, amountCents: 400, idempotencyKey: key("p2") });
  const overBalance = await outcome(refundOrderPayment({ orderId: order.id, user: owner, amountCents: 500, idempotencyKey: key("p3") }));
  assert.equal(overBalance.code, "REFUND_EXCEEDS_REMAINING", "over-balance requests are rejected, not silently reduced");
  const remainder = await refundOrderPayment({ orderId: order.id, user: owner, amountCents: 200, idempotencyKey: key("p3b") });
  assert.equal(remainder.amountCents, 200);
  assert.equal((await refundOrderPayment({ orderId: order.id, user: owner, amountCents: 200, idempotencyKey: key("p3b") })).id, remainder.id, "retrying the same request replays");
  const exhausted = await outcome(refundOrderPayment({ orderId: order.id, user: owner, amountCents: 1, idempotencyKey: key("p4") }));
  assert.equal(exhausted.code, "REFUND_EXCEEDS_REMAINING");
  const total = (await refundsFor(order.id)).reduce((sum, refund) => sum + refund.amountCents, 0);
  assert.equal(total, 1000);
});

test("concurrent full refunds with different keys never exceed the payment", async () => {
  const order = await paidOrder({ totalCents: 1000 });
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => outcome(refundOrderPayment({ orderId: order.id, user: owner, idempotencyKey: key(`race${index}`) }))));
  const succeeded = results.filter((result) => result.ok);
  assert.equal(succeeded.length, 1, JSON.stringify(results.map((result) => result.code || "ok")));
  assert.ok(results.filter((result) => !result.ok).every((result) => result.code === "REFUND_EXCEEDS_REMAINING"));
  const rows = await refundsFor(order.id);
  assert.equal(rows.reduce((sum, refund) => sum + refund.amountCents, 0), 1000);
});

test("concurrent submissions with the same key create one refund", async () => {
  const order = await paidOrder();
  const createsBefore = stripe.creates;
  const results = await Promise.all(Array.from({ length: 5 }, () => outcome(refundOrderPayment({ orderId: order.id, user: owner, idempotencyKey: key("same") }))));
  assert.ok(results.every((result) => result.ok || result.code === "REFUND_IN_PROGRESS"), JSON.stringify(results.map((result) => result.code || "ok")));
  assert.equal((await refundsFor(order.id)).length, 1);
  assert.equal(stripe.creates - createsBefore, 1);
});

test("reusing a key for a different amount is rejected", async () => {
  const order = await paidOrder();
  await refundOrderPayment({ orderId: order.id, user: owner, amountCents: 300, idempotencyKey: key("reuse") });
  const reused = await outcome(refundOrderPayment({ orderId: order.id, user: owner, amountCents: 700, idempotencyKey: key("reuse") }));
  assert.equal(reused.code, "REFUND_IDEMPOTENCY_KEY_REUSED");
  assert.equal((await refundsFor(order.id)).length, 1);
});

test("another restaurant cannot refund the order", async () => {
  const order = await paidOrder();
  const denied = await outcome(refundOrderPayment({ orderId: order.id, user: outsider, idempotencyKey: key("outsider") }));
  assert.equal(denied.status, 403);
  assert.equal((await refundsFor(order.id)).length, 0);
});

test("a failed provider refund releases the reserved balance", async () => {
  const order = await paidOrder({ totalCents: 1000 });
  stripe.failAccounts.add(merchant.stripeAccountId);
  const failed = await outcome(refundOrderPayment({ orderId: order.id, user: owner, idempotencyKey: key("fail") }));
  stripe.failAccounts.delete(merchant.stripeAccountId);
  assert.equal(failed.ok, false);
  const [row] = await refundsFor(order.id);
  assert.equal(row.status, "FAILED");
  const retry = await refundOrderPayment({ orderId: order.id, user: owner, idempotencyKey: key("fail-retry") });
  assert.equal(retry.amountCents, 1000);
  assert.equal(retry.status, "SUCCEEDED");
});

test("an unconfirmed provider outcome keeps the balance reserved and a same-key retry confirms it", async () => {
  const order = await paidOrder({ totalCents: 1000 });
  const createsBefore = stripe.creates;
  stripe.dropResponseOnce = true;
  const first = await outcome(refundOrderPayment({ orderId: order.id, user: owner, amountCents: 600, idempotencyKey: key("timeout") }));
  assert.equal(first.code, "REFUND_OUTCOME_UNKNOWN");
  const [pending] = await refundsFor(order.id);
  assert.equal(pending.status, "PENDING");
  const other = await outcome(refundOrderPayment({ orderId: order.id, user: owner, amountCents: 600, idempotencyKey: key("timeout-other-key") }));
  assert.equal(other.code, "REFUND_EXCEEDS_REMAINING", "unconfirmed refund still holds its balance");
  const confirmed = await refundOrderPayment({ orderId: order.id, user: owner, amountCents: 600, idempotencyKey: key("timeout") });
  assert.equal(confirmed.id, pending.id);
  assert.equal(confirmed.status, "SUCCEEDED");
  assert.equal(stripe.creates - createsBefore, 1, "Stripe refund created exactly once");
});

test("payments not collected through Stripe Connect cannot be refunded here", async () => {
  const order = await paidOrder();
  await prisma.restaurantOrderPayment.update({ where: { orderId: order.id }, data: { provider: "MANUAL" } });
  const result = await outcome(refundOrderPayment({ orderId: order.id, user: owner, idempotencyKey: key("manual") }));
  assert.equal(result.code, "REFUND_PAYMENT_NOT_REFUNDABLE");
});

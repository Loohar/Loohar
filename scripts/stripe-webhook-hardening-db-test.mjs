// Database-backed test for Stripe webhook hardening (legacy /api/payments/webhook and
// /api/webhooks/stripe-connect). Requires a DISPOSABLE local PostgreSQL database with
// migrations applied:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/stripe-webhook-hardening-db-test.mjs
// Requests are signed locally with test-only secrets; nothing reaches Stripe.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP Stripe webhook hardening DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}

const LEGACY_SECRET = "whsec_local_legacy_test_only";
const CONNECT_SECRET = "whsec_local_connect_test_only";
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "console",
  JWT_SECRET: "local-webhook-test-secret",
  STRIPE_WEBHOOK_SECRET: LEGACY_SECRET,
  STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET
});
console.log = () => {};

const express = (await import("express")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const paymentRoutes = (await import("../apps/api/src/routes/payments.js")).default;
const { stripeConnectWebhookRouter } = await import("../apps/api/src/routes/webhooks.js");
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");

const app = express();
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use("/api/webhooks/stripe-connect", express.raw({ type: "application/json" }), stripeConnectWebhookRouter);
app.use(express.json());
app.use("/api/payments", paymentRoutes);
app.use(errorHandler);

let server;
let baseUrl;
const runId = `l04${Date.now().toString(36)}`;
const seeded = {};

function sign(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function deliver(path, event, { secret, signature } = {}) {
  const rawBody = JSON.stringify(event);
  const headers = { "Content-Type": "application/json" };
  const header = signature !== undefined ? signature : sign(rawBody, secret);
  if (header) headers["Stripe-Signature"] = header;
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: rawBody });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const legacy = (event, options = {}) => deliver("/api/payments/webhook", event, { secret: LEGACY_SECRET, ...options });
const connect = (event, options = {}) => deliver("/api/webhooks/stripe-connect", event, { secret: CONNECT_SECRET, ...options });
// Genuine Connect events name the connected account and carry the PaymentIntent amount and currency.
const connectPaymentEvent = (label, type, payment, overrides = {}) => ({
  id: eventId(label),
  type,
  account: `acct_${runId}`,
  data: { object: { id: payment.providerPaymentIntentId, amount: 1000, amount_received: 1000, currency: "usd", latest_charge: `ch_${runId}`, metadata: { orderPaymentId: payment.id }, ...overrides } }
});
const eventId = (label) => `evt_${runId}_${label}`;
const historyCount = (orderId) => prisma.orderStatusHistory.count({ where: { orderId } });

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const restaurant = await prisma.restaurant.create({ data: { name: `L04 ${runId}`, slug: `${runId}-webhooks`, status: "ACTIVE" } });
  await prisma.restaurantMerchantAccount.create({
    data: { restaurantId: restaurant.id, provider: "STRIPE_CONNECT", status: "ENABLED", stripeAccountId: `acct_${runId}`, stripeChargesEnabled: true }
  });
  const customer = await prisma.customer.create({ data: { restaurantId: restaurant.id, name: "Webhook Tester", email: `webhook-${runId}@example.test` } });
  await prisma.coupon.create({ data: { restaurantId: restaurant.id, code: `SAVE${runId}`.toUpperCase().slice(0, 20) } });
  const coupon = await prisma.coupon.findFirst({ where: { restaurantId: restaurant.id } });
  const makeOrder = (suffix) => prisma.order.create({
    data: {
      restaurant: { connect: { id: restaurant.id } },
      customer: { connect: { id: customer.id } },
      orderNumber: `${runId}-${suffix}`,
      type: "PICKUP",
      subtotalCents: 1000,
      totalCents: 1000,
      couponCode: coupon.code
    }
  });
  const legacyOrder = await makeOrder("legacy");
  const legacyPayment = await prisma.payment.create({
    data: { orderId: legacyOrder.id, amountCents: 1000, restaurantNetCents: 1000, stripePaymentIntentId: `pi_${runId}_legacy` }
  });
  const connectOrder = await makeOrder("connect");
  const connectPayment = await prisma.restaurantOrderPayment.create({
    data: {
      restaurantId: restaurant.id,
      orderId: connectOrder.id,
      subtotalCents: 1000,
      totalCents: 1000,
      restaurantGrossCents: 1000,
      restaurantNetCents: 1000,
      providerPaymentIntentId: `pi_${runId}_connect`
    }
  });
  const raceLegacyOrder = await makeOrder("legacy-race");
  const raceLegacyPayment = await prisma.payment.create({
    data: { orderId: raceLegacyOrder.id, amountCents: 1000, restaurantNetCents: 1000, stripePaymentIntentId: `pi_${runId}_legacy_race` }
  });
  const raceConnectOrder = await makeOrder("connect-race");
  const raceConnectPayment = await prisma.restaurantOrderPayment.create({
    data: {
      restaurantId: restaurant.id,
      orderId: raceConnectOrder.id,
      subtotalCents: 1000,
      totalCents: 1000,
      restaurantGrossCents: 1000,
      restaurantNetCents: 1000,
      providerPaymentIntentId: `pi_${runId}_connect_race`
    }
  });
  Object.assign(seeded, { restaurant, coupon, legacyOrder, legacyPayment, connectOrder, connectPayment, raceLegacyOrder, raceLegacyPayment, raceConnectOrder, raceConnectPayment });
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
});

const legacySucceeded = (label) => ({
  id: eventId(label),
  type: "payment_intent.succeeded",
  data: { object: { id: seeded.legacyPayment.stripePaymentIntentId, metadata: { orderId: seeded.legacyOrder.id } } }
});

test("legacy webhook fails closed when STRIPE_WEBHOOK_SECRET is missing", async () => {
  const event = legacySucceeded("nosecret");
  const rawBody = JSON.stringify(event);
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const unsigned = await legacy(event, { signature: "" });
    const forged = await legacy(event, { signature: sign(rawBody, "attacker-chosen-secret") });
    assert.equal(unsigned.status, 503);
    assert.equal(forged.status, 503);
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = LEGACY_SECRET;
  }
  const payment = await prisma.payment.findUnique({ where: { id: seeded.legacyPayment.id } });
  assert.equal(payment.status, "PENDING");
});

test("legacy webhook rejects unsigned, forged, and stale events", async () => {
  const event = legacySucceeded("rejected");
  const rawBody = JSON.stringify(event);
  assert.equal((await legacy(event, { signature: "" })).status, 400);
  assert.equal((await legacy(event, { signature: sign(rawBody, "whsec_wrong") })).status, 400);
  assert.equal((await legacy(event, { signature: sign(rawBody, LEGACY_SECRET, Math.floor(Date.now() / 1000) - 3600) })).status, 400);
  const payment = await prisma.payment.findUnique({ where: { id: seeded.legacyPayment.id } });
  assert.equal(payment.status, "PENDING");
  assert.equal(await prisma.restaurantPaymentEvent.count({ where: { providerEventId: `stripe_legacy:${event.id}` } }), 0);
});

test("legacy webhook applies a signed payment once and deduplicates redelivery", async () => {
  const event = legacySucceeded("paid");
  const first = await legacy(event);
  assert.equal(first.status, 200);
  const paid = await prisma.payment.findUnique({ where: { id: seeded.legacyPayment.id } });
  assert.equal(paid.status, "PAID");
  const historyAfterFirst = await historyCount(seeded.legacyOrder.id);
  const couponAfterFirst = (await prisma.coupon.findUnique({ where: { id: seeded.coupon.id } })).redeemedCount;

  const redelivery = await legacy(event);
  assert.equal(redelivery.status, 200);
  assert.equal(redelivery.body.duplicate, true);

  const lateDuplicate = await legacy(legacySucceeded("paid-again"));
  assert.equal(lateDuplicate.body.reason, "payment_already_settled");

  assert.equal(await historyCount(seeded.legacyOrder.id), historyAfterFirst);
  assert.equal((await prisma.coupon.findUnique({ where: { id: seeded.coupon.id } })).redeemedCount, couponAfterFirst);
  const ledger = await prisma.restaurantPaymentEvent.findUnique({ where: { providerEventId: `stripe_legacy:${event.id}` } });
  assert.ok(ledger?.processedAt, "processed event is recorded");
});

test("legacy webhook does not downgrade a paid payment on a late failure event", async () => {
  const result = await legacy({
    id: eventId("late-failure"),
    type: "payment_intent.payment_failed",
    data: { object: { id: seeded.legacyPayment.stripePaymentIntentId, last_payment_error: { message: "late" } } }
  });
  assert.equal(result.status, 200);
  assert.equal((await prisma.payment.findUnique({ where: { id: seeded.legacyPayment.id } })).status, "PAID");
});

test("legacy webhook leaves events for unknown payments unprocessed so Stripe redelivers", async () => {
  const event = { id: eventId("unknown"), type: "payment_intent.succeeded", data: { object: { id: `pi_${runId}_missing` } } };
  const result = await legacy(event);
  assert.equal(result.status, 404);
  const ledger = await prisma.restaurantPaymentEvent.findUnique({ where: { providerEventId: `stripe_legacy:${event.id}` } });
  assert.equal(ledger?.processedAt ?? null, null);
  assert.ok([404, 409].includes((await legacy(event)).status), "redelivery is retried, not skipped as a duplicate");
});

test("concurrent deliveries of one legacy event apply side effects exactly once", async () => {
  const event = {
    id: eventId("legacy-race"),
    type: "payment_intent.succeeded",
    data: { object: { id: seeded.raceLegacyPayment.stripePaymentIntentId } }
  };
  const couponBefore = (await prisma.coupon.findUnique({ where: { id: seeded.coupon.id } })).redeemedCount;
  const historyBefore = await historyCount(seeded.raceLegacyOrder.id);
  const results = await Promise.all(Array.from({ length: 6 }, () => legacy(event)));
  assert.ok(results.some((result) => result.status === 200) && results.every((result) => [200, 409].includes(result.status)), JSON.stringify(results.map((result) => result.status)));
  assert.equal((await prisma.payment.findUnique({ where: { id: seeded.raceLegacyPayment.id } })).status, "PAID");
  assert.equal(await historyCount(seeded.raceLegacyOrder.id), historyBefore + 1);
  assert.equal((await prisma.coupon.findUnique({ where: { id: seeded.coupon.id } })).redeemedCount, couponBefore + 1);
  assert.equal(await prisma.loyaltyPoint.count({ where: { orderId: seeded.raceLegacyOrder.id } }) <= 1, true);
});

test("Stripe Connect webhook keeps failing closed without its secret", async () => {
  const event = { id: eventId("connect-nosecret"), type: "payment_intent.succeeded", data: { object: { id: seeded.connectPayment.providerPaymentIntentId } } };
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  try {
    assert.equal((await connect(event, { signature: "" })).status, 503);
  } finally {
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
  }
});

test("Stripe Connect webhook verifies account and amount, applies payment once, deduplicates, and ignores late failures", async () => {
  const forgedAccount = await connect({ ...connectPaymentEvent("connect-forged-account", "payment_intent.succeeded", seeded.connectPayment), account: "acct_attacker" });
  assert.equal(forgedAccount.body.reason, "payment_event_mismatch");
  const wrongAmount = await connect(connectPaymentEvent("connect-wrong-amount", "payment_intent.succeeded", seeded.connectPayment, { amount: 100, amount_received: 100 }));
  assert.equal(wrongAmount.body.reason, "payment_event_mismatch");
  assert.equal((await prisma.restaurantOrderPayment.findUnique({ where: { id: seeded.connectPayment.id } })).status, "REQUIRES_PAYMENT_METHOD", "forged or mismatched events never mark a payment paid");
  const succeeded = connectPaymentEvent("connect-paid", "payment_intent.succeeded", seeded.connectPayment);
  assert.equal((await connect(succeeded)).status, 200);
  assert.equal((await prisma.restaurantOrderPayment.findUnique({ where: { id: seeded.connectPayment.id } })).status, "PAID");
  const history = await historyCount(seeded.connectOrder.id);

  const redelivery = await connect(succeeded);
  assert.equal(redelivery.body.duplicate, true);
  const secondSucceeded = await connect({ ...succeeded, id: eventId("connect-paid-2") });
  assert.equal(secondSucceeded.body.reason, "payment_already_settled");
  const lateFailure = await connect({
    id: eventId("connect-late-failure"),
    type: "payment_intent.payment_failed",
    data: { object: { id: seeded.connectPayment.providerPaymentIntentId, metadata: { orderPaymentId: seeded.connectPayment.id } } }
  });
  assert.equal(lateFailure.body.reason, "payment_already_settled");

  assert.equal(await historyCount(seeded.connectOrder.id), history);
  assert.equal((await prisma.restaurantOrderPayment.findUnique({ where: { id: seeded.connectPayment.id } })).status, "PAID");
  assert.equal(await prisma.restaurantPaymentEvent.count({ where: { providerEventId: succeeded.id } }), 1);
});

test("concurrent deliveries of one Stripe Connect event apply side effects exactly once", async () => {
  const event = connectPaymentEvent("connect-race", "payment_intent.succeeded", seeded.raceConnectPayment);
  const couponBefore = (await prisma.coupon.findUnique({ where: { id: seeded.coupon.id } })).redeemedCount;
  const historyBefore = await historyCount(seeded.raceConnectOrder.id);
  const results = await Promise.all(Array.from({ length: 6 }, () => connect(event)));
  assert.ok(results.some((result) => result.status === 200) && results.every((result) => [200, 409].includes(result.status)), JSON.stringify(results.map((result) => result.status)));
  assert.equal((await prisma.restaurantOrderPayment.findUnique({ where: { id: seeded.raceConnectPayment.id } })).status, "PAID");
  assert.equal(await historyCount(seeded.raceConnectOrder.id), historyBefore + 1);
  assert.equal((await prisma.coupon.findUnique({ where: { id: seeded.coupon.id } })).redeemedCount, couponBefore + 1);
  assert.equal((await prisma.order.findUnique({ where: { id: seeded.raceConnectOrder.id } })).status, "ACCEPTED");
});

test("Stripe refund events reconcile restaurant refund records", async () => {
  const refund = await prisma.restaurantRefund.create({
    data: { restaurantId: seeded.restaurant.id, orderPaymentId: seeded.connectPayment.id, amountCents: 100, status: "SUCCEEDED", providerRefundId: `re_${runId}_late_fail` }
  });
  const result = await connect({
    id: eventId("refund-failed"),
    type: "refund.failed",
    data: { object: { id: refund.providerRefundId, status: "failed", payment_intent: seeded.connectPayment.providerPaymentIntentId, metadata: { orderPaymentId: seeded.connectPayment.id, restaurantRefundId: refund.id } } }
  });
  assert.equal(result.status, 200);
  assert.equal((await prisma.restaurantRefund.findUnique({ where: { id: refund.id } })).status, "FAILED");
});

test("Stripe Connect refunds still update payment state", async () => {
  const result = await connect({
    id: eventId("connect-refund"),
    type: "charge.refunded",
    data: { object: { id: `ch_${runId}`, payment_intent: seeded.connectPayment.providerPaymentIntentId, amount_refunded: 400, metadata: { orderPaymentId: seeded.connectPayment.id } } }
  });
  assert.equal(result.status, 200);
  assert.equal((await prisma.restaurantOrderPayment.findUnique({ where: { id: seeded.connectPayment.id } })).status, "PARTIALLY_REFUNDED");
});

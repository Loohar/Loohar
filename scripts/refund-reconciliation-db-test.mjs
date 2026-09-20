// L-20: refunds Loohar did not create must be mirrored, and refunds left PENDING must be resolved.
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --test scripts/refund-reconciliation-db-test.mjs
//
// Before this fix a refund raised in the Stripe dashboard was dropped as refund_not_found, so the
// money had left the merchant account while Loohar still counted it as refundable; and a refund
// whose terminal webhook never arrived stayed PENDING for ever, reserving a balance that could
// then never be refunded to the customer again.
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
  console.log("SKIP refund reconciliation DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  JWT_SECRET: "local-refund-recon-secret",
  STRIPE_CONNECT_SECRET_KEY: "sk_test_local_fake_refund_recon"
});

// Stripe stand-in for refund retrieval only; no network calls are made.
const stripe = { refunds: new Map(), unreachable: false, retrieves: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (!target.startsWith("https://api.stripe.com/v1/refunds/")) return realFetch(url, options);
  stripe.retrieves += 1;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (stripe.unreachable) return json(500, { error: { message: "simulated provider outage" } });
  const refund = stripe.refunds.get(target.split("/").pop());
  return refund ? json(200, refund) : json(404, { error: { message: "No such refund" } });
};

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { handleStripeConnectWebhook } = await import("../apps/api/src/modules/orderPayments/orderPaymentService.js");
const { sweepStalePendingRefunds } = await import("../apps/api/src/modules/orderPayments/refundSweep.js");

const runId = `l20${Date.now().toString(36)}`;
let seq = 0;
async function seedPaidOrder(label, totalCents = 5000) {
  seq += 1;
  const restaurant = await prisma.restaurant.create({
    data: { name: `L20 ${label}`, slug: `${runId}-${label}-${seq}`, status: "ACTIVE", locations: { create: { name: "Main" } } },
    include: { locations: true }
  });
  await prisma.restaurantMerchantAccount.create({
    data: { restaurantId: restaurant.id, provider: "STRIPE_CONNECT", status: "ENABLED", stripeAccountId: `acct_${runId}_${seq}`, stripeChargesEnabled: true }
  });
  const customer = await prisma.customer.create({
    data: { restaurantId: restaurant.id, name: "Refund Tester", email: `refund-${runId}-${seq}@example.test` }
  });
  const order = await prisma.order.create({
    data: {
      restaurant: { connect: { id: restaurant.id } },
      customer: { connect: { id: customer.id } },
      location: { connect: { id: restaurant.locations[0].id } },
      orderNumber: `${runId}${seq}`,
      status: "ACCEPTED",
      type: "PICKUP",
      subtotalCents: totalCents,
      totalCents
    }
  });
  const payment = await prisma.restaurantOrderPayment.create({
    data: {
      restaurantId: restaurant.id,
      orderId: order.id,
      provider: "STRIPE_CONNECT",
      status: "PAID",
      currency: "usd",
      subtotalCents: totalCents,
      totalCents,
      restaurantGrossCents: totalCents,
      restaurantNetCents: totalCents,
      providerPaymentIntentId: `pi_${runId}_${seq}`,
      paidAt: new Date()
    }
  });
  return { restaurant, order, payment };
}

const refundEvent = (payment, { id, amount, status = "succeeded", type = "refund.created" }) => ({
  id: `evt_${id}`,
  type,
  data: { object: { id, object: "refund", amount, status, payment_intent: payment.providerPaymentIntentId, reason: "requested_by_customer" } }
});
const refundsFor = (paymentId) => prisma.restaurantRefund.findMany({ where: { orderPaymentId: paymentId } });

after(async () => {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
});

test("a refund created outside Loohar is mirrored instead of dropped", async () => {
  const { restaurant, payment } = await seedPaidOrder("mirror");
  const result = await handleStripeConnectWebhook(refundEvent(payment, { id: `re_${runId}_mirror`, amount: 1500 }));
  assert.equal(result.refundMirrored, true, `the refund must be recorded, got ${JSON.stringify(result)}`);

  const refunds = await refundsFor(payment.id);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amountCents, 1500, "the amount comes from the provider, never from a caller");
  assert.equal(refunds[0].status, "SUCCEEDED");
  assert.equal(refunds[0].providerRefundId, `re_${runId}_mirror`);
  assert.equal(refunds[0].restaurantId, restaurant.id, "the mirrored refund belongs to the paying tenant");
  assert.equal(refunds[0].requestedByUserId, null, "nobody in Loohar requested it");

  const audits = await prisma.auditLog.count({ where: { restaurantId: restaurant.id, action: "refund.mirrored_from_provider" } });
  assert.equal(audits, 1, "a refund Loohar did not create is flagged for review");
});

test("a redelivered provider refund is not mirrored twice", async () => {
  const { payment } = await seedPaidOrder("redeliver");
  const event = refundEvent(payment, { id: `re_${runId}_redeliver`, amount: 900 });
  await handleStripeConnectWebhook(event);
  await handleStripeConnectWebhook({ ...event, id: `${event.id}_again` });
  const refunds = await refundsFor(payment.id);
  assert.equal(refunds.length, 1, "the unique provider refund id keeps redeliveries idempotent");
  assert.equal(refunds[0].amountCents, 900);
});

test("a mirrored refund reduces what is still refundable", async () => {
  const { payment } = await seedPaidOrder("balance", 4000);
  await handleStripeConnectWebhook(refundEvent(payment, { id: `re_${runId}_balance`, amount: 2500 }));
  const reserved = await prisma.restaurantRefund.aggregate({
    where: { orderPaymentId: payment.id, status: { in: ["PENDING", "SUCCEEDED"] } },
    _sum: { amountCents: true }
  });
  assert.equal(reserved._sum.amountCents, 2500);
  assert.equal(payment.totalCents - reserved._sum.amountCents, 1500, "the remaining refundable balance now matches the provider");
});

test("the sweep resolves a PENDING refund the provider already finished", async () => {
  const { restaurant, payment } = await seedPaidOrder("sweep");
  const providerRefundId = `re_${runId}_sweep`;
  stripe.refunds.set(providerRefundId, { id: providerRefundId, status: "succeeded", amount: 1200 });
  const refund = await prisma.restaurantRefund.create({
    data: { restaurantId: restaurant.id, orderPaymentId: payment.id, provider: "STRIPE_CONNECT", providerRefundId, amountCents: 1200, status: "PENDING", createdAt: new Date(Date.now() - 60 * 60 * 1000) }
  });

  const result = await sweepStalePendingRefunds({ olderThanMs: 15 * 60 * 1000 });
  assert.ok(result.resolved >= 1);
  const stored = await prisma.restaurantRefund.findUnique({ where: { id: refund.id } });
  assert.equal(stored.status, "SUCCEEDED");
  assert.ok(stored.processedAt, "a resolved refund records when it settled");
  const audits = await prisma.auditLog.count({ where: { restaurantId: restaurant.id, action: "refund.resolved_by_sweep" } });
  assert.equal(audits, 1);
});

test("the sweep leaves a recent refund and a refund with no provider id alone", async () => {
  const { restaurant, payment } = await seedPaidOrder("untouched");
  const recentId = `re_${runId}_recent`;
  stripe.refunds.set(recentId, { id: recentId, status: "succeeded", amount: 500 });
  const recent = await prisma.restaurantRefund.create({
    data: { restaurantId: restaurant.id, orderPaymentId: payment.id, provider: "STRIPE_CONNECT", providerRefundId: recentId, amountCents: 500, status: "PENDING" }
  });
  const unknown = await prisma.restaurantRefund.create({
    data: { restaurantId: restaurant.id, orderPaymentId: payment.id, provider: "STRIPE_CONNECT", amountCents: 700, status: "PENDING", createdAt: new Date(Date.now() - 60 * 60 * 1000) }
  });

  const result = await sweepStalePendingRefunds({ olderThanMs: 15 * 60 * 1000 });
  assert.equal((await prisma.restaurantRefund.findUnique({ where: { id: recent.id } })).status, "PENDING", "a refund younger than the cutoff is not touched");
  assert.equal((await prisma.restaurantRefund.findUnique({ where: { id: unknown.id } })).status, "PENDING", "a refund with no provider id is never guessed");
  assert.ok(result.needsReview.some((item) => item.refundId === unknown.id && item.reason === "no_provider_refund_id"), "it is reported for a person instead");
});

test("a provider outage leaves every refund exactly as it was", async () => {
  const { restaurant, payment } = await seedPaidOrder("outage");
  const providerRefundId = `re_${runId}_outage`;
  stripe.refunds.set(providerRefundId, { id: providerRefundId, status: "succeeded", amount: 300 });
  const refund = await prisma.restaurantRefund.create({
    data: { restaurantId: restaurant.id, orderPaymentId: payment.id, provider: "STRIPE_CONNECT", providerRefundId, amountCents: 300, status: "PENDING", createdAt: new Date(Date.now() - 60 * 60 * 1000) }
  });
  stripe.unreachable = true;
  try {
    const result = await sweepStalePendingRefunds({ olderThanMs: 15 * 60 * 1000 });
    assert.ok(result.errors >= 1);
    assert.equal((await prisma.restaurantRefund.findUnique({ where: { id: refund.id } })).status, "PENDING");
  } finally {
    stripe.unreachable = false;
  }
});

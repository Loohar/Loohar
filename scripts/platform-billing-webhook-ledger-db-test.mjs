// Database-backed test for the Stripe platform (SaaS billing) webhook event ledger.
// Requires a DISPOSABLE local PostgreSQL database with migrations applied:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/platform-billing-webhook-ledger-db-test.mjs
// Requests are signed locally with a test-only secret; nothing reaches Stripe.
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
  console.log("SKIP platform billing webhook DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
const PLATFORM_SECRET = "whsec_local_platform_test_only";
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "console",
  JWT_SECRET: "local-platform-webhook-test-secret",
  STRIPE_PLATFORM_WEBHOOK_SECRET: PLATFORM_SECRET
});
console.log = () => {};

const express = (await import("express")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const { stripePlatformWebhookRouter } = await import("../apps/api/src/routes/webhooks.js");
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");

const app = express();
app.use("/api/webhooks/stripe-platform", express.raw({ type: "application/json" }), stripePlatformWebhookRouter);
app.use(errorHandler);

const runId = `l09${Date.now().toString(36)}`;
let server;
let baseUrl;
let subscription;

async function deliver(event, secret = PLATFORM_SECRET) {
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const response = await fetch(`${baseUrl}/api/webhooks/stripe-platform`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${signature}` },
    body: rawBody
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const subscriptionEvent = (label, status) => ({
  id: `evt_${runId}_${label}`,
  type: "customer.subscription.updated",
  data: { object: { id: subscription.stripeSubscriptionId, status, customer: `cus_${runId}`, cancel_at_period_end: false } }
});

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const plan = await prisma.platformPlan.upsert({
    where: { code: "STARTER" },
    create: { code: "STARTER", name: "Starter", monthlyPriceCents: 0 },
    update: {}
  });
  subscription = await prisma.platformSubscription.create({
    data: { planId: plan.id, status: "INCOMPLETE", stripeSubscriptionId: `sub_${runId}` }
  });
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
});

test("a subscription event is applied once and recorded with its subscription", async () => {
  const event = subscriptionEvent("active", "active");
  const first = await deliver(event);
  assert.equal(first.status, 200);
  assert.equal((await prisma.platformSubscription.findUnique({ where: { id: subscription.id } })).status, "ACTIVE");
  const ledger = await prisma.platformBillingEvent.findUnique({ where: { providerEventId: event.id } });
  assert.ok(ledger.processedAt);
  assert.equal(ledger.subscriptionId, subscription.id);
});

test("a redelivered event is acknowledged without being re-applied", async () => {
  const event = subscriptionEvent("active", "active");
  await prisma.platformSubscription.update({ where: { id: subscription.id }, data: { status: "PAST_DUE" } });
  const redelivery = await deliver(event);
  assert.equal(redelivery.status, 200);
  assert.equal(redelivery.body.duplicate, true);
  assert.equal((await prisma.platformSubscription.findUnique({ where: { id: subscription.id } })).status, "PAST_DUE", "stale redelivery does not overwrite newer state");
  assert.equal(await prisma.platformBillingEvent.count({ where: { providerEventId: event.id } }), 1);
});

test("platform webhook still fails closed without its secret", async () => {
  delete process.env.STRIPE_PLATFORM_WEBHOOK_SECRET;
  try {
    const result = await deliver(subscriptionEvent("nosecret", "canceled"), "attacker-chosen-secret");
    assert.equal(result.status, 503);
  } finally {
    process.env.STRIPE_PLATFORM_WEBHOOK_SECRET = PLATFORM_SECRET;
  }
  assert.equal((await prisma.platformSubscription.findUnique({ where: { id: subscription.id } })).status, "PAST_DUE");
});

// Adversarial tenant-isolation tests for the surfaces added for the pilot: the payments list, the
// daily reconciliation summary, refunds and customer order tracking. Real routes, real auth
// middleware, real sessions, against a disposable local database.
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/pilot-tenant-isolation-db-test.mjs
import assert from "node:assert/strict";
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
  console.log("SKIP pilot tenant isolation DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "console",
  JWT_SECRET: "local-isolation-test-secret",
  REFRESH_TOKEN_SECRET: "local-isolation-test-refresh",
  STRIPE_CONNECT_SECRET_KEY: "sk_test_local_fake_isolation"
});
console.log = () => {};

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).startsWith("https://api.stripe.com/")) return realFetch(url, options);
  return new Response(JSON.stringify({ id: "re_test", status: "succeeded" }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const express = (await import("express")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const restaurantRoutes = (await import("../apps/api/src/routes/restaurant.js")).default;
const orderPaymentRoutes = (await import("../apps/api/src/routes/orderPayments.js")).default;
const customerRoutes = (await import("../apps/api/src/routes/customer.js")).default;
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");
const { createAuthSession } = await import("../apps/api/src/services/authSessionService.js");
const { signAccessToken } = await import("../apps/api/src/utils/tokens.js");
const { hashToken } = await import("../apps/api/src/services/orderWorkflowService.js");

const app = express();
app.use(express.json());
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/order-payments", orderPaymentRoutes);
app.use("/api/customer", customerRoutes);
app.use(errorHandler);

const runId = `ti${Date.now().toString(36)}`;
let server;
let baseUrl;
const ctx = {};

async function call(method, path, { token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function seedTenant(label, { paidCents }) {
  const restaurant = await prisma.restaurant.create({
    data: { name: `Isolation ${label}`, slug: `${runId}-${label}`, status: "ACTIVE", tenantClassification: "INTERNAL_DEVELOPMENT", locations: { create: { name: "Main" } } },
    include: { locations: true }
  });
  await prisma.restaurantMerchantAccount.create({
    data: { restaurantId: restaurant.id, provider: "STRIPE_CONNECT", status: "ENABLED", stripeAccountId: `acct_${runId}_${label}`, stripeChargesEnabled: true }
  });
  const owner = await prisma.user.create({
    data: { email: `owner-${label}-${runId}@example.test`, passwordHash: "x", name: "Owner", role: "TENANT_OWNER", restaurantId: restaurant.id, mfaEnabled: true, passwordChangedAt: new Date() }
  });
  await prisma.restaurantStaff.create({ data: { restaurantId: restaurant.id, userId: owner.id, role: "TENANT_OWNER", active: true } });
  const cashier = await prisma.user.create({
    data: { email: `cashier-${label}-${runId}@example.test`, passwordHash: "x", name: "Cashier", role: "CASHIER", restaurantId: restaurant.id, passwordChangedAt: new Date() }
  });
  await prisma.restaurantStaff.create({ data: { restaurantId: restaurant.id, userId: cashier.id, role: "CASHIER", active: true } });
  const customer = await prisma.customer.create({ data: { restaurantId: restaurant.id, name: "Guest", email: `guest-${label}-${runId}@example.test` } });
  const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Mains" } });
  const menuItem = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: "Plate", priceCents: paidCents } });
  const trackingToken = `track-${runId}-${label}`;
  const order = await prisma.order.create({
    data: {
      restaurant: { connect: { id: restaurant.id } },
      location: { connect: { id: restaurant.locations[0].id } },
      customer: { connect: { id: customer.id } },
      orderNumber: `${runId}-${label}`,
      type: "PICKUP",
      subtotalCents: paidCents,
      totalCents: paidCents,
      trackingTokenHash: hashToken(trackingToken),
      trackingTokenExpiresAt: new Date(Date.now() + 86_400_000),
      items: { create: [{ menuItem: { connect: { id: menuItem.id } }, name: "Plate", quantity: 1, unitPriceCents: paidCents }] }
    }
  });
  const payment = await prisma.restaurantOrderPayment.create({
    data: {
      restaurantId: restaurant.id, orderId: order.id, provider: "STRIPE_CONNECT", status: "PAID", paidAt: new Date(),
      subtotalCents: paidCents, totalCents: paidCents, restaurantGrossCents: paidCents, restaurantNetCents: paidCents,
      providerPaymentIntentId: `pi_${runId}_${label}`, providerChargeId: `ch_${runId}_${label}`
    }
  });
  const tokenFor = async (user) => {
    const { session } = await createAuthSession({ user, req: { headers: {} }, mfaVerifiedAt: new Date() });
    return signAccessToken(user, session);
  };
  return { restaurant, owner, cashier, order, payment, trackingToken, ownerToken: await tokenFor(owner), cashierToken: await tokenFor(cashier) };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  ctx.a = await seedTenant("a", { paidCents: 4782 });
  ctx.b = await seedTenant("b", { paidCents: 1999 });
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.close();
  await prisma.$disconnect();
});

test("asking for another tenant's payments never returns their money", async () => {
  const own = await call("GET", `/api/restaurants/${ctx.a.restaurant.id}/reporting/payments`, { token: ctx.a.ownerToken });
  assert.equal(own.status, 200);
  assert.equal(own.body.payments.length, 1);
  assert.equal(own.body.payments[0].totalCents, 4782);

  const crossTenant = await call("GET", `/api/restaurants/${ctx.b.restaurant.id}/reporting/payments`, { token: ctx.a.ownerToken });
  assert.equal([200, 403, 404].includes(crossTenant.status), true);
  const leaked = (crossTenant.body.payments || []).some((payment) => payment.totalCents === 1999 || payment.orderId === ctx.b.order.id);
  assert.equal(leaked, false, "tenant A must never see tenant B's payments");
});

test("the daily summary is scoped to the caller's own restaurant", async () => {
  const own = await call("GET", `/api/restaurants/${ctx.a.restaurant.id}/reporting/daily`, { token: ctx.a.ownerToken });
  assert.equal(own.status, 200);
  assert.equal(own.body.payments.collectedCents, 4782);

  const crossTenant = await call("GET", `/api/restaurants/${ctx.b.restaurant.id}/reporting/daily`, { token: ctx.a.ownerToken });
  if (crossTenant.status === 200) {
    assert.notEqual(crossTenant.body.payments.collectedCents, 1999, "tenant A must never see tenant B's takings");
    assert.equal(crossTenant.body.payments.collectedCents, 4782, "the caller only ever sees their own restaurant");
  }
});

test("a cashier cannot open the payments or reconciliation screens", async () => {
  for (const path of ["reporting/payments", "reporting/daily"]) {
    const result = await call("GET", `/api/restaurants/${ctx.a.restaurant.id}/${path}`, { token: ctx.a.cashierToken });
    assert.equal(result.status, 403, `${path} is not open to a cashier`);
  }
});

test("a refund cannot be pushed onto another tenant's order", async () => {
  // Without a key the request is refused before the tenant check; send one so the tenant boundary is
  // what rejects this.
  const missingKey = await call("POST", "/api/order-payments/refund", {
    token: ctx.a.ownerToken,
    body: { orderId: ctx.b.order.id, amountCents: 500, reason: "requested_by_customer" }
  });
  assert.equal(missingKey.status, 400, "a refund always needs an idempotency key");

  const crossTenant = await call("POST", "/api/order-payments/refund", {
    token: ctx.a.ownerToken,
    headers: { "Idempotency-Key": `isolation-${runId}-cross` },
    body: { orderId: ctx.b.order.id, amountCents: 500, reason: "requested_by_customer" }
  });
  assert.equal([403, 404].includes(crossTenant.status), true, `refunding another tenant's order must fail (got ${crossTenant.status})`);
  assert.equal(await prisma.restaurantRefund.count({ where: { orderPaymentId: ctx.b.payment.id } }), 0, "no refund row is created for the other tenant");

  const cashierRefund = await call("POST", "/api/order-payments/refund", {
    token: ctx.a.cashierToken,
    headers: { "Idempotency-Key": `isolation-${runId}-cashier` },
    body: { orderId: ctx.a.order.id, amountCents: 100, reason: "requested_by_customer" }
  });
  assert.equal(cashierRefund.status, 403, "a cashier cannot refund");
  assert.equal(await prisma.restaurantRefund.count({ where: { orderPaymentId: ctx.a.payment.id } }), 0);
});

test("an order tracking token only opens its own order", async () => {
  const own = await call("GET", `/api/customer/orders/${ctx.a.order.id}/status?token=${ctx.a.trackingToken}`);
  assert.equal(own.status, 200);
  assert.equal(own.body.payment.status, "PAID");

  const otherOrder = await call("GET", `/api/customer/orders/${ctx.b.order.id}/status?token=${ctx.a.trackingToken}`);
  assert.equal(otherOrder.status, 403, "one customer's token must not open another order");
  assert.equal(otherOrder.body.payment, undefined);

  const noToken = await call("GET", `/api/customer/orders/${ctx.a.order.id}/status`);
  assert.equal(noToken.status, 403, "payment state is never public");
});

// Database-backed HTTP test for tenant authorization and order/money lifecycle hardening.
// Uses real sessions and the real auth middleware. Requires a DISPOSABLE local PostgreSQL database:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/authz-money-hardening-db-test.mjs
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
  console.log("SKIP authz/money hardening DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "console",
  JWT_SECRET: "local-authz-test-secret",
  REFRESH_TOKEN_SECRET: "local-authz-test-refresh",
  STRIPE_CONNECT_SECRET_KEY: "sk_test_local_fake_authz",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_local_authz_test_only"
});
console.log = () => {};

const stripeCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).startsWith("https://api.stripe.com/")) return realFetch(url, options);
  stripeCalls.push({ url: String(url), account: options.headers?.["Stripe-Account"] });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (String(url).endsWith("/cancel")) return json(200, { id: String(url).split("/").at(-2), status: "canceled" });
  return json(400, { error: { message: "unexpected Stripe call in test" } });
};

const express = (await import("express")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const restaurantRoutes = (await import("../apps/api/src/routes/restaurant.js")).default;
const kitchenRoutes = (await import("../apps/api/src/routes/kitchen.js")).default;
const orderRoutes = (await import("../apps/api/src/routes/orders.js")).default;
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");
const { createAuthSession } = await import("../apps/api/src/services/authSessionService.js");
const { signAccessToken } = await import("../apps/api/src/utils/tokens.js");
const { hashToken } = await import("../apps/api/src/services/orderWorkflowService.js");
const { markOrderPaymentPaid } = await import("../apps/api/src/modules/orderPayments/orderPaymentService.js");

const app = express();
app.use(express.json());
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/kitchen", kitchenRoutes);
app.use("/api/orders", orderRoutes);
app.use(errorHandler);

const runId = `h3${Date.now().toString(36)}`;
let server;
let baseUrl;
const ctx = {};

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function userWithToken(label, role, restaurantId, { locationIds } = {}) {
  const user = await prisma.user.create({
    data: { email: `${label}-${runId}@example.test`, passwordHash: "x", name: label, role, restaurantId, mfaEnabled: ["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"].includes(role), passwordChangedAt: new Date() }
  });
  if (!["DRIVER", "CUSTOMER"].includes(role)) {
    await prisma.restaurantStaff.create({ data: { restaurantId, userId: user.id, role, active: true, ...(locationIds ? { locationIdsJson: locationIds } : {}) } });
  }
  const { session } = await createAuthSession({ user, req: { headers: {} }, mfaVerifiedAt: user.mfaEnabled ? new Date() : null });
  return { user, token: signAccessToken(user, session) };
}

let orderCounter = 0;
async function onlineOrder({ status = "PENDING", paymentStatus = "REQUIRES_PAYMENT_METHOD", locationId = ctx.locationA.id, withItems = true } = {}) {
  orderCounter += 1;
  const order = await prisma.order.create({
    data: {
      restaurant: { connect: { id: ctx.restaurant.id } },
      location: { connect: { id: locationId } },
      customer: { connect: { id: ctx.customer.id } },
      orderNumber: `${runId}-${orderCounter}`,
      type: "PICKUP",
      status,
      subtotalCents: 1000,
      totalCents: 1000,
      trackingTokenHash: hashToken(`track-${runId}-${orderCounter}`),
      trackingTokenExpiresAt: new Date(Date.now() + 86_400_000),
      ...(withItems ? { items: { create: [{ menuItem: { connect: { id: ctx.menuItem.id } }, name: "Burger", quantity: 1, unitPriceCents: 1000 }] } } : {})
    }
  });
  const payment = await prisma.restaurantOrderPayment.create({
    data: {
      restaurantId: ctx.restaurant.id, orderId: order.id, status: paymentStatus, subtotalCents: 1000, totalCents: 1000,
      restaurantGrossCents: 1000, restaurantNetCents: 1000, providerPaymentIntentId: `pi_${runId}_${orderCounter}`,
      checkoutIdempotencyKeyHash: `hash-${runId}-${orderCounter}`
    }
  });
  return { order, payment, trackingToken: `track-${runId}-${orderCounter}` };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  // Internal classification keeps plan entitlements out of the way; these tests target authorization and lifecycle.
  ctx.restaurant = await prisma.restaurant.create({
    data: { name: `H3 ${runId}`, slug: `${runId}-a`, status: "ACTIVE", tenantClassification: "INTERNAL_DEVELOPMENT", locations: { create: [{ name: "A" }, { name: "B" }] } },
    include: { locations: { orderBy: { createdAt: "asc" } } }
  });
  [ctx.locationA, ctx.locationB] = ctx.restaurant.locations;
  ctx.otherRestaurant = await prisma.restaurant.create({ data: { name: `H3 other ${runId}`, slug: `${runId}-b`, status: "ACTIVE" } });
  await prisma.restaurantMerchantAccount.create({ data: { restaurantId: ctx.restaurant.id, provider: "STRIPE_CONNECT", status: "ENABLED", stripeAccountId: `acct_${runId}`, stripeChargesEnabled: true } });
  const category = await prisma.menuCategory.create({ data: { restaurantId: ctx.restaurant.id, name: "Mains" } });
  ctx.menuItem = await prisma.menuItem.create({ data: { restaurantId: ctx.restaurant.id, categoryId: category.id, name: "Burger", priceCents: 1000 } });
  ctx.customer = await prisma.customer.create({ data: { restaurantId: ctx.restaurant.id, name: "Guest", email: `guest-${runId}@example.test` } });
  ctx.owner = await userWithToken("owner", "RESTAURANT_OWNER", ctx.restaurant.id);
  ctx.manager = await userWithToken("manager", "RESTAURANT_MANAGER", ctx.restaurant.id);
  ctx.kitchenA = await userWithToken("kitchen-a", "KITCHEN_STAFF", ctx.restaurant.id, { locationIds: [ctx.locationA.id] });
});

after(async () => {
  globalThis.fetch = realFetch;
  server?.close();
  await prisma.$disconnect();
});

test("restaurant profile updates cannot change classification, status, relations or other tenants' users", async () => {
  const base = `/api/restaurants/${ctx.restaurant.id}/profile`;
  for (const body of [
    { tenantClassification: "PRIVATE_BETA" },
    { status: "SUSPENDED" },
    { users: { create: { email: `super-${runId}@example.test`, passwordHash: "x", name: "x", role: "SUPER_ADMIN" } } },
    { slug: "taken-over" },
    { billingMode: "MANUAL" }
  ]) {
    const result = await call("PATCH", base, { token: ctx.manager.token, body });
    assert.equal(result.status, 400, JSON.stringify(body));
  }
  assert.equal(await prisma.user.count({ where: { email: `super-${runId}@example.test` } }), 0);
  const unchanged = await prisma.restaurant.findUnique({ where: { id: ctx.restaurant.id } });
  assert.equal(unchanged.status, "ACTIVE");
  assert.equal(unchanged.tenantClassification, "INTERNAL_DEVELOPMENT");
  const allowed = await call("PATCH", base, { token: ctx.owner.token, body: { phone: "555-0100", city: "Denver" } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.restaurant.city, "Denver");
});

test("managers cannot create or manage owner-level or manager accounts, or set custom permissions", async () => {
  const staffPath = `/api/restaurants/${ctx.restaurant.id}/staff`;
  for (const role of ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER"]) {
    const created = await call("POST", staffPath, { token: ctx.manager.token, body: { email: `esc-${role}-${runId}@example.test`, name: "x", role } });
    assert.ok([403].includes(created.status) || (created.status === 201 && created.body.staff.role !== role), `${role}: ${created.status}`);
    assert.equal(await prisma.user.count({ where: { email: `esc-${role}-${runId}@example.test`, role } }), 0, `no ${role} account created`);
  }
  const managerByManager = await call("POST", staffPath, { token: ctx.manager.token, body: { email: `mgr2-${runId}@example.test`, name: "x", role: "RESTAURANT_MANAGER" } });
  assert.equal(managerByManager.status, 403);
  const customPermissions = await call("POST", staffPath, { token: ctx.manager.token, body: { email: `perm-${runId}@example.test`, name: "x", role: "CASHIER", permissionsJson: ["POS_APPLY_DISCOUNT"] } });
  assert.equal(customPermissions.status, 403);
  const cashier = await call("POST", staffPath, { token: ctx.manager.token, body: { email: `cashier-${runId}@example.test`, name: "Cashier", role: "CASHIER" } });
  assert.equal(cashier.status, 201);

  const suspendOwner = await call("PATCH", `/api/restaurants/${ctx.restaurant.id}/employees/${ctx.owner.user.id}`, { token: ctx.manager.token, body: { status: "SUSPENDED" } });
  assert.equal(suspendOwner.status, 403);
  const disableOwner = await call("PATCH", `/api/restaurants/${ctx.restaurant.id}/employees/${ctx.owner.user.id}/disable`, { token: ctx.manager.token });
  assert.equal(disableOwner.status, 403);
  assert.equal((await prisma.user.findUnique({ where: { id: ctx.owner.user.id } })).status, "ACTIVE");

  const ownerPermissions = await call("POST", staffPath, { token: ctx.owner.token, body: { email: `lead-${runId}@example.test`, name: "Lead", role: "CASHIER", permissionsJson: ["POS_APPLY_DISCOUNT", "NOT_A_PERMISSION"] } });
  assert.equal(ownerPermissions.status, 201);
  assert.deepEqual(ownerPermissions.body.staff.permissionsJson, ["POS_APPLY_DISCOUNT"]);
});

test("order status moves forward only and final orders are immutable", async () => {
  const { order } = await onlineOrder({ status: "PREPARING", paymentStatus: "PAID" });
  const path = `/api/restaurants/${ctx.restaurant.id}/orders/${order.id}/status`;
  const backwards = await call("PATCH", path, { token: ctx.owner.token, body: { status: "PENDING" } });
  assert.equal(backwards.status, 409);
  assert.equal((await call("PATCH", path, { token: ctx.owner.token, body: { status: "READY" } })).status, 200);
  const cancelPaid = await call("PATCH", path, { token: ctx.owner.token, body: { status: "CANCELLED" } });
  assert.equal(cancelPaid.status, 409);
  assert.equal(cancelPaid.body.code, "ORDER_REFUND_REQUIRED");
  assert.equal((await call("PATCH", path, { token: ctx.owner.token, body: { status: "DELIVERED" } })).status, 200);
  assert.equal((await call("PATCH", path, { token: ctx.owner.token, body: { status: "READY" } })).status, 409, "delivered orders are final");
});

test("cancelling an unpaid online order cancels its PaymentIntent, and a late payment cannot revive it", async () => {
  const { order, payment } = await onlineOrder();
  const callsBefore = stripeCalls.length;
  const cancel = await call("PATCH", `/api/restaurants/${ctx.restaurant.id}/orders/${order.id}/status`, { token: ctx.owner.token, body: { status: "CANCELLED" } });
  assert.equal(cancel.status, 200);
  const cancelCall = stripeCalls.slice(callsBefore).find((entry) => entry.url.endsWith(`/payment_intents/${payment.providerPaymentIntentId}/cancel`));
  assert.ok(cancelCall, "Stripe PaymentIntent cancel was requested");
  assert.equal(cancelCall.account, `acct_${runId}`);
  assert.equal((await prisma.restaurantOrderPayment.findUnique({ where: { id: payment.id } })).status, "CANCELED");

  const { order: raceOrder, payment: racePayment } = await onlineOrder();
  await prisma.order.update({ where: { id: raceOrder.id }, data: { status: "CANCELLED" } });
  const result = await markOrderPaymentPaid({ payment: racePayment, providerChargeId: "ch_late" });
  assert.equal(result.reviewRequired, true);
  assert.equal((await prisma.order.findUnique({ where: { id: raceOrder.id } })).status, "CANCELLED");
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: racePayment.id, action: "order_payment.paid_on_closed_order" } }));
});

test("tips on card orders cannot be edited through the tracking link", async () => {
  const { order, trackingToken } = await onlineOrder({ paymentStatus: "PAID", status: "ACCEPTED" });
  const edit = await call("PATCH", `/api/orders/${order.id}/tip?token=${encodeURIComponent(trackingToken)}`, { body: { driverTipCents: 5000 } });
  assert.equal(edit.status, 409);
  assert.equal(edit.body.code, "ORDER_TIP_LOCKED");
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).totalCents, 1000);
});

test("kitchen shows only paid online orders and only the employee's assigned locations", async () => {
  const { order: unpaid } = await onlineOrder({ paymentStatus: "REQUIRES_PAYMENT_METHOD" });
  const { order: paidA } = await onlineOrder({ paymentStatus: "PAID", status: "ACCEPTED" });
  const { order: paidB } = await onlineOrder({ paymentStatus: "PAID", status: "ACCEPTED", locationId: ctx.locationB.id });

  const all = await call("GET", "/api/kitchen/orders?locationId=all", { token: ctx.kitchenA.token });
  assert.equal(all.status, 200);
  const ids = new Set(all.body.orders.map((entry) => entry.id));
  assert.ok(ids.has(paidA.id), "paid order at assigned location is shown");
  assert.ok(!ids.has(unpaid.id), "unpaid online order is hidden");
  assert.ok(!ids.has(paidB.id), "other location's order is hidden");
  assert.ok(all.body.locations.every((location) => location.id === ctx.locationA.id));

  const other = await call("GET", `/api/kitchen/orders?locationId=${ctx.locationB.id}`, { token: ctx.kitchenA.token });
  assert.equal(other.status, 403);
  const advanceOther = await call("PATCH", `/api/kitchen/orders/${paidB.id}/status?locationId=all`, { token: ctx.kitchenA.token, body: { status: "PREPARING" } });
  assert.equal(advanceOther.status, 404);
  const advanceUnpaid = await call("PATCH", `/api/kitchen/orders/${unpaid.id}/status?locationId=all`, { token: ctx.kitchenA.token, body: { status: "PREPARING" } });
  assert.equal(advanceUnpaid.status, 404);
  assert.equal((await prisma.order.findUnique({ where: { id: unpaid.id } })).status, "PENDING");
});

test("unpaid online orders cannot be started, failed card checkouts are cancelled, and card success after cash is flagged", async () => {
  const { order: unpaid } = await onlineOrder();
  const accept = await call("PATCH", `/api/restaurants/${ctx.restaurant.id}/orders/${unpaid.id}/status`, { token: ctx.owner.token, body: { status: "ACCEPTED" } });
  assert.equal(accept.status, 409);
  assert.equal(accept.body.code, "ORDER_AWAITING_PAYMENT");

  const { order: declined, payment: declinedPayment } = await onlineOrder({ paymentStatus: "FAILED" });
  const before = stripeCalls.length;
  const cancel = await call("PATCH", `/api/restaurants/${ctx.restaurant.id}/orders/${declined.id}/status`, { token: ctx.owner.token, body: { status: "CANCELLED" } });
  assert.equal(cancel.status, 200);
  assert.ok(stripeCalls.slice(before).some((entry) => entry.url.endsWith(`/payment_intents/${declinedPayment.providerPaymentIntentId}/cancel`)), "declined PaymentIntent is cancelled");

  const { payment: cashPaid } = await onlineOrder({ paymentStatus: "PAID", status: "ACCEPTED" });
  await prisma.restaurantOrderPayment.update({ where: { id: cashPaid.id }, data: { provider: "MANUAL" } });
  const { handleStripeConnectWebhook } = await import("../apps/api/src/modules/orderPayments/orderPaymentService.js");
  const result = await handleStripeConnectWebhook({
    id: `evt_${runId}_dup`, type: "payment_intent.succeeded", account: `acct_${runId}`,
    data: { object: { id: cashPaid.providerPaymentIntentId, amount: 1000, amount_received: 1000, currency: "usd", metadata: { orderPaymentId: cashPaid.id } } }
  });
  assert.equal(result.reviewRequired, true);
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: cashPaid.id, action: "order_payment.duplicate_settlement" } }));
});

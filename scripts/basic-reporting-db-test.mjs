// Database-backed test for the daily sales and reconciliation summary included with every plan.
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/basic-reporting-db-test.mjs
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
  console.log("SKIP basic reporting DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test", JWT_SECRET: "local-reporting-test" });
console.log = () => {};

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { buildBasicSalesSummary, listRestaurantPayments } = await import("../apps/api/src/services/basicReportingService.js");

const runId = `br${Date.now().toString(36)}`;
const ctx = {};
let counter = 0;

async function seedRestaurant(label) {
  const restaurant = await prisma.restaurant.create({
    data: { name: `Reporting ${label}`, slug: `${runId}-${label}`, status: "ACTIVE", timezone: "America/Denver", locations: { create: [{ name: "Main" }, { name: "Second" }] } },
    include: { locations: { orderBy: { createdAt: "asc" } } }
  });
  const customer = await prisma.customer.create({ data: { restaurantId: restaurant.id, name: "Guest", email: `guest-${label}-${runId}@example.test` } });
  const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Mains" } });
  const menuItem = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: "Plate", priceCents: 1000 } });
  return { restaurant, customer, menuItem, main: restaurant.locations[0], second: restaurant.locations[1] };
}

// One order with its payment, created "today" in the restaurant's timezone.
async function paidOrder(seed, { totalCents, status = "PAID", provider = "STRIPE_CONNECT", source = null, tipCents = 0, taxCents = 0, type = "PICKUP", locationId = seed.main.id, orderStatus = "PICKED_UP", createdAt = null }) {
  counter += 1;
  const order = await prisma.order.create({
    data: {
      restaurant: { connect: { id: seed.restaurant.id } },
      location: { connect: { id: locationId } },
      customer: { connect: { id: seed.customer.id } },
      orderNumber: `${runId}-${counter}`,
      type,
      status: orderStatus,
      subtotalCents: totalCents - taxCents - tipCents,
      taxCents,
      restaurantTipCents: tipCents,
      totalCents,
      ...(createdAt ? { createdAt } : {})
    }
  });
  const payment = await prisma.restaurantOrderPayment.create({
    data: {
      restaurantId: seed.restaurant.id,
      orderId: order.id,
      provider,
      status,
      subtotalCents: totalCents - taxCents - tipCents,
      totalCents,
      taxCents,
      restaurantTipCents: tipCents,
      restaurantGrossCents: totalCents,
      restaurantNetCents: totalCents,
      ...(source ? { quoteJson: { source } } : {}),
      ...(createdAt ? { createdAt } : {})
    }
  });
  return { order, payment };
}

before(async () => {
  ctx.a = await seedRestaurant("a");
  ctx.b = await seedRestaurant("b");
  ctx.online = await paidOrder(ctx.a, { totalCents: 2000, taxCents: 150, tipCents: 300 });
  ctx.cash = await paidOrder(ctx.a, { totalCents: 1000, provider: "MANUAL", source: "POS_CASH", type: "WALK_IN" });
  ctx.terminal = await paidOrder(ctx.a, { totalCents: 1500, source: "POS_TERMINAL", type: "WALK_IN" });
  ctx.pending = await paidOrder(ctx.a, { totalCents: 900, status: "REQUIRES_PAYMENT_METHOD", orderStatus: "PENDING" });
  ctx.cancelled = await paidOrder(ctx.a, { totalCents: 700, status: "CANCELED", orderStatus: "CANCELLED" });
  ctx.otherLocation = await paidOrder(ctx.a, { totalCents: 2500, locationId: ctx.a.second.id, type: "WALK_IN" });
  await prisma.restaurantRefund.create({
    data: { restaurantId: ctx.a.restaurant.id, orderPaymentId: ctx.online.payment.id, provider: "STRIPE_CONNECT", status: "SUCCEEDED", amountCents: 500, idempotencyKey: `rf_${runId}` }
  });
  // Another tenant's money on the same day must never appear.
  await paidOrder(ctx.b, { totalCents: 9999 });
  // Yesterday's sale must not appear in today's summary.
  await paidOrder(ctx.a, { totalCents: 4444, createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000) });
});

after(() => prisma.$disconnect());

test("the daily summary totals only this restaurant's settled money for the day", async () => {
  const summary = await buildBasicSalesSummary({ restaurantId: ctx.a.restaurant.id, day: "", locationId: "" });
  assert.equal(summary.payments.collectedCents, 2000 + 1000 + 1500 + 2500, "settled payments only");
  assert.equal(summary.payments.tipsCents, 300);
  assert.equal(summary.payments.restaurantTipsCents, 300, "restaurant tips are reported separately");
  assert.equal(summary.payments.driverTipsCents, 0, "driver tips are reported separately for tip-out");
  assert.equal(summary.payments.taxCollectedCents, 150);
  assert.equal(summary.refunds.amountCents, 500);
  assert.equal(summary.reconciliation.netCollectedCents, 7000 - 500);
  assert.equal(summary.reconciliation.platformFeeCents, 0, "Loohar takes no platform fee");
  assert.equal(summary.reconciliation.awaitingPaymentCount, 1);
  assert.equal(summary.reconciliation.awaitingPaymentCents, 900);
  assert.equal(summary.reconciliation.failedPaymentCount, 1);
  assert.equal(summary.orders.cancelledCount, 1);
  assert.equal(summary.orders.count, 5, "cancelled orders are excluded from the order count");
  assert.equal(summary.reconciliation.ordersWithoutSettledPaymentCount, 1);
});

test("payments are split by how the money was taken", async () => {
  const summary = await buildBasicSalesSummary({ restaurantId: ctx.a.restaurant.id, day: "", locationId: "" });
  const methods = Object.fromEntries(summary.payments.byMethod.map((row) => [row.method, row.amountCents]));
  assert.equal(methods.ONLINE_CARD, 2000 + 2500);
  assert.equal(methods.POS_CASH, 1000);
  assert.equal(methods.POS_CARD_PRESENT, 1500);
  assert.equal(summary.payments.settledCount, 4);
});

test("the summary can be scoped to one location", async () => {
  const summary = await buildBasicSalesSummary({ restaurantId: ctx.a.restaurant.id, day: "", locationId: ctx.a.second.id });
  assert.equal(summary.locationId, ctx.a.second.id);
  assert.equal(summary.payments.collectedCents, 2500);
  assert.equal(summary.orders.count, 1);
  assert.equal(summary.refunds.amountCents, 0);
});

test("another tenant's location and an unknown day are refused", async () => {
  const crossTenant = await buildBasicSalesSummary({ restaurantId: ctx.b.restaurant.id, day: "", locationId: "" });
  assert.equal(crossTenant.payments.collectedCents, 9999, "each tenant sees only its own money");
  await assert.rejects(
    () => buildBasicSalesSummary({ restaurantId: ctx.a.restaurant.id, day: "", locationId: ctx.b.main.id }),
    (error) => error.status === 404 && error.code === "LOCATION_NOT_FOUND"
  );
  await assert.rejects(
    () => buildBasicSalesSummary({ restaurantId: ctx.a.restaurant.id, day: "not-a-day", locationId: "" }),
    (error) => error.status === 400 && error.code === "REPORT_DAY_INVALID"
  );
});

test("an explicit past day reports that day in the restaurant's timezone", async () => {
  const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(yesterday);
  const summary = await buildBasicSalesSummary({ restaurantId: ctx.a.restaurant.id, day, locationId: "" });
  assert.equal(summary.range.day, day);
  assert.equal(summary.payments.collectedCents, 4444);
});

test("the payments list shows how each payment was taken and what is refundable", async () => {
  const { payments } = await listRestaurantPayments({ restaurantId: ctx.a.restaurant.id, day: "", locationId: "" });
  const byOrder = new Map(payments.map((payment) => [payment.orderId, payment]));
  const online = byOrder.get(ctx.online.order.id);
  assert.equal(online.method, "ONLINE_CARD");
  assert.equal(online.totalCents, 2000);
  assert.equal(online.refundedCents, 500, "successful refunds are subtracted");
  assert.equal(online.refundableCents, 1500);
  assert.equal(byOrder.get(ctx.cash.order.id).method, "POS_CASH");
  assert.equal(byOrder.get(ctx.terminal.order.id).method, "POS_CARD_PRESENT");

  const pending = byOrder.get(ctx.pending.order.id);
  assert.equal(pending.status, "REQUIRES_PAYMENT_METHOD");
  assert.equal(pending.refundableCents, 0, "an unpaid order is voided, never refunded");
  assert.equal("quoteJson" in online, false, "quote internals stay internal");
  assert.equal("checkoutIdempotencyKeyHash" in online, false);
});

test("the payments list is tenant and location scoped", async () => {
  const other = await listRestaurantPayments({ restaurantId: ctx.b.restaurant.id, day: "", locationId: "" });
  assert.equal(other.payments.length, 1);
  assert.equal(other.payments[0].totalCents, 9999);
  const scoped = await listRestaurantPayments({ restaurantId: ctx.a.restaurant.id, day: "", locationId: ctx.a.second.id });
  assert.equal(scoped.payments.length, 1);
  assert.equal(scoped.payments[0].orderId, ctx.otherLocation.order.id);
  await assert.rejects(
    () => listRestaurantPayments({ restaurantId: ctx.a.restaurant.id, day: "", locationId: ctx.b.main.id }),
    (error) => error.status === 404 && error.code === "LOCATION_NOT_FOUND"
  );
});

test("the dashboard payments page refunds through the payment, and voiding stays on orders", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync("apps/web/src/App.jsx", "utf8");
  assert.ok(app.includes('api("/api/order-payments/refund"'), "refunds use the guarded refund endpoint");
  assert.ok(app.includes('"Idempotency-Key": `refund-${payment.id}-${amountCents}-${draft.attempt || 1}`'), "each refund attempt carries its own idempotency key");
  assert.ok(app.includes("This payment has ${money(payment.refundableCents)} left to refund."), "a refund cannot exceed what is left");
  assert.ok(app.includes("reporting/payments"), "the page reads the payments list");
  assert.ok(app.includes("An order that was never paid is voided from Orders instead."), "voids and refunds stay distinct in the UI");
  const lifecycle = readFileSync("apps/api/src/services/orderLifecycleService.js", "utf8");
  assert.ok(lifecycle.includes("ORDER_REFUND_REQUIRED"), "a paid order cannot be voided without refunding first");
});

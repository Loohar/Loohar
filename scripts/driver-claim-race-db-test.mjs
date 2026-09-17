// Database-backed test for driver delivery claims and status transitions under concurrency.
// Requires a DISPOSABLE local PostgreSQL database with migrations applied:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --experimental-test-module-mocks scripts/driver-claim-race-db-test.mjs
// Authentication and plan guards are stubbed; they are certified by their own suites.
import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP driver claim DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test", JWT_SECRET: "local-driver-claim-test-secret" });

mock.module(new URL("../apps/api/src/middleware/auth.js", import.meta.url).href, {
  namedExports: {
    requireAuth: (req, res, next) => {
      req.user = { id: req.get("x-test-user-id"), role: "DRIVER" };
      next();
    },
    requireRole: () => (req, res, next) => next(),
    requireTenantAccess: (req, res, next) => next(),
    authenticateAccessToken: async () => null,
    authError: () => null
  }
});
mock.module(new URL("../apps/api/src/middleware/entitlements.js", import.meta.url).href, {
  namedExports: {
    featureGuard: () => (req, res, next) => next(),
    assertFeatureForRestaurant: async () => true,
    loadRestaurantEntitlements: async () => ({})
  }
});

const express = (await import("express")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const driverRoutes = (await import("../apps/api/src/routes/driver.js")).default;
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");

const app = express();
app.use(express.json());
app.use("/api/driver", driverRoutes);
app.use(errorHandler);

const runId = `l06${Date.now().toString(36)}`;
let server;
let baseUrl;
let restaurant;
let customer;
const drivers = [];
let orderCounter = 0;

async function call(method, path, userId, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": userId },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function deliveryOrder(overrides = {}) {
  orderCounter += 1;
  return prisma.order.create({
    data: {
      restaurant: { connect: { id: restaurant.id } },
      customer: { connect: { id: customer.id } },
      orderNumber: `${runId}-${orderCounter}`,
      type: "DELIVERY",
      status: "READY",
      subtotalCents: 2000,
      totalCents: 2000,
      driverTipCents: 300,
      deliveryAddress: "1 Test Street",
      ...overrides
    }
  });
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  restaurant = await prisma.restaurant.create({ data: { name: `L06 ${runId}`, slug: `${runId}-drivers`, status: "ACTIVE" } });
  customer = await prisma.customer.create({ data: { restaurantId: restaurant.id, name: "Delivery Customer", email: `delivery-${runId}@example.test` } });
  for (let index = 0; index < 8; index += 1) {
    const user = await prisma.user.create({
      data: { email: `driver${index}-${runId}@example.test`, passwordHash: "not-a-real-hash", name: `Driver ${index}`, role: "DRIVER", restaurantId: restaurant.id }
    });
    drivers.push(await prisma.driver.create({ data: { restaurantId: restaurant.id, userId: user.id } }));
  }
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
});

test("eight drivers claiming one new delivery produce exactly one owner", async () => {
  const order = await deliveryOrder();
  const results = await Promise.all(drivers.map((driver) => call("POST", `/api/driver/orders/${order.id}/claim`, driver.userId, { baseEarningsCents: 99999 })));
  const winners = results.filter((result) => result.status === 200);
  assert.equal(winners.length, 1, JSON.stringify(results.map((result) => result.status)));
  assert.ok(results.filter((result) => result.status !== 200).every((result) => result.status === 409));
  const delivery = await prisma.delivery.findUnique({ where: { orderId: order.id }, include: { statusHistory: true } });
  assert.equal(delivery.driverId, winners[0].body.delivery.driverId);
  assert.equal(delivery.statusHistory.filter((entry) => entry.status === "ACCEPTED").length, 1);
  assert.equal(delivery.baseEarningsCents, 500, "claiming driver cannot set base pay");
});

test("concurrent claims of an unassigned existing delivery produce exactly one owner", async () => {
  const order = await deliveryOrder();
  await prisma.delivery.create({
    data: { restaurantId: restaurant.id, orderId: order.id, status: "ASSIGNED", baseEarningsCents: 500, pickupAddress: "Restaurant", dropoffAddress: "Customer" }
  });
  const results = await Promise.all(drivers.map((driver) => call("POST", `/api/driver/orders/${order.id}/claim`, driver.userId)));
  assert.equal(results.filter((result) => result.status === 200).length, 1, JSON.stringify(results.map((result) => result.status)));
  const delivery = await prisma.delivery.findUnique({ where: { orderId: order.id }, include: { statusHistory: true } });
  assert.ok(delivery.driverId);
  assert.equal(delivery.status, "ACCEPTED");
  assert.equal(delivery.statusHistory.length, 1);
});

test("re-claiming is idempotent for the owner and cannot reset a finished delivery", async () => {
  const order = await deliveryOrder();
  const owner = drivers[0];
  assert.equal((await call("POST", `/api/driver/orders/${order.id}/claim`, owner.userId)).status, 200);
  assert.equal((await call("POST", `/api/driver/orders/${order.id}/claim`, owner.userId)).status, 200);
  const delivery = await prisma.delivery.findUnique({ where: { orderId: order.id }, include: { statusHistory: true } });
  assert.equal(delivery.statusHistory.length, 1, "idempotent re-claim adds no history");

  await prisma.delivery.update({ where: { id: delivery.id }, data: { status: "DELIVERED" } });
  await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
  const reclaim = await call("POST", `/api/driver/orders/${order.id}/claim`, owner.userId);
  assert.equal(reclaim.status, 409);
  assert.equal((await prisma.delivery.findUnique({ where: { id: delivery.id } })).status, "DELIVERED");
});

test("concurrent status transitions from the same state apply once", async () => {
  const order = await deliveryOrder();
  const owner = drivers[1];
  const claim = await call("POST", `/api/driver/orders/${order.id}/claim`, owner.userId);
  const deliveryId = claim.body.delivery.id;
  const results = await Promise.all(Array.from({ length: 5 }, () => call("PATCH", `/api/driver/deliveries/${deliveryId}/status`, owner.userId, { status: "PICKED_UP" })));
  assert.equal(results.filter((result) => result.status === 200).length, 1, JSON.stringify(results.map((result) => result.status)));
  assert.ok(results.filter((result) => result.status !== 200).every((result) => result.status === 409 || result.status === 400));
  const history = await prisma.deliveryStatusHistory.count({ where: { deliveryId, status: "PICKED_UP" } });
  assert.equal(history, 1);
  const orderHistory = await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: "PICKED_UP" } });
  assert.equal(orderHistory, 1);
});

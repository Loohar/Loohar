// Database-backed test for Starter plan entitlements: employee seats and POS register / kitchen
// display limits come from apps/shared/planEntitlements.js and hold under concurrency.
// Requires a DISPOSABLE local PostgreSQL database with migrations applied:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/starter-entitlements-db-test.mjs
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
  console.log("SKIP Starter entitlements DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "console",
  JWT_SECRET: "local-starter-test-secret",
  REFRESH_TOKEN_SECRET: "local-starter-test-refresh"
});
console.log = () => {};

const express = (await import("express")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const restaurantRoutes = (await import("../apps/api/src/routes/restaurant.js")).default;
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");
const { createAuthSession } = await import("../apps/api/src/services/authSessionService.js");
const { signAccessToken } = await import("../apps/api/src/utils/tokens.js");
const { registerPosDevice, updatePosDevice } = await import("../apps/api/src/services/posService.js");
const { PLAN_USAGE_LIMITS, USAGE_LIMIT } = await import("../apps/shared/planEntitlements.js");

const app = express();
app.use(express.json());
app.use("/api/restaurants", restaurantRoutes);
app.use(errorHandler);

const runId = `se${Date.now().toString(36)}`;
const STARTER_SEATS = PLAN_USAGE_LIMITS.STARTER[USAGE_LIMIT.STAFF_MEMBERS];
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

async function starterRestaurant(label) {
  // STANDARD classification with no subscription resolves to the Starter plan, exactly like a new pilot tenant.
  const restaurant = await prisma.restaurant.create({ data: { name: `Starter ${label}`, slug: `${runId}-${label}`, status: "ACTIVE" } });
  const owner = await prisma.user.create({
    data: { email: `owner-${label}-${runId}@example.test`, passwordHash: "x", name: "Owner", role: "TENANT_OWNER", restaurantId: restaurant.id, mfaEnabled: true, passwordChangedAt: new Date() }
  });
  await prisma.restaurantStaff.create({ data: { restaurantId: restaurant.id, userId: owner.id, role: "TENANT_OWNER", active: true } });
  const { session } = await createAuthSession({ user: owner, req: { headers: {} }, mfaVerifiedAt: new Date() });
  return { restaurant, owner, token: signAccessToken(owner, session) };
}

const employee = (label, role = "CASHIER") => ({ email: `${label}-${runId}@example.test`, name: label, role });
const seatUsers = (restaurantId) => prisma.user.count({ where: { restaurantId, role: { in: ["RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "DRIVER"] } } });

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { a: await starterRestaurant("a"), b: await starterRestaurant("b"), c: await starterRestaurant("c") });
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
});

test("Starter includes five employee seats; owners and admins do not use one", async () => {
  const { restaurant, token } = ctx.a;
  const admin = await prisma.user.create({ data: { email: `admin-a-${runId}@example.test`, passwordHash: "x", name: "Admin", role: "RESTAURANT_ADMIN", restaurantId: restaurant.id } });
  await prisma.restaurantStaff.create({ data: { restaurantId: restaurant.id, userId: admin.id, role: "RESTAURANT_ADMIN" } });
  assert.equal(STARTER_SEATS, 5);
  for (let index = 0; index < STARTER_SEATS; index += 1) {
    const role = ["CASHIER", "KITCHEN_STAFF", "RESTAURANT_MANAGER", "DRIVER", "CASHIER"][index];
    const created = await call("POST", `/api/restaurants/${restaurant.id}/employees`, { token, body: employee(`a${index}`, role) });
    assert.equal(created.status, 201, `employee ${index + 1} fits in Starter (${JSON.stringify(created.body)})`);
  }
  const sixth = await call("POST", `/api/restaurants/${restaurant.id}/employees`, { token, body: employee("a-sixth") });
  assert.equal(sixth.status, 403);
  assert.equal(sixth.body.code, "USAGE_LIMIT_REACHED");
  const viaStaff = await call("POST", `/api/restaurants/${restaurant.id}/staff`, { token, body: employee("a-staff") });
  assert.equal(viaStaff.status, 403, "the legacy staff route enforces the same seats");
  assert.equal(await seatUsers(restaurant.id), STARTER_SEATS);
});

test("suspended employees keep their seat", async () => {
  const { restaurant } = ctx.a;
  const cashier = await prisma.user.findFirst({ where: { restaurantId: restaurant.id, role: "CASHIER" } });
  await prisma.user.update({ where: { id: cashier.id }, data: { status: "SUSPENDED" } });
  const blocked = await call("POST", `/api/restaurants/${restaurant.id}/employees`, { token: ctx.a.token, body: employee("a-after-suspend") });
  assert.equal(blocked.status, 403);
});

test("concurrent invitations cannot exceed the seat limit", async () => {
  const { restaurant, token } = ctx.b;
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => call("POST", `/api/restaurants/${restaurant.id}/employees`, { token, body: employee(`b${index}`) })));
  assert.equal(results.filter((result) => result.status === 201).length, STARTER_SEATS);
  assert.equal(results.filter((result) => result.status === 403).length, 10 - STARTER_SEATS);
  assert.equal(await seatUsers(restaurant.id), STARTER_SEATS);
});

test("Starter allows one active register and one kitchen display", async () => {
  const { restaurant, owner } = ctx.c;
  const register = (fingerprint, deviceType = "POS_KIOSK") => registerPosDevice({ restaurantId: restaurant.id, user: owner, body: { name: fingerprint, deviceType }, fingerprint: `${runId}-${fingerprint}` });
  const outcome = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, status: error.status, code: error.code }));

  const first = await register("register-1");
  assert.equal(first.status, "ACTIVE");
  const second = await outcome(register("register-2"));
  assert.equal(second.ok, false);
  assert.equal(second.status, 403);
  assert.equal(second.code, "USAGE_LIMIT_REACHED");
  const again = await outcome(register("register-1"));
  assert.equal(again.ok, true, "re-registering the same device does not use another register");
  const renamed = await outcome(updatePosDevice({ restaurantId: restaurant.id, user: owner, deviceId: first.id, body: { name: "Front counter" } }));
  assert.equal(renamed.ok, true, "editing an active register is not blocked by its own seat");

  const kds = await outcome(register("kds-1", "KITCHEN_DISPLAY"));
  assert.equal(kds.ok, true, "the kitchen display is metered separately from the register");
  const secondKds = await outcome(register("kds-2", "KITCHEN_DISPLAY"));
  assert.equal(secondKds.status, 403);

  const pendingDevice = await prisma.posDevice.create({ data: { restaurantId: restaurant.id, name: "spare", deviceType: "POS_KIOSK", status: "PENDING" } });
  const activateSpare = await outcome(updatePosDevice({ restaurantId: restaurant.id, user: owner, deviceId: pendingDevice.id, body: { status: "ACTIVE" } }));
  assert.equal(activateSpare.status, 403, "activating a second register is blocked");
  const convertKds = await outcome(updatePosDevice({ restaurantId: restaurant.id, user: owner, deviceId: kds.value.id, body: { deviceType: "POS_KIOSK" } }));
  assert.equal(convertKds.status, 403, "changing a kitchen display into a register is blocked");

  await updatePosDevice({ restaurantId: restaurant.id, user: owner, deviceId: first.id, body: { status: "REVOKED" } });
  const replacement = await outcome(updatePosDevice({ restaurantId: restaurant.id, user: owner, deviceId: pendingDevice.id, body: { status: "ACTIVE" } }));
  assert.equal(replacement.ok, true, "revoking the old register frees the entitlement for a replacement");

  const concurrent = await Promise.all(["x1", "x2", "x3", "x4"].map((fingerprint) => outcome(register(fingerprint))));
  assert.equal(concurrent.filter((result) => result.ok).length, 0, "no concurrent registration exceeds the limit");
  assert.equal(await prisma.posDevice.count({ where: { restaurantId: restaurant.id, status: "ACTIVE", deviceType: { in: ["MAIN_TERMINAL", "POS_KIOSK", "APPROVED_MOBILE"] } } }), 1);
});

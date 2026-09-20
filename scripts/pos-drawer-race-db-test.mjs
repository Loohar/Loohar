// L-21: concurrent main-terminal registration must not create two cash drawers.
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --experimental-test-module-mocks scripts/pos-drawer-race-db-test.mjs
//
// PosDevice is unique on (restaurantId, deviceFingerprintHash), so the device row cannot duplicate.
// But both concurrent callers created a drawer *before* reaching that constraint, so the loser left
// an orphan drawer that no device points to: a cash-accountability row with no owner.
import assert from "node:assert/strict";
import { after, mock, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP POS drawer race DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test", JWT_SECRET: "local-pos-drawer-race-secret" });

// Plan entitlements are certified by their own suites; this test isolates drawer behaviour.
mock.module(new URL("../apps/api/src/middleware/entitlements.js", import.meta.url).href, {
  namedExports: {
    assertFeatureForRestaurant: async () => true,
    assertUsageLimitForRestaurant: async () => true,
    assertUsageWithinEntitlement: () => true,
    featureGuard: () => (req, res, next) => next(),
    loadRestaurantEntitlements: async () => ({})
  }
});

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { registerPosDevice, updatePosDevice } = await import("../apps/api/src/services/posService.js");

const runId = `l21${Date.now().toString(36)}`;
const settled = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code, status: error.status }));

async function seedRestaurant(label) {
  const restaurant = await prisma.restaurant.create({
    data: { name: `L21 ${label}`, slug: `${runId}-${label}`, status: "ACTIVE", locations: { create: [{ name: "Main" }] } },
    include: { locations: true }
  });
  const manager = await prisma.user.create({
    data: { email: `mgr-${runId}-${label}@example.test`, passwordHash: "not-a-real-hash", name: "Manager", role: "RESTAURANT_MANAGER", restaurantId: restaurant.id }
  });
  return { restaurant, manager, location: restaurant.locations[0] };
}

const drawersFor = (restaurantId) => prisma.cashDrawer.findMany({ where: { restaurantId, active: true } });
const devicesFor = (restaurantId) => prisma.posDevice.findMany({ where: { restaurantId } });

after(async () => {
  await prisma.$disconnect();
});

test("concurrent registration of the same terminal creates exactly one drawer", async () => {
  const shop = await seedRestaurant("same");
  const register = () => registerPosDevice({
    restaurantId: shop.restaurant.id,
    user: shop.manager,
    body: { name: "Front counter", deviceType: "MAIN_TERMINAL", locationId: shop.location.id },
    fingerprint: `fp-${runId}-same`
  });

  const results = await Promise.all([settled(register()), settled(register()), settled(register())]);
  assert.ok(results.some((result) => result.ok), "at least one registration must succeed");

  const devices = await devicesFor(shop.restaurant.id);
  const drawers = await drawersFor(shop.restaurant.id);
  assert.equal(devices.length, 1, "the fingerprint uniqueness already prevented a second device");
  assert.equal(drawers.length, 1, `one terminal must own exactly one drawer, found ${drawers.length}`);
  assert.equal(devices[0].cashDrawerId, drawers[0].id, "the device points at the surviving drawer");
  assert.equal(drawers[0].currentBalanceCents, 0);
  assert.equal(drawers[0].locationId, shop.location.id);
});

test("a repeated registration keeps reusing the same drawer", async () => {
  const shop = await seedRestaurant("repeat");
  const register = () => registerPosDevice({
    restaurantId: shop.restaurant.id,
    user: shop.manager,
    body: { name: "Front counter", deviceType: "MAIN_TERMINAL", locationId: shop.location.id },
    fingerprint: `fp-${runId}-repeat`
  });
  const first = await register();
  const second = await register();
  const drawers = await drawersFor(shop.restaurant.id);
  assert.equal(drawers.length, 1);
  assert.equal(second.cashDrawerId, first.cashDrawerId, "re-registering a terminal must not open a second drawer");
});

test("concurrent updates that each need a drawer create only one", async () => {
  const shop = await seedRestaurant("update");
  const device = await registerPosDevice({
    restaurantId: shop.restaurant.id,
    user: shop.manager,
    body: { name: "Counter", deviceType: "POS_KIOSK", locationId: shop.location.id },
    fingerprint: `fp-${runId}-update`
  });
  assert.equal(device.cashDrawerId, null, "a kiosk has no drawer");

  const promote = () => updatePosDevice({
    restaurantId: shop.restaurant.id,
    user: shop.manager,
    deviceId: device.id,
    body: { deviceType: "MAIN_TERMINAL" }
  });
  const results = await Promise.all([settled(promote()), settled(promote()), settled(promote())]);
  assert.ok(results.some((result) => result.ok), "at least one promotion must succeed");

  const drawers = await drawersFor(shop.restaurant.id);
  assert.equal(drawers.length, 1, `promoting a kiosk concurrently must open exactly one drawer, found ${drawers.length}`);
  const stored = await prisma.posDevice.findUnique({ where: { id: device.id } });
  assert.equal(stored.cashDrawerId, drawers[0].id);
});

test("a concurrent race in one restaurant never touches another tenant", async () => {
  const shopA = await seedRestaurant("tenant-a");
  const shopB = await seedRestaurant("tenant-b");
  const registerIn = (shop, suffix) => registerPosDevice({
    restaurantId: shop.restaurant.id,
    user: shop.manager,
    body: { name: "Counter", deviceType: "MAIN_TERMINAL", locationId: shop.location.id },
    fingerprint: `fp-${runId}-${suffix}`
  });

  // The same fingerprint string in both tenants: hashing is salted per restaurant, so these are
  // different devices and must not share or steal a drawer.
  await Promise.all([
    settled(registerIn(shopA, "shared")), settled(registerIn(shopA, "shared")),
    settled(registerIn(shopB, "shared")), settled(registerIn(shopB, "shared"))
  ]);

  const drawersA = await drawersFor(shopA.restaurant.id);
  const drawersB = await drawersFor(shopB.restaurant.id);
  assert.equal(drawersA.length, 1, `tenant A must own one drawer, found ${drawersA.length}`);
  assert.equal(drawersB.length, 1, `tenant B must own one drawer, found ${drawersB.length}`);
  assert.notEqual(drawersA[0].id, drawersB[0].id);
  assert.equal(drawersA[0].restaurantId, shopA.restaurant.id);
  assert.equal(drawersB[0].restaurantId, shopB.restaurant.id);
});

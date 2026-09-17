// Database-backed test for restaurant cash drawer setup and tenant validation of POS device and
// shift references. Requires a DISPOSABLE local PostgreSQL database with migrations applied:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --experimental-test-module-mocks scripts/pos-cash-drawer-setup-db-test.mjs
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
  console.log("SKIP POS cash drawer DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test", JWT_SECRET: "local-pos-drawer-test-secret" });

// Plan entitlements are certified by their own suites; this test isolates drawer behaviour.
mock.module(new URL("../apps/api/src/middleware/entitlements.js", import.meta.url).href, {
  namedExports: {
    assertFeatureForRestaurant: async () => true,
    featureGuard: () => (req, res, next) => next(),
    loadRestaurantEntitlements: async () => ({})
  }
});

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { openShift, closeShift, registerPosDevice, updatePosDevice, requireCashRegisterAccess } = await import("../apps/api/src/services/posService.js");

const runId = `l15${Date.now().toString(36)}`;
const outcome = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code, status: error.status }));

async function seedRestaurant(label) {
  const restaurant = await prisma.restaurant.create({
    data: { name: `L15 ${label}`, slug: `${runId}-${label}`, status: "ACTIVE", locations: { create: [{ name: "Main" }, { name: "Second" }] } },
    include: { locations: { orderBy: { createdAt: "asc" } } }
  });
  const manager = await prisma.user.create({
    data: { email: `manager-${runId}-${label}@example.test`, passwordHash: "not-a-real-hash", name: "Manager", role: "RESTAURANT_MANAGER", restaurantId: restaurant.id }
  });
  return { restaurant, manager, main: restaurant.locations[0], second: restaurant.locations[1] };
}

const a = await seedRestaurant("a");
const b = await seedRestaurant("b");

after(async () => {
  await prisma.$disconnect();
});

test("registering the first main terminal creates a closed drawer for its location", async () => {
  const device = await registerPosDevice({
    restaurantId: a.restaurant.id,
    user: a.manager,
    fingerprint: `${runId}-a-terminal-1`,
    body: { name: "Front Counter", deviceType: "MAIN_TERMINAL", locationId: a.main.id, cashDrawerId: null }
  });
  assert.ok(device.cashDrawerId);
  const drawer = await prisma.cashDrawer.findUnique({ where: { id: device.cashDrawerId } });
  assert.equal(drawer.restaurantId, a.restaurant.id);
  assert.equal(drawer.locationId, a.main.id);
  assert.equal(drawer.status, "CLOSED");
});

test("each main terminal gets its own drawer; re-registering keeps it; kiosks get none", async () => {
  const second = await registerPosDevice({
    restaurantId: a.restaurant.id,
    user: a.manager,
    fingerprint: `${runId}-a-terminal-2`,
    body: { name: "Bar", deviceType: "MAIN_TERMINAL", locationId: a.main.id }
  });
  const kiosk = await registerPosDevice({
    restaurantId: a.restaurant.id,
    user: a.manager,
    fingerprint: `${runId}-a-kiosk`,
    body: { name: "Kiosk", deviceType: "POS_KIOSK", locationId: a.main.id }
  });
  assert.equal(await prisma.cashDrawer.count({ where: { restaurantId: a.restaurant.id, locationId: a.main.id } }), 2);
  assert.equal(kiosk.cashDrawerId, null);
  assert.ok(second.cashDrawerId);
  const again = await registerPosDevice({
    restaurantId: a.restaurant.id, user: a.manager, fingerprint: `${runId}-a-terminal-2`,
    body: { name: "Bar", deviceType: "MAIN_TERMINAL", locationId: a.main.id }
  });
  assert.equal(again.cashDrawerId, second.cashDrawerId);
});

test("another restaurant's drawer, location, or register cannot be referenced", async () => {
  const foreignDevice = await registerPosDevice({
    restaurantId: b.restaurant.id,
    user: b.manager,
    fingerprint: `${runId}-b-terminal`,
    body: { name: "B Terminal", deviceType: "MAIN_TERMINAL", locationId: b.main.id }
  });
  const foreignDrawerId = foreignDevice.cashDrawerId;
  const foreignRegister = await prisma.posRegister.create({ data: { restaurantId: b.restaurant.id, name: "B Register" } });

  const viaRegister = await outcome(registerPosDevice({
    restaurantId: a.restaurant.id, user: a.manager, fingerprint: `${runId}-a-evil`,
    body: { deviceType: "MAIN_TERMINAL", locationId: a.main.id, cashDrawerId: foreignDrawerId }
  }));
  assert.equal(viaRegister.code, "POS_CASH_DRAWER_NOT_FOUND");

  const viaLocation = await outcome(registerPosDevice({
    restaurantId: a.restaurant.id, user: a.manager, fingerprint: `${runId}-a-evil-2`,
    body: { deviceType: "MAIN_TERMINAL", locationId: b.main.id }
  }));
  assert.equal(viaLocation.code, "POS_LOCATION_NOT_FOUND");

  const aDevice = await prisma.posDevice.findFirst({ where: { restaurantId: a.restaurant.id, deviceType: "MAIN_TERMINAL" } });
  const viaUpdate = await outcome(updatePosDevice({ restaurantId: a.restaurant.id, user: a.manager, deviceId: aDevice.id, body: { cashDrawerId: foreignDrawerId } }));
  assert.equal(viaUpdate.code, "POS_CASH_DRAWER_NOT_FOUND");

  const viaShiftDrawer = await outcome(openShift({ restaurantId: a.restaurant.id, user: a.manager, deviceId: null, body: { cashDrawerId: foreignDrawerId, openingCashCents: 500 } }));
  assert.equal(viaShiftDrawer.code, "POS_CASH_DRAWER_NOT_FOUND");
  const viaShiftRegister = await outcome(openShift({ restaurantId: a.restaurant.id, user: a.manager, deviceId: null, body: { registerId: foreignRegister.id } }));
  assert.equal(viaShiftRegister.code, "POS_REGISTER_NOT_FOUND");

  const untouched = await prisma.cashDrawer.findUnique({ where: { id: foreignDrawerId } });
  assert.equal(untouched.status, "CLOSED");
  assert.equal(await prisma.employeeShift.count({ where: { restaurantId: a.restaurant.id } }), 0);
});

test("a drawer from another location of the same restaurant is rejected", async () => {
  const secondLocationTerminal = await registerPosDevice({
    restaurantId: a.restaurant.id, user: a.manager, fingerprint: `${runId}-a-second-location`,
    body: { deviceType: "MAIN_TERMINAL", locationId: a.second.id }
  });
  const mainDrawer = await prisma.cashDrawer.findFirst({ where: { restaurantId: a.restaurant.id, locationId: a.main.id } });
  assert.notEqual(secondLocationTerminal.cashDrawerId, mainDrawer.id);
  const mismatch = await outcome(updatePosDevice({ restaurantId: a.restaurant.id, user: a.manager, deviceId: secondLocationTerminal.id, body: { cashDrawerId: mainDrawer.id } }));
  assert.equal(mismatch.code, "POS_CASH_DRAWER_LOCATION_MISMATCH");
});

test("clock-in opens the terminal drawer; a second cashier joins it without resetting the balance", async () => {
  const device = await prisma.posDevice.findFirst({ where: { restaurantId: a.restaurant.id, deviceType: "MAIN_TERMINAL", locationId: a.main.id }, orderBy: { createdAt: "asc" } });
  const shift = await openShift({ restaurantId: a.restaurant.id, user: a.manager, deviceId: device.id, body: { openingCashCents: 15000 } });
  assert.equal(shift.cashDrawerId, device.cashDrawerId);
  let drawer = await prisma.cashDrawer.findUnique({ where: { id: device.cashDrawerId } });
  assert.equal(drawer.status, "OPEN");
  assert.equal(drawer.currentBalanceCents, 15000);
  const access = await requireCashRegisterAccess({ restaurantId: a.restaurant.id, user: a.manager, deviceId: device.id, verifiedDevice: device });
  assert.equal(access.cashDrawer.id, device.cashDrawerId);

  const cashier2 = await prisma.user.create({
    data: { email: `manager2-${runId}@example.test`, passwordHash: "not-a-real-hash", name: "Manager Two", role: "RESTAURANT_MANAGER", restaurantId: a.restaurant.id }
  });
  const joined = await openShift({ restaurantId: a.restaurant.id, user: cashier2, deviceId: device.id, body: { openingCashCents: 1 } });
  assert.equal(joined.cashDrawerId, device.cashDrawerId);
  drawer = await prisma.cashDrawer.findUnique({ where: { id: device.cashDrawerId } });
  assert.equal(drawer.currentBalanceCents, 15000, "joining does not overwrite the counted balance");
  assert.equal(await prisma.cashDrawerSession.count({ where: { cashDrawerId: device.cashDrawerId, closedAt: null } }), 1);
  await requireCashRegisterAccess({ restaurantId: a.restaurant.id, user: cashier2, deviceId: device.id, verifiedDevice: device });

  await closeShift({ restaurantId: a.restaurant.id, user: a.manager, shiftId: shift.id, body: { closingCashCents: 15000 } });
  drawer = await prisma.cashDrawer.findUnique({ where: { id: device.cashDrawerId } });
  assert.equal(drawer.status, "OPEN", "drawer stays open while another shift uses it");
  const session = await prisma.cashDrawerSession.findFirst({ where: { cashDrawerId: device.cashDrawerId, closedAt: null } });
  assert.equal(session.shiftId, joined.id, "open session is handed to the remaining shift");

  const stale = await outcome(closeShift({ restaurantId: a.restaurant.id, user: a.manager, shiftId: shift.id, body: { closingCashCents: 0 } }));
  assert.equal(stale.code, "POS_SHIFT_ALREADY_CLOSED");
  assert.equal((await prisma.cashDrawer.findUnique({ where: { id: device.cashDrawerId } })).status, "OPEN", "stale clock-out does not close a drawer in use");

  await closeShift({ restaurantId: a.restaurant.id, user: cashier2, shiftId: joined.id, body: { closingCashCents: 16000 } });
  drawer = await prisma.cashDrawer.findUnique({ where: { id: device.cashDrawerId } });
  assert.equal(drawer.status, "CLOSED");
  assert.equal(drawer.currentBalanceCents, 16000);
});

test("a terminal can be revoked even if its drawer was deactivated", async () => {
  const terminal = await registerPosDevice({
    restaurantId: a.restaurant.id, user: a.manager, fingerprint: `${runId}-a-lost`,
    body: { name: "Lost tablet", deviceType: "MAIN_TERMINAL", locationId: a.main.id }
  });
  await prisma.cashDrawer.update({ where: { id: terminal.cashDrawerId }, data: { active: false } });
  const revoked = await updatePosDevice({ restaurantId: a.restaurant.id, user: a.manager, deviceId: terminal.id, body: { status: "REVOKED" } });
  assert.equal(revoked.status, "REVOKED");
  const demoted = await updatePosDevice({ restaurantId: a.restaurant.id, user: a.manager, deviceId: terminal.id, body: { deviceType: "POS_KIOSK" } });
  assert.equal(demoted.cashDrawerId, null, "non-main devices never keep a drawer");
});

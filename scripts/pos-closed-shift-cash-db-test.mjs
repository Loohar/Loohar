// An offline cash sale that arrives after its shift was closed must not rewrite the counted drawer.
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --test scripts/pos-closed-shift-cash-db-test.mjs
//
// A drawer's balance becomes the counted cash when its shift closes. An offline sale can arrive
// later: it happened during the shift, so those notes were already in the drawer when the cashier
// counted it. Incrementing the counted balance then would push the system above the physical count
// and quietly contradict the close. The sale still has to be recorded, because the money is real.
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
  console.log("SKIP POS closed-shift cash DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test", JWT_SECRET: "local-closed-shift-secret" });

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { settleCashOrderTransaction } = await import("../apps/api/src/services/posService.js");

const runId = `l28c${Date.now().toString(36)}`;
let seq = 0;

async function seed({ countedCents, shiftClosed }) {
  seq += 1;
  const restaurant = await prisma.restaurant.create({
    data: { name: `Closed shift ${seq}`, slug: `${runId}-${seq}`, status: "ACTIVE", locations: { create: { name: "Main" } } },
    include: { locations: true }
  });
  const location = restaurant.locations[0];
  const user = await prisma.user.create({
    data: { email: `cashier-${runId}-${seq}@example.test`, passwordHash: "not-a-real-hash", name: "Cashier", role: "RESTAURANT_MANAGER", restaurantId: restaurant.id }
  });
  const cashDrawer = await prisma.cashDrawer.create({
    data: { restaurantId: restaurant.id, locationId: location.id, name: "Front drawer", status: shiftClosed ? "CLOSED" : "OPEN", currentBalanceCents: countedCents }
  });
  const shift = await prisma.employeeShift.create({
    data: {
      restaurantId: restaurant.id,
      locationId: location.id,
      employeeUserId: user.id,
      cashDrawerId: cashDrawer.id,
      status: shiftClosed ? "CLOSED" : "OPEN",
      openingCashCents: countedCents,
      openedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      closedAt: shiftClosed ? new Date(Date.now() - 60 * 60 * 1000) : null,
      closingCashCents: shiftClosed ? countedCents : null
    }
  });
  const device = await prisma.posDevice.create({
    data: { restaurantId: restaurant.id, locationId: location.id, name: "Terminal", deviceType: "MAIN_TERMINAL", deviceFingerprintHash: `fp-${runId}-${seq}`, cashDrawerId: cashDrawer.id, status: "ACTIVE" }
  });
  const customer = await prisma.customer.create({
    data: { restaurantId: restaurant.id, name: "Walk-in", email: `walkin-${runId}-${seq}@example.test` }
  });
  const order = await prisma.order.create({
    data: {
      restaurant: { connect: { id: restaurant.id } },
      customer: { connect: { id: customer.id } },
      location: { connect: { id: location.id } },
      orderNumber: `${runId}${seq}`,
      type: "WALK_IN",
      status: "ACCEPTED",
      subtotalCents: 2000,
      totalCents: 2000
    },
    include: { payment: true }
  });
  return { restaurant, location, user, cashDrawer, shift, device, order };
}

const settle = (context, cashAppliedCents) => prisma.$transaction((tx) => settleCashOrderTransaction({
  tx,
  restaurantId: context.restaurant.id,
  user: context.user,
  order: { ...context.order, driverTipCents: 0 },
  device: context.device,
  shift: context.shift,
  cashDrawer: context.cashDrawer,
  settlement: { cashAppliedCents, cashTenderedCents: cashAppliedCents, changeDueCents: 0 },
  cashTender: { tenderedCents: cashAppliedCents, changeCents: 0 }
}));

const drawerOf = (id) => prisma.cashDrawer.findUnique({ where: { id } });

after(async () => {
  await prisma.$disconnect();
});

test("a sale settled during an open shift still adds to the drawer", async () => {
  const context = await seed({ countedCents: 10000, shiftClosed: false });
  const result = await settle(context, 2000);

  assert.equal(result.settledAfterShiftClose, false);
  assert.equal((await drawerOf(context.cashDrawer.id)).currentBalanceCents, 12000, "an open drawer takes the cash");
  assert.equal(result.payment.status, "PAID");
  assert.equal(result.ledger.amountCents, 2000);
});

test("a sale reconciled after its shift closed never rewrites the counted drawer", async () => {
  const counted = 10000;
  const context = await seed({ countedCents: counted, shiftClosed: true });
  const result = await settle(context, 2000);

  assert.equal(result.settledAfterShiftClose, true, "the caller must be told, so it can flag the shift");
  assert.equal(
    (await drawerOf(context.cashDrawer.id)).currentBalanceCents,
    counted,
    "the counted balance stands: those notes were already in the drawer when it was counted"
  );

  // The money is still recorded in full. Losing the sale would be worse than the variance.
  assert.equal(result.payment.status, "PAID");
  assert.equal(result.payment.amountCents, 2000);
  assert.equal(result.ledger.amountCents, 2000, "the ledger records the sale against its shift");
  assert.equal(result.ledger.shiftId, context.shift.id);
  assert.equal(result.ledger.cashDrawerId, context.cashDrawer.id);
  assert.ok(result.receipt, "a receipt is still produced");
});

test("the sale stays attributable to its own tenant and shift", async () => {
  const mine = await seed({ countedCents: 5000, shiftClosed: true });
  const theirs = await seed({ countedCents: 5000, shiftClosed: true });
  await settle(mine, 1500);

  assert.equal((await drawerOf(theirs.cashDrawer.id)).currentBalanceCents, 5000, "another tenant's drawer is untouched");
  const entries = await prisma.cashLedgerEntry.findMany({ where: { restaurantId: mine.restaurant.id } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].restaurantId, mine.restaurant.id);
  assert.equal((await prisma.cashLedgerEntry.count({ where: { restaurantId: theirs.restaurant.id } })), 0);
});

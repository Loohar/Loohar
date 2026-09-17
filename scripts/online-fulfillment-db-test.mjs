// Database-backed test: online quotes (and therefore checkout) only accept fulfilment the restaurant
// has switched on, and delivery requires an address.
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node --experimental-test-module-mocks scripts/online-fulfillment-db-test.mjs
import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
let host = "";
try {
  host = new URL(databaseUrl).hostname;
} catch {
  host = "";
}
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP online fulfilment DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test", JWT_SECRET: "local-fulfillment-test" });

// Tax profiles are certified by the tax suites; a fixed verified configuration keeps this test on fulfilment.
mock.module(new URL("../apps/api/src/services/taxProfileService.js", import.meta.url).href, {
  namedExports: {
    findValidLocationTaxConfiguration: async () => ({ id: "tax-test", configurationVersion: "test-v1", taxRateBps: 800, taxInclusive: false })
  }
});

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { calculateOrderQuote } = await import("../apps/api/src/modules/orderPayments/quoteService.js");

const runId = `of${Date.now().toString(36)}`;
const ctx = {};
const outcome = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code, status: error.status }));

async function seed(label, flags) {
  const restaurant = await prisma.restaurant.create({
    data: { name: `Fulfilment ${label}`, slug: `${runId}-${label}`, status: "ACTIVE", ...flags, locations: { create: { name: "Main" } } }
  });
  const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Mains" } });
  const item = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: "Plate", priceCents: 1200 } });
  return { restaurant, item };
}
const quote = ({ restaurant, item }, overrides = {}) => calculateOrderQuote({
  restaurantId: restaurant.id,
  body: { restaurantId: restaurant.id, type: "PICKUP", items: [{ menuItemId: item.id, quantity: 1 }], ...overrides }
});

before(async () => {
  ctx.both = await seed("both", { pickupEnabled: true, deliveryEnabled: true, deliveryFeeCents: 400 });
  ctx.pickupOnly = await seed("pickup", { pickupEnabled: true, deliveryEnabled: false });
  ctx.deliveryOnly = await seed("delivery", { pickupEnabled: false, deliveryEnabled: true });
});
after(() => prisma.$disconnect());

test("pickup-only restaurants refuse online delivery", async () => {
  const result = await outcome(quote(ctx.pickupOnly, { type: "DELIVERY", deliveryAddress: "100 Main St, Denver CO 80202" }));
  assert.equal(result.status, 400);
  assert.equal(result.code, "DELIVERY_UNAVAILABLE");
  assert.equal((await quote(ctx.pickupOnly)).deliveryFeeCents, 0);
});

test("restaurants with pickup switched off refuse online pickup", async () => {
  const result = await outcome(quote(ctx.deliveryOnly));
  assert.equal(result.code, "PICKUP_UNAVAILABLE");
});

test("delivery requires an address and charges the configured fee", async () => {
  const missing = await outcome(quote(ctx.both, { type: "DELIVERY", deliveryAddress: "  " }));
  assert.equal(missing.code, "DELIVERY_ADDRESS_REQUIRED");
  const accepted = await quote(ctx.both, { type: "DELIVERY", deliveryAddress: "100 Main St, Denver CO 80202" });
  assert.equal(accepted.deliveryFeeCents, 400);
  assert.equal(accepted.totalCents, 1200 + 96 + 400);
});

test("unknown fulfilment types are refused", async () => {
  const result = await outcome(quote(ctx.both, { type: "DINE_IN" }));
  assert.equal(result.code, "FULFILLMENT_TYPE_INVALID");
});

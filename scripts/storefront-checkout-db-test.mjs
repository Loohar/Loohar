// Database-backed HTTP test for the customer storefront payload used by web checkout.
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node --experimental-test-module-mocks scripts/storefront-checkout-db-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, mock, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
let host = "";
try {
  host = new URL(databaseUrl).hostname;
} catch {
  host = "";
}
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP storefront DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test", JWT_SECRET: "local-storefront-test" });
mock.module(new URL("../apps/api/src/middleware/entitlements.js", import.meta.url).href, {
  namedExports: { assertFeatureForRestaurant: async () => true, featureGuard: () => (req, res, next) => next(), loadRestaurantEntitlements: async () => ({}) }
});

const express = (await import("express")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const customerRoutes = (await import("../apps/api/src/routes/customer.js")).default;
const publicRoutes = (await import("../apps/api/src/routes/public.js")).default;
const { stripeSubscriptionPeriod } = await import("../apps/api/src/utils/stripeSubscriptionPeriod.js");
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");
const app = express();
app.use(express.json());
app.use("/api/customer", customerRoutes);
app.use("/api/public", publicRoutes);
app.use(errorHandler);

const runId = `sf${Date.now().toString(36)}`;
let server;
let baseUrl;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const restaurant = await prisma.restaurant.create({ data: { name: "Storefront", slug: `${runId}`, status: "ACTIVE", tenantClassification: "INTERNAL_DEVELOPMENT" } });
  const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Bowls" } });
  const item = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: "Bowl", priceCents: 1000 } });
  const group = await prisma.menuItemOptionGroup.create({ data: { menuItemId: item.id, name: "Protein", minSelect: 1, maxSelect: 1, required: true } });
  await prisma.menuItemOption.create({ data: { menuItemId: item.id, optionGroupId: group.id, name: "Chicken", priceCents: 0 } });
});
after(async () => {
  server?.close();
  await prisma.$disconnect();
});

for (const path of ["restaurants", "sites"]) {
  test(`/${path}/:slug exposes modifier groups but no internal tenant fields`, async () => {
    const response = await fetch(`${baseUrl}/api/customer/${path}/${runId}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const [item] = body.restaurant.categories[0].items;
    assert.equal(item.optionGroups.length, 1, "required modifier groups reach the storefront");
    assert.equal(item.optionGroups[0].options[0].name, "Chicken");
    for (const field of ["billingMode", "tenantClassification", "trialConfigJson", "paymentLifecycleStatus", "settingsJson", "tenantLifecycleStatus"]) {
      assert.equal(field in body.restaurant, false, `${field} is not public`);
    }
  });
}

const INTERNAL_FIELDS = ["billingMode", "tenantClassification", "trialConfigJson", "paymentLifecycleStatus", "settingsJson", "tenantLifecycleStatus", "trialEndsAt", "onboardingSkippedSteps", "deliveryZoneJson", "coupons"];
for (const path of [`restaurants/${"SLUG"}`, `sites/${"SLUG"}`, `restaurants/${"SLUG"}/site`, `sites/${"SLUG"}/site`, `restaurants/${"SLUG"}/order-config`]) {
  test(`/api/public/${path} returns no internal tenant fields`, async () => {
    const response = await fetch(`${baseUrl}/api/public/${path.replace("SLUG", runId)}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    for (const key of ["restaurant", "tenant"]) {
      if (!body[key]) continue;
      assert.equal(body[key].id !== undefined, true);
      for (const field of INTERNAL_FIELDS) assert.equal(field in body[key], false, `${key}.${field} is not public`);
    }
  });
}

test("subscription periods pair start and end from the item that renews first", () => {
  assert.deepEqual(stripeSubscriptionPeriod({ current_period_start: 10, current_period_end: 20 }), { currentPeriodStart: 10, currentPeriodEnd: 20 });
  assert.deepEqual(stripeSubscriptionPeriod({ items: { data: [
    { current_period_start: 100, current_period_end: 1000 },
    { current_period_start: 500, current_period_end: 600 }
  ] } }), { currentPeriodStart: 500, currentPeriodEnd: 600 });
  assert.deepEqual(stripeSubscriptionPeriod({ items: { data: [] } }), { currentPeriodStart: null, currentPeriodEnd: null });
  assert.deepEqual(stripeSubscriptionPeriod({}), { currentPeriodStart: null, currentPeriodEnd: null });
});

test("web checkout initialises Stripe.js with the restaurant's connected account", () => {
  const app = readFileSync("apps/web/src/App.jsx", "utf8");
  assert.ok(app.includes("Stripe(paymentPublicKey, { stripeAccount: paymentStripeAccount })"));
  assert.ok(app.includes('setPaymentStripeAccount(payload.stripeAccountId || "")'));
});

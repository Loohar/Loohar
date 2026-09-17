// Database-backed test for tips taken at the POS register.
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/pos-tips-db-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  console.log("SKIP POS tips DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test", JWT_SECRET: "local-pos-tips-test" });
console.log = () => {};

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { createPosQuote, submitPosOrder } = await import("../apps/api/src/services/posService.js");

const runId = `tip${Date.now().toString(36)}`;
const ctx = {};
const outcome = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, status: error.status, code: error.code, maxTipCents: error.maxTipCents }));

before(async () => {
  const restaurant = await prisma.restaurant.create({
    data: { name: `Tips ${runId}`, slug: `${runId}`, status: "ACTIVE", tenantClassification: "INTERNAL_DEVELOPMENT", locations: { create: { name: "Main" } } },
    include: { locations: true }
  });
  const owner = await prisma.user.create({
    data: { email: `owner-${runId}@example.test`, passwordHash: "x", name: "Owner", role: "TENANT_OWNER", restaurantId: restaurant.id }
  });
  await prisma.restaurantStaff.create({ data: { restaurantId: restaurant.id, userId: owner.id, role: "TENANT_OWNER", active: true } });
  const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Mains" } });
  const menuItem = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: "Plate", priceCents: 2000 } });
  const location = restaurant.locations[0];
  const verifiedAt = new Date(Date.now() - 60_000);
  await prisma.locationTaxProfile.create({
    data: {
      restaurantId: restaurant.id,
      locationId: location.id,
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
      provider: "MANUAL",
      source: "MANUAL_VERIFIED",
      taxRateBps: 800,
      taxInclusive: false,
      enabled: true,
      jurisdictionCode: "TEST",
      jurisdictionJson: { code: "TEST" },
      sourceMetadataJson: { source: "test-fixture" },
      effectiveAt: verifiedAt,
      verifiedAt,
      lastVerifiedAt: verifiedAt,
      configurationVersion: `${runId}-v1`,
      acknowledgementVersion: `${runId}-v1`,
      countryCode: "US",
      stateCode: "CO",
      acknowledgedAt: verifiedAt,
      acknowledgedByUserId: owner.id,
      activatedAt: verifiedAt
    }
  });
  Object.assign(ctx, { restaurant, owner, menuItem, location });
});

after(() => prisma.$disconnect());

const quoteFor = (tipCents) => createPosQuote({
  restaurantId: ctx.restaurant.id,
  user: ctx.owner,
  body: { orderType: "WALK_IN", locationId: ctx.location.id, tipCents, lineItems: [{ menuItemId: ctx.menuItem.id, quantity: 1 }] }
});

test("a register tip is added to the server-verified total and is not taxed", async () => {
  const withoutTip = await quoteFor(0);
  assert.equal(withoutTip.subtotalCents, 2000);
  assert.equal(withoutTip.taxCents, 160);
  assert.equal(withoutTip.totalCents, 2160);

  const withTip = await quoteFor(400);
  assert.equal(withTip.tipCents, 400);
  assert.equal(withTip.taxCents, 160, "tax is charged on the food, never on the tip");
  assert.equal(withTip.totalCents, 2560);
});

test("the tip reaches the order as a restaurant tip, never a driver tip", async () => {
  const quote = await quoteFor(300);
  const submitted = await submitPosOrder({
    restaurantId: ctx.restaurant.id,
    user: ctx.owner,
    quoteId: quote.id,
    customerJson: { name: "Counter guest" },
    notes: ""
  });
  const order = await prisma.order.findUnique({ where: { id: submitted.order.id } });
  assert.equal(order.tipCents, 300);
  assert.equal(order.restaurantTipCents, 300);
  assert.equal(order.driverTipCents, 0, "a counter tip never becomes a driver tip");
  assert.equal(order.totalCents, 2460);
});

test("a mistyped tip is refused instead of becoming a runaway charge", async () => {
  const negative = await outcome(quoteFor(-100));
  assert.equal(negative.code, "POS_TIP_INVALID");
  const absurd = await outcome(quoteFor(500_000));
  assert.equal(absurd.code, "POS_TIP_TOO_LARGE");
  assert.ok(absurd.maxTipCents > 0);
  const generousOnSmallCheck = await quoteFor(10_000);
  assert.equal(generousOnSmallCheck.tipCents, 10_000, "a large tip on a small check is still allowed");
});

test("the register asks for the tip before payment and re-quotes on the server", () => {
  const app = readFileSync("apps/web/src/App.jsx", "utf8");
  const screens = readFileSync("apps/web/src/apps/pos/PosWorkflowScreens.jsx", "utf8");
  assert.ok(app.includes("async function applyTip(nextTipCents)"));
  assert.ok(app.includes("await calculateQuote(cart, { tipCents: normalized })"), "changing the tip re-quotes on the server");
  assert.ok(app.includes("tipCents: quoteTipCents"), "the quote request carries the tip");
  assert.ok(screens.includes('aria-label="Tip"'), "the payment screen offers a tip");
  assert.ok(app.includes("Tips need an internet connection."), "offline orders cannot take a tip");
  const offlinePricing = readFileSync("apps/web/src/apps/pos/offlinePricing.js", "utf8");
  assert.ok(offlinePricing.includes("tipCents: 0"), "offline cached pricing still carries no tip");
});

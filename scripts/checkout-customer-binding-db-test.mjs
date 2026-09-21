// What an anonymous checkout may and may not do to someone else's customer record (L-28).
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --experimental-test-module-mocks --test scripts/checkout-customer-binding-db-test.mjs
//
// Checkout attaches an order to the restaurant's customer record for that email, which is how a
// returning guest keeps one history and their loyalty. Anyone can type someone else's address, so
// these are the boundaries that have to hold: their details are never read back to the person
// checking out, and never overwritten by what that person typed.
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
  console.log("SKIP checkout customer binding DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  JWT_SECRET: "local-checkout-customer-secret",
  STRIPE_CONNECT_SECRET_KEY: "sk_test_local_fake_checkout_customer"
});

const realFetch = globalThis.fetch;
let intents = 0;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).startsWith("https://api.stripe.com/v1/payment_intents")) return realFetch(url, options);
  intents += 1;
  const body = { id: `pi_bind_${intents}`, client_secret: `pi_bind_${intents}_secret`, status: "requires_payment_method", amount: Number(new URLSearchParams(options.body).get("amount")) };
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};

mock.module(new URL("../apps/api/src/modules/orderPayments/quoteService.js", import.meta.url).href, {
  namedExports: {
    calculateOrderQuote: async ({ restaurantId, body }) => {
      const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, include: { locations: true } });
      const quantity = body.items.reduce((sum, item) => sum + item.quantity, 0);
      const subtotalCents = 1000 * quantity;
      return {
        restaurant,
        locationId: restaurant.locations[0].id,
        currency: "usd",
        items: body.items.map((item) => ({ menuItemId: item.menuItemId, name: "Item", quantity: item.quantity, unitPriceCents: 1000 })),
        subtotalCents, discountCents: 0, couponCode: null, deliveryFeeCents: 0, taxCents: 0, taxableAmountCents: subtotalCents,
        tipCents: 0, restaurantTipCents: 0, driverTipCents: 0, customTipCents: 0, tipPercentage: null, tipType: "NONE",
        serviceFeeCents: 0, totalCents: subtotalCents, platformFeeCents: 0,
        restaurantGrossCents: subtotalCents, restaurantNetCents: subtotalCents,
        breakdown: {}, taxRateBps: 0, taxInclusive: false, taxProfileId: null, taxConfigurationVersion: "test-v1",
        zeroLooharPlatformFee: true, looharPlatformFeeCents: 0, processorFeesMayApply: true, paymentFeeDisclosure: "test",
        taxConfiguration: { provider: "TEST", source: "TEST", jurisdictionCode: "TEST", jurisdictionMetadata: {}, effectiveAt: null, verifiedAt: null }
      };
    }
  }
});

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { createOrderPayment } = await import("../apps/api/src/modules/orderPayments/orderPaymentService.js");

const runId = `cb${Date.now().toString(36)}`;
let seq = 0;
async function seedRestaurant() {
  seq += 1;
  const restaurant = await prisma.restaurant.create({
    data: { name: `Binding ${seq}`, slug: `${runId}-${seq}`, status: "ACTIVE", locations: { create: { name: "Main" } } }
  });
  await prisma.restaurantMerchantAccount.create({
    data: { restaurantId: restaurant.id, provider: "STRIPE_CONNECT", status: "ENABLED", stripeAccountId: `acct_${runId}_${seq}`, stripeChargesEnabled: true }
  });
  const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: "Mains" } });
  const menuItem = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: "Item", priceCents: 1000 } });
  return { restaurant, menuItemId: menuItem.id };
}
const checkout = (shop, customer, label) => createOrderPayment({
  body: { restaurantId: shop.restaurant.id, type: "PICKUP", items: [{ menuItemId: shop.menuItemId, quantity: 1 }], customer },
  idempotencyKey: `bind-${runId}-${label}-0000000000`
});

after(async () => {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
});

test("a stranger's checkout never overwrites an existing customer's details", async () => {
  const shop = await seedRestaurant();
  const email = `regular-${runId}@example.test`;
  const regular = await prisma.customer.create({
    data: { restaurantId: shop.restaurant.id, name: "Real Regular", email, phone: "3035550100", defaultAddress: "1 Real Street" }
  });

  await checkout(shop, { name: "Someone Else", email, phone: "3035559999" }, "overwrite");

  const after = await prisma.customer.findUnique({ where: { id: regular.id } });
  assert.equal(after.name, "Real Regular", "their name must not be rewritten by whoever typed the email");
  assert.equal(after.phone, "3035550100", "their phone must not be rewritten");
  assert.equal(after.defaultAddress, "1 Real Street", "their address must not be rewritten");
});

test("the checkout response tells the person nothing about the account they joined", async () => {
  const shop = await seedRestaurant();
  const email = `private-${runId}@example.test`;
  await prisma.customer.create({
    data: { restaurantId: shop.restaurant.id, name: "Private Person", email, phone: "3035550123", defaultAddress: "9 Private Lane" }
  });

  const response = await checkout(shop, { name: "Guest", email }, "readback");
  const serialised = JSON.stringify(response);
  assert.doesNotMatch(serialised, /Private Person/, "the existing customer's name must not come back");
  assert.doesNotMatch(serialised, /3035550123/, "their phone must not come back");
  assert.doesNotMatch(serialised, /Private Lane/, "their address must not come back");
});

test("a customer record stays inside its own restaurant", async () => {
  const mine = await seedRestaurant();
  const theirs = await seedRestaurant();
  const email = `shared-${runId}@example.test`;
  await prisma.customer.create({ data: { restaurantId: theirs.restaurant.id, name: "Their Regular", email, phone: "3035550777" } });

  await checkout(mine, { name: "My Guest", email }, "tenant");

  const inMine = await prisma.customer.findMany({ where: { restaurantId: mine.restaurant.id, email } });
  const inTheirs = await prisma.customer.findMany({ where: { restaurantId: theirs.restaurant.id, email } });
  assert.equal(inMine.length, 1, "a separate record is created for this restaurant");
  assert.equal(inMine[0].name, "My Guest");
  assert.equal(inTheirs.length, 1);
  assert.equal(inTheirs[0].name, "Their Regular", "the other restaurant's customer is untouched");
  assert.notEqual(inMine[0].id, inTheirs[0].id, "the same email in two restaurants is two records");
});

test("joining a registered customer's account is recorded for the restaurant to see", async () => {
  const shop = await seedRestaurant();
  const email = `member-${runId}@example.test`;
  const account = await prisma.user.create({
    data: { email, passwordHash: "not-a-real-hash", name: "Member", role: "CUSTOMER" }
  });
  const customer = await prisma.customer.create({
    data: { restaurantId: shop.restaurant.id, name: "Member", email, userId: account.id }
  });

  await checkout(shop, { name: "Walk Up", email }, "account");

  const audits = await prisma.auditLog.findMany({
    where: { restaurantId: shop.restaurant.id, action: "order.anonymous_checkout_joined_customer_account" }
  });
  assert.equal(audits.length, 1, "the restaurant must be able to see a stranger's order joining an account");
  assert.equal(audits[0].entityId, customer.id);
  assert.equal(audits[0].metadataJson.requiresReview, true);
});

test("a returning guest with no account keeps one record and is not flagged", async () => {
  const shop = await seedRestaurant();
  const email = `guest-${runId}@example.test`;

  await checkout(shop, { name: "Repeat Guest", email }, "guest-one");
  await checkout(shop, { name: "Repeat Guest", email }, "guest-two");

  const records = await prisma.customer.findMany({ where: { restaurantId: shop.restaurant.id, email } });
  assert.equal(records.length, 1, "a returning guest keeps one history rather than a new record each time");
  const audits = await prisma.auditLog.count({
    where: { restaurantId: shop.restaurant.id, action: "order.anonymous_checkout_joined_customer_account" }
  });
  assert.equal(audits, 0, "an ordinary returning guest is not noise in the audit log");
});

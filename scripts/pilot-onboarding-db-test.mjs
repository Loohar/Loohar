// End-to-end pilot readiness: a brand new restaurant signs up, is provisioned on Starter, configures
// tax and payments, and then takes money at the register and online. Every step runs the real
// services against a disposable local database; Stripe is stubbed locally.
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/pilot-onboarding-db-test.mjs
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
  console.log("SKIP pilot onboarding DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "console",
  JWT_SECRET: "local-onboarding-test-secret",
  REFRESH_TOKEN_SECRET: "local-onboarding-test-refresh",
  STRIPE_CONNECT_SECRET_KEY: "sk_test_local_fake_onboarding"
});
console.log = () => {};

const runId = `ob${Date.now().toString(36)}`;
const realFetch = globalThis.fetch;
const stripeCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (!target.startsWith("https://api.stripe.com/")) return realFetch(url, options);
  stripeCalls.push({ url: target, idempotencyKey: options.headers?.["Idempotency-Key"], body: options.body });
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (target.endsWith("/v2/core/accounts")) {
    return json({
      id: `acct_${runId}`,
      object: "v2.core.account",
      configuration: { merchant: { capabilities: { card_payments: { status: "pending" } } } },
      requirements: { currently_due: ["business_profile.url"] }
    });
  }
  if (target.endsWith("/v2/core/account_links")) {
    return json({ url: `https://connect.stripe.com/setup/${runId}`, expires_at: Math.floor(Date.now() / 1000) + 3600 });
  }
  if (target.endsWith("/payment_intents")) {
    const body = Object.fromEntries(new URLSearchParams(String(options.body || "")));
    return json({ id: `pi_${runId}`, object: "payment_intent", status: "requires_payment_method", amount: Number(body.amount), client_secret: `pi_${runId}_secret_x` });
  }
  return json({ id: `obj_${runId}` });
};

const { prisma } = await import("../apps/api/src/config/prisma.js");
const { startRegistration, createRegistrationIntroTrial } = await import("../apps/api/src/modules/registration/registrationService.js");
const { loadRestaurantEntitlements } = await import("../apps/api/src/middleware/entitlements.js");
const { entitlementLimitForPlan, USAGE_LIMIT } = await import("../apps/api/src/config/entitlements.js");
const { createPosQuote } = await import("../apps/api/src/services/posService.js");
const { createMerchantOnboardingLink, createOrderPayment } = await import("../apps/api/src/modules/orderPayments/orderPaymentService.js");

const ctx = {};
const outcome = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, status: error.status, code: error.code, message: error.message }));

after(async () => {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
});

before(async () => {
  // Plans must exist before a public signup can pick one, exactly as on a provisioned environment.
  for (const [code, name, price] of [["STARTER", "Starter", 9900], ["PROFESSIONAL", "Professional", 19900], ["ENTERPRISE", "Enterprise", 39900]]) {
    await prisma.platformPlan.upsert({ where: { code }, create: { code, name, monthlyPriceCents: price }, update: {} });
    await prisma.subscriptionPlan.upsert({ where: { code }, create: { code, name, monthlyPriceCents: price }, update: {} });
  }
});

test("a public signup provisions a working Starter restaurant", async () => {
  const registration = await startRegistration({
    body: {
      firstName: "Pilot",
      lastName: "Owner",
      email: `owner-${runId}@example.test`,
      password: "a-strong-pilot-password",
      businessName: `Pilot Diner ${runId}`,
      address: "200 Signup Street",
      city: "Denver",
      state: "CO",
      zip: "80202",
      country: "US",
      publicBusinessName: `Pilot Diner ${runId}`,
      preferredSlug: `pilot-${runId}`,
      businessType: "RESTAURANT",
      planCode: "STARTER",
      phone: "555-0100"
    }
  });
  assert.ok(registration.registration?.id, "the signup is recorded before any money is taken");

  const provisioned = await createRegistrationIntroTrial({ registrationId: registration.registration.id, planCode: "STARTER", billingInterval: "MONTHLY" });
  ctx.restaurantId = provisioned.restaurant?.id;
  assert.ok(ctx.restaurantId, "the trial provisions a real restaurant");

  const owner = await prisma.user.findFirst({ where: { restaurantId: ctx.restaurantId, role: "TENANT_OWNER" } });
  assert.ok(owner, "the owner account is attached to the restaurant");
  assert.equal(owner.status, "ACTIVE");
  ctx.owner = owner;

  const location = await prisma.restaurantLocation.findFirst({ where: { restaurantId: ctx.restaurantId } });
  assert.ok(location, "the restaurant has a location to sell from");
  ctx.location = location;

  // Tax verification reads the street line from `address` and city/state/zip from settings. Without
  // them a new restaurant cannot resolve its jurisdiction, so it could never sell.
  const { normalizeBusinessAddress, validateBusinessAddress } = await import("../apps/api/src/services/taxDomain.js");
  const address = normalizeBusinessAddress(location);
  assert.equal(address.addressLine1, "200 Signup Street");
  assert.equal(address.city, "Denver");
  assert.equal(address.stateProvince, "CO");
  assert.equal(address.postalCode, "80202");
  assert.equal(validateBusinessAddress(address).valid, true, "the address captured at signup is ready for tax verification");
});

test("the new restaurant is on Starter with the pilot entitlements", async () => {
  const entitlement = await loadRestaurantEntitlements(ctx.restaurantId);
  assert.equal(entitlement.planCode, "STARTER");
  assert.equal(["ACTIVE", "TRIALING"].includes(entitlement.subscriptionStatus), true, `subscription is usable (${entitlement.subscriptionStatus})`);
  assert.equal(entitlementLimitForPlan(entitlement.planCode, USAGE_LIMIT.STAFF_MEMBERS), 5, "five employee seats");
  assert.equal(entitlementLimitForPlan(entitlement.planCode, USAGE_LIMIT.POS_REGISTERS), 1, "one register");
  assert.equal(entitlementLimitForPlan(entitlement.planCode, USAGE_LIMIT.KITCHEN_DISPLAYS), 1, "one kitchen display");
  assert.equal(entitlementLimitForPlan(entitlement.planCode, USAGE_LIMIT.LOCATIONS), 1, "one location");
});

test("nothing can be sold until tax is configured, and then the register works", async () => {
  const category = await prisma.menuCategory.create({ data: { restaurantId: ctx.restaurantId, name: "Mains" } });
  ctx.menuItem = await prisma.menuItem.create({ data: { restaurantId: ctx.restaurantId, categoryId: category.id, name: "Pilot Plate", priceCents: 1800 } });

  const beforeTax = await outcome(createPosQuote({
    restaurantId: ctx.restaurantId,
    user: ctx.owner,
    body: { orderType: "WALK_IN", locationId: ctx.location.id, lineItems: [{ menuItemId: ctx.menuItem.id, quantity: 1 }] }
  }));
  assert.equal(beforeTax.ok, false, "a restaurant without a verified tax profile cannot sell");
  assert.equal(beforeTax.code, "POS_TAX_CONFIGURATION_REQUIRED");

  const verifiedAt = new Date(Date.now() - 60_000);
  await prisma.locationTaxProfile.create({
    data: {
      restaurantId: ctx.restaurantId,
      locationId: ctx.location.id,
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
      provider: "MANUAL",
      source: "MANUAL_VERIFIED",
      taxRateBps: 825,
      taxInclusive: false,
      enabled: true,
      countryCode: "US",
      stateCode: "CO",
      jurisdictionCode: "US:CO:DENVER",
      jurisdictionJson: { code: "US:CO:DENVER" },
      sourceMetadataJson: { source: "pilot-onboarding-test" },
      effectiveAt: verifiedAt,
      verifiedAt,
      lastVerifiedAt: verifiedAt,
      configurationVersion: `${runId}-v1`,
      acknowledgementVersion: `${runId}-v1`,
      acknowledgedAt: verifiedAt,
      acknowledgedByUserId: ctx.owner.id,
      activatedAt: verifiedAt
    }
  });

  const quote = await createPosQuote({
    restaurantId: ctx.restaurantId,
    user: ctx.owner,
    body: { orderType: "WALK_IN", locationId: ctx.location.id, tipCents: 200, lineItems: [{ menuItemId: ctx.menuItem.id, quantity: 1 }] }
  });
  assert.equal(quote.subtotalCents, 1800);
  assert.equal(quote.taxCents, 149, "tax comes from the restaurant's own verified profile, never a default rate");
  assert.equal(quote.tipCents, 200);
  assert.equal(quote.totalCents, 2149);
});

test("payment onboarding creates the restaurant's own Stripe account and a setup link", async () => {
  await prisma.restaurant.update({ where: { id: ctx.restaurantId }, data: { email: `contact-${runId}@example.test` } });
  const { onboardingUrl, merchantAccount } = await createMerchantOnboardingLink({ user: ctx.owner });
  assert.match(onboardingUrl, /^https:\/\/connect\.stripe\.com\//, "the owner is sent to Stripe to finish onboarding");
  assert.equal(merchantAccount.stripeAccountId, `acct_${runId}`, "the account belongs to this restaurant");
  assert.equal(merchantAccount.restaurantId, ctx.restaurantId);
  assert.equal(merchantAccount.stripeChargesEnabled, false, "readiness comes from Stripe, never assumed");
  assert.equal(merchantAccount.status, "ACTION_REQUIRED");
  assert.ok(merchantAccount.onboardingUrlExpiresAt, "the setup link has an expiry");

  const accountCalls = stripeCalls.filter((call) => call.url.endsWith("/v2/core/accounts"));
  assert.equal(accountCalls.length, 1);
  assert.ok(accountCalls[0].idempotencyKey, "account creation is idempotent, so a retry cannot make a second account");

  // A second request reuses the same connected account rather than creating another.
  await createMerchantOnboardingLink({ user: ctx.owner });
  assert.equal(stripeCalls.filter((call) => call.url.endsWith("/v2/core/accounts")).length, 1, "the restaurant keeps one Stripe account");

  const otherTenant = await outcome(createMerchantOnboardingLink({ user: { id: ctx.owner.id, restaurantId: null } }));
  assert.equal(otherTenant.ok, false, "a user without a restaurant cannot start onboarding");
  assert.equal(otherTenant.status, 403);
});

test("online orders wait for payment onboarding, then take a card", async () => {
  const body = {
    restaurantId: ctx.restaurantId,
    type: "PICKUP",
    customer: { name: "First Guest", email: `guest-${runId}@example.test` },
    items: [{ menuItemId: ctx.menuItem.id, quantity: 2 }]
  };
  const beforeOnboarding = await outcome(createOrderPayment({ body, idempotencyKey: `onboarding-${runId}-1` }));
  assert.equal(beforeOnboarding.ok, false, "a restaurant that has not onboarded cannot take card payments");
  assert.equal(beforeOnboarding.status, 503);

  // Stripe reports the account is ready once the owner finishes onboarding.
  await prisma.restaurantMerchantAccount.update({
    where: { restaurantId_provider: { restaurantId: ctx.restaurantId, provider: "STRIPE_CONNECT" } },
    data: { status: "ENABLED", stripeChargesEnabled: true, stripeDetailsSubmitted: true }
  });

  const checkout = await createOrderPayment({ body, idempotencyKey: `onboarding-${runId}-2` });
  assert.equal(checkout.payment.totalCents, 3600 + 297, "the customer is charged the menu price plus the restaurant's tax");
  assert.equal(checkout.stripeAccountId, `acct_${runId}`, "the browser is told which connected account to confirm on");
  assert.ok(checkout.clientSecret, "the customer can complete the payment");
  assert.equal(checkout.payment.status, "REQUIRES_PAYMENT_METHOD", "nothing is marked paid before the webhook");
});

test("a restaurant can supply its own tax category instead of Loohar guessing one", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync("apps/web/src/App.jsx", "utf8");
  assert.ok(app.includes("async function resolveTaxProfileForLocation(location, { productServiceId } = {})"), "tax verification accepts a category");
  assert.ok(app.includes("body: category ? { productServiceId: category } : {}"), "the category is sent to the API when supplied");
  assert.ok(app.includes("Product or service category"), "the restaurant is asked for its category");
  assert.ok(app.includes("Loohar will not choose a category for you."), "Loohar never guesses a tax category");
  const domain = readFileSync("apps/api/src/services/taxDomain.js", "utf8");
  assert.equal(domain.includes("productServiceId: 626"), false, "no product service is hardcoded as a restaurant default");
});

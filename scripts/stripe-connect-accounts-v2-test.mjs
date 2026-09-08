import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { disconnectPrisma } from "../apps/api/src/config/prisma.js";
import {
  assertStripeConnectModeAllowed,
  stripeKeyMode,
  stripeRequest,
  stripeV2Request,
  verifyStripeWebhook
} from "../apps/api/src/modules/paymentProviders/stripeRest.js";
import {
  buildStripeConnectAccountLinkV2Body,
  buildStripeConnectAccountV2Body,
  normalizeStripeConnectAccountReadiness,
  stripeConnectAccountIdempotencyKey
} from "../apps/api/src/modules/orderPayments/orderPaymentService.js";

const root = process.cwd();
const failures = [];
const savedFetch = globalThis.fetch;
const savedEnv = {
  APP_ENV: process.env.APP_ENV,
  DEPLOY_ENV: process.env.DEPLOY_ENV,
  LOOHAR_ENV: process.env.LOOHAR_ENV,
  NODE_ENV: process.env.NODE_ENV,
  ORDER_PAYMENT_CURRENCY: process.env.ORDER_PAYMENT_CURRENCY,
  STRIPE_ACCOUNTS_V2_API_VERSION: process.env.STRIPE_ACCOUNTS_V2_API_VERSION,
  STRIPE_CONNECT_COUNTRY: process.env.STRIPE_CONNECT_COUNTRY,
  STRIPE_CONNECT_SECRET_KEY: process.env.STRIPE_CONNECT_SECRET_KEY,
  VERCEL_ENV: process.env.VERCEL_ENV
};

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function withEnv(nextEnv, assertion) {
  restoreEnv();
  for (const key of Object.keys(savedEnv)) delete process.env[key];
  Object.assign(process.env, nextEnv);
  assertion();
}

function read(filePath) {
  const absolutePath = join(root, filePath);
  assert.ok(existsSync(absolutePath), `Missing required file: ${filePath}`);
  return readFileSync(absolutePath, "utf8");
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function check(condition, message) {
  try {
    assert.ok(condition, message);
    pass(message);
  } catch (error) {
    failures.push(error.message);
    console.error(`FAIL ${message}`);
  }
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

function signStripePayload(rawBody, webhookSecret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function runStripeRequestMocks() {
  process.env.STRIPE_ACCOUNTS_V2_API_VERSION = "2026-08-26.dahlia";
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "acct_test_accounts_v2", object: "v2.core.account" })
    };
  };

  await stripeV2Request({
    secretKey: "sk_test_mocked",
    path: "/core/accounts",
    body: { display_name: "Loohar Test Kitchen" },
    idempotencyKey: stripeConnectAccountIdempotencyKey("restaurant_alpha")
  });
  assert.equal(calls[0].url, "https://api.stripe.com/v2/core/accounts");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Stripe-Version"], "2026-08-26.dahlia");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "loohar:stripe-connect:v2-account:restaurant_alpha");
  assert.deepEqual(calls[0].body, { display_name: "Loohar Test Kitchen" });
  pass("Accounts v2 request uses JSON, Stripe-Version, and deterministic idempotency headers");

  await stripeV2Request({
    secretKey: "sk_test_mocked",
    path: "/core/accounts/acct_test_accounts_v2?include=configuration.merchant",
    method: "GET",
    stripeContext: "acct_context"
  });
  assert.equal(calls[1].url, "https://api.stripe.com/v2/core/accounts/acct_test_accounts_v2?include=configuration.merchant");
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[1].options.headers["Stripe-Context"], "acct_context");
  assert.equal(calls[1].body, null);
  pass("Accounts v2 GET requests can include Stripe-Context for thin event resource fetches");

  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: {
        type: "invalid_request_error",
        code: "parameter_invalid",
        message: "Rejected sk_test_secretvalue whsec_secretvalue pi_123_secret_sensitive"
      }
    })
  });
  await assert.rejects(
    () => stripeV2Request({ secretKey: "sk_test_mocked", path: "/core/accounts", body: { display_name: "Bad" } }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "parameter_invalid");
      assert.equal(error.stripeErrorType, "invalid_request_error");
      assert.ok(!error.message.includes("sk_test_secretvalue"));
      assert.ok(!error.message.includes("whsec_secretvalue"));
      assert.ok(!error.message.includes("pi_123_secret_sensitive"));
      return true;
    }
  );
  pass("Accounts v2 API errors are sanitized before surfacing");

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: options.body?.toString() || "" });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "pi_mock", status: "requires_payment_method" })
    };
  };
  await stripeRequest({
    secretKey: "sk_test_mocked",
    path: "/payment_intents",
    body: new URLSearchParams({ amount: "1000", currency: "usd" }),
    stripeAccount: "acct_restaurant"
  });
  const v1Call = calls.at(-1);
  assert.equal(v1Call.url, "https://api.stripe.com/v1/payment_intents");
  assert.equal(v1Call.options.headers["Stripe-Account"], "acct_restaurant");
  pass("Existing v1 direct-charge request helper remains available for PaymentIntents");
}

async function main() {
  const orderService = read("apps/api/src/modules/orderPayments/orderPaymentService.js");
  const orderRoutes = read("apps/api/src/routes/orderPayments.js");
  const server = read("apps/api/src/server.js");
  const webhooks = read("apps/api/src/routes/webhooks.js");
  const apiEnv = read("apps/api/.env.example");
  const schema = read("apps/api/prisma/schema.prisma");

  const accountBody = buildStripeConnectAccountV2Body({
    restaurant: {
      id: "restaurant_alpha",
      businessName: "Loohar Test Kitchen",
      name: "Fallback Kitchen",
      email: "Owner@Test.Loohar"
    },
    user: { id: "user_owner", email: "ignored-owner@example.test" }
  });
  assert.equal(accountBody.dashboard, "express");
  assert.equal(accountBody.contact_email, "owner@test.loohar");
  assert.equal(accountBody.display_name, "Loohar Test Kitchen");
  assert.equal(accountBody.identity.country, "us");
  assert.equal(accountBody.identity.entity_type, "company");
  assert.equal(accountBody.configuration.merchant.capabilities.card_payments.requested, true);
  assert.equal(accountBody.defaults.currency, "usd");
  assert.equal(accountBody.defaults.responsibilities.fees_collector, "application");
  assert.equal(accountBody.defaults.responsibilities.losses_collector, "application");
  assert.equal(accountBody.metadata.restaurantId, "restaurant_alpha");
  assert.equal(accountBody.metadata.domain, "MERCHANT_ACCOUNT");
  assert.deepEqual(accountBody.include, ["configuration.merchant", "requirements", "future_requirements", "identity", "defaults"]);
  check(!JSON.stringify(accountBody).match(/STRIPE_|SECRET|WEBHOOK|DATABASE_URL|JWT/i), "Accounts v2 create body excludes sensitive environment data");
  pass("Accounts v2 create body maps Loohar restaurants to merchant Express accounts");

  const noEmailBody = buildStripeConnectAccountV2Body({
    restaurant: { id: "restaurant_beta", businessName: "No Email Kitchen" },
    user: { id: "user_owner", email: "owner@example.test" }
  });
  check(!Object.prototype.hasOwnProperty.call(noEmailBody, "contact_email"), "Account creation does not fall back to arbitrary frontend/user email");

  const linkBody = buildStripeConnectAccountLinkV2Body({
    accountId: "acct_test_accounts_v2",
    refreshUrl: "https://loohar.test/refresh",
    returnUrl: "https://loohar.test/return"
  });
  assert.equal(linkBody.account, "acct_test_accounts_v2");
  assert.equal(linkBody.use_case.type, "account_onboarding");
  assert.deepEqual(linkBody.use_case.account_onboarding.configurations, ["merchant"]);
  assert.equal(linkBody.use_case.account_onboarding.refresh_url, "https://loohar.test/refresh");
  assert.equal(linkBody.use_case.account_onboarding.return_url, "https://loohar.test/return");
  pass("Accounts v2 account-link body preserves refresh/return URLs and merchant configuration");

  const ready = normalizeStripeConnectAccountReadiness({
    id: "acct_ready",
    object: "v2.core.account",
    configuration: {
      merchant: {
        capabilities: {
          card_payments: { status: "active", status_details: [] },
          stripe_balance: { payouts: { status: "active", status_details: [] } }
        }
      }
    },
    requirements: { entries: [] },
    future_requirements: { entries: [] }
  });
  assert.equal(ready.providerAccountId, "acct_ready");
  assert.equal(ready.chargesEnabled, true);
  assert.equal(ready.payoutsEnabled, true);
  assert.equal(ready.onboardingComplete, true);
  assert.equal(ready.readinessStatus, "ENABLED");
  pass("Accounts v2 active card payment and payout capabilities map to ENABLED");

  const actionRequired = normalizeStripeConnectAccountReadiness({
    id: "acct_due",
    object: "v2.core.account",
    configuration: {
      merchant: {
        capabilities: {
          card_payments: { status: "pending", status_details: [{ code: "requirements_past_due" }] },
          stripe_balance: { payouts: { status: "pending", status_details: [{ code: "requirements_pending_verification" }] } }
        }
      }
    },
    requirements: {
      entries: [
        { field: "identity.business_details.address.line1", minimum_deadline: { status: "currently_due" } },
        { field: "identity.owners", minimum_deadline: { status: "past_due" } }
      ]
    },
    future_requirements: {
      entries: [
        { field: "identity.representatives", minimum_deadline: { status: "pending_verification" } }
      ]
    }
  });
  assert.deepEqual(actionRequired.requirementsCurrentlyDue, ["identity.business_details.address.line1"]);
  assert.deepEqual(actionRequired.requirementsPastDue, ["identity.owners"]);
  assert.equal(actionRequired.requirementsPending, true);
  assert.equal(actionRequired.readinessStatus, "ACTION_REQUIRED");
  pass("Accounts v2 requirements and capability status details map to actionable readiness");

  const v1Snapshot = normalizeStripeConnectAccountReadiness({
    id: "acct_snapshot",
    object: "account",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { card_payments: "active", transfers: "active" },
    requirements: { currently_due: [], past_due: [] }
  });
  assert.equal(v1Snapshot.readinessStatus, "ENABLED");
  assert.equal(v1Snapshot.chargesEnabled, true);
  assert.equal(v1Snapshot.payoutsEnabled, true);
  pass("Existing v1 account.updated snapshot readiness remains compatible");

  withEnv({ APP_ENV: "staging", NODE_ENV: "test", STRIPE_CONNECT_SECRET_KEY: "sk_live_forbidden" }, () => {
    assert.throws(() => assertStripeConnectModeAllowed(), /live credentials are not allowed/i);
  });
  withEnv({ APP_ENV: "staging", NODE_ENV: "test", STRIPE_CONNECT_SECRET_KEY: "sk_test_allowed" }, () => {
    assert.doesNotThrow(() => assertStripeConnectModeAllowed());
  });
  withEnv({ APP_ENV: "staging", NODE_ENV: "test", STRIPE_CONNECT_SECRET_KEY: "sk_unknown_format" }, () => {
    assert.throws(() => assertStripeConnectModeAllowed(), /mode could not be verified/i);
  });
  assert.equal(stripeKeyMode(""), "MISSING");
  assert.equal(stripeKeyMode("sk_test_value"), "TEST");
  assert.equal(stripeKeyMode("sk_live_value"), "LIVE");
  pass("Stripe Connect test/live mode guard blocks unsafe local or staging live-key use");

  await runStripeRequestMocks();

  const rawWebhookBody = JSON.stringify({ id: "evt_test", type: "account.updated", data: { object: { id: "acct_test" } } });
  const webhookSecret = "whsec_test_secret";
  verifyStripeWebhook({
    rawBody: rawWebhookBody,
    signatureHeader: signStripePayload(rawWebhookBody, webhookSecret),
    webhookSecret
  });
  assert.throws(() => verifyStripeWebhook({ rawBody: rawWebhookBody, signatureHeader: "", webhookSecret }), /Missing Stripe signature/);
  assert.throws(() => verifyStripeWebhook({ rawBody: rawWebhookBody, signatureHeader: "t=123,v1=bad", webhookSecret }), /Invalid Stripe signature/);
  pass("Stripe webhook verification accepts signed payloads and rejects missing or invalid signatures");

  check(includesAll(orderService, [
    'path: "/core/accounts"',
    'path: "/core/account_links"',
    "STRIPE_CONNECT_RESTAURANT_CONTACT_EMAIL_REQUIRED",
    "stripeConnectAccountIdempotencyKey(restaurant.id)",
    "stripeAccountForLifecycleEvent",
    "stripeV2AccountPathFromRelatedObject",
    "stripeContext: payload.context",
    "restaurantId_provider",
    "stripeAccountId: readiness.providerAccountId",
    "normalizeStripeConnectAccountReadiness(accountObject || object)"
  ]), "Onboarding persists a single restaurant-owned Accounts v2 connected account");
  check(!orderService.includes('path: "/accounts"') && !orderService.includes('path: "/account_links"'), "Old Accounts v1 create/account-link endpoints are removed from onboarding");
  check(includesAll(orderService, [
    'path: "/payment_intents"',
    "stripeAccount: merchant.stripeAccountId",
    "application_fee_amount"
  ]) && !orderService.includes("transfer_data[destination]"), "PaymentIntent direct-charge flow remains on existing connected-account routing");
  check(orderService.includes('path: "/refunds"'), "Refund flow remains on the existing Stripe refund endpoint");
  check(includesAll(orderService, [
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "charge.refunded",
    "v2.core.account"
  ]), "Webhook handler preserves existing payment lifecycle events and parses Accounts v2 lifecycle events");
  check(includesAll(apiEnv, ["STRIPE_CONNECT_WEBHOOK_SECRET", "STRIPE_CONNECT_ACCOUNTS_V2_WEBHOOK_SECRET", "STRIPE_ACCOUNTS_V2_API_VERSION"]), "Stripe Connect env example documents split v1/v2 webhook secrets and Accounts v2 API version");
  check(includesAll(server, ["stripeConnectAccountsV2WebhookRouter", "/api/webhooks/stripe-connect-accounts-v2", "/api/webhooks/stripe-connect"]), "API mounts separate Stripe Connect payment and Accounts v2 webhook endpoints");
  check(includesAll(webhooks, ["STRIPE_CONNECT_WEBHOOK_SECRET", "STRIPE_CONNECT_ACCOUNTS_V2_WEBHOOK_SECRET", "verifyStripeWebhook", "stripeConnectAccountsV2WebhookRouter"]), "Connect webhook routes verify Stripe signatures with split secrets");
  check(includesAll(orderRoutes, [
    '"/merchant-account/onboarding-link"',
    "requireAuth",
    "requireRole(\"TENANT_OWNER\", \"RESTAURANT_ADMIN\", \"RESTAURANT_OWNER\", \"RESTAURANT_MANAGER\")",
    "featureGuard(FEATURE.ORDER_PAYMENTS)"
  ]), "Merchant onboarding remains authenticated, role-gated, and feature-gated");
  check(!orderRoutes.includes("stripeAccountId") && !orderRoutes.includes("accountId"), "Frontend cannot submit arbitrary connected-account IDs to onboarding routes");
  check(includesAll(schema, [
    "model RestaurantMerchantAccount",
    "@@unique([restaurantId, provider])",
    "@@index([stripeAccountId])"
  ]), "Existing merchant account schema protects restaurant/account binding without a migration");

  if (failures.length) {
    console.error(`stripe-connect-accounts-v2 failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
    process.exit(1);
  }
  console.log("stripe-connect-accounts-v2 passed.");
}

try {
  await main();
} finally {
  globalThis.fetch = savedFetch;
  restoreEnv();
  await disconnectPrisma().catch(() => {});
}

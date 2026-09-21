import crypto from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { recordAudit } from "../../services/auditService.js";
import { redeemCouponOnce } from "../../services/couponRedemption.js";
import { notifyNewOrderAlert, notifyOrderConfirmation } from "../../services/notificationService.js";
import { buildReceiptPayload, customerTrackingUrls, findOrderForTracking, hashToken, issueOrderTrackingToken, limitedTrackingOrder, receiptOrderInclude, trackingExpiresAt } from "../../services/orderWorkflowService.js";
import { emitOrderUpdate } from "../../services/realtimeService.js";
import { assertStripeConnectConfigured, assertStripeConnectModeAllowed, stripeConnectPublishableKey, stripeRequest, stripeV2Request, stripeForm } from "../paymentProviders/stripeRest.js";
import { processStripeWebhookEventOnce } from "../paymentProviders/stripeWebhookEvents.js";
import { isMerchantAccountPaymentReady } from "./merchantReadiness.js";
import { calculateOrderQuote } from "./quoteService.js";
import {
  checkoutAttemptFailedError,
  checkoutIdempotencyKeyHash,
  checkoutInProgressError,
  checkoutKeyReusedError,
  checkoutRequestHash,
  checkoutTrackingToken,
  isStripeIdempotencyInProgress,
  isUniqueConflictOn,
  normalizeCheckoutIdempotencyKey,
  normalizeRefundIdempotencyKey,
  orderPaymentIntentIdempotencyKey,
  orderPaymentIntentReplacementIdempotencyKey,
  orderRefundIdempotencyKey,
  refundIdempotencyKeyHash
} from "./checkoutIdempotency.js";

const STRIPE_CONNECT_ACCOUNT_CONFIGURATION = "merchant";
const STRIPE_CONNECT_ACCOUNT_INCLUDES = [
  "configuration.merchant",
  "requirements",
  "future_requirements",
  "identity",
  "defaults"
];

function orderInclude() {
  return { items: true, customer: true, restaurant: { include: { domains: true } }, statusHistory: true };
}

const orderPaymentReaderRoles = new Set(["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER"]);

function accessError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function canReadOrderPayment(user, order) {
  if (!user || !orderPaymentReaderRoles.has(user.role)) return false;
  if (user.role === "SUPER_ADMIN") return true;
  return user.restaurantId === order.restaurantId;
}

function isStripeAccountLifecycleEvent(eventType = "", object = {}) {
  return eventType === "account.updated"
    || eventType === "v1.account.updated"
    || eventType.startsWith("v2.core.account")
    || object.object === "v2.core.account";
}

function cleanString(value, fallback = "") {
  const next = value === null || value === undefined ? "" : String(value).trim();
  return next || fallback;
}

function cleanEmail(value = "") {
  const email = cleanString(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function stripeCountryForRestaurant() {
  return cleanString(process.env.STRIPE_CONNECT_COUNTRY || "US").toLowerCase();
}

function stripeCurrency() {
  return cleanString(process.env.ORDER_PAYMENT_CURRENCY || "usd").toLowerCase();
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nestedValue]) => nestedValue !== undefined && nestedValue !== null && nestedValue !== "")
      .map(([key, nestedValue]) => [key, compactObject(nestedValue)])
  );
}

function accountDisplayName(restaurant) {
  return cleanString(restaurant?.businessName || restaurant?.name, "Loohar restaurant").slice(0, 120);
}

export function stripeConnectAccountIdempotencyKey(restaurantId = "") {
  return `loohar:stripe-connect:v2-account:${cleanString(restaurantId, "unknown")}`;
}

export function buildStripeConnectAccountV2Body({ restaurant, user } = {}) {
  const displayName = accountDisplayName(restaurant);
  return compactObject({
    contact_email: cleanEmail(restaurant?.email),
    display_name: displayName,
    dashboard: "express",
    identity: {
      country: stripeCountryForRestaurant(),
      entity_type: "company",
      business_details: {
        registered_name: displayName
      }
    },
    configuration: {
      [STRIPE_CONNECT_ACCOUNT_CONFIGURATION]: {
        capabilities: {
          card_payments: {
            requested: true
          }
        }
      }
    },
    defaults: {
      currency: stripeCurrency(),
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application"
      },
      locales: ["en-US"]
    },
    metadata: {
      restaurantId: restaurant?.id,
      createdByUserId: user?.id,
      domain: "MERCHANT_ACCOUNT",
      integration: "loohar_accounts_v2"
    },
    include: STRIPE_CONNECT_ACCOUNT_INCLUDES
  });
}

export function buildStripeConnectAccountLinkV2Body({ accountId, refreshUrl, returnUrl } = {}) {
  return compactObject({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: [STRIPE_CONNECT_ACCOUNT_CONFIGURATION],
        refresh_url: refreshUrl,
        return_url: returnUrl
      }
    }
  });
}

function requirementName(entry = {}) {
  return cleanString(entry.field || entry.id || entry.requirement || entry.type || entry.code, "requirement");
}

function requirementDeadlineStatus(entry = {}) {
  return cleanString(
    entry.minimum_deadline?.status
    || entry.impact?.restricts_capabilities?.deadline?.status
    || entry.deadline?.status
    || entry.status
  );
}

function uniqueRequirementList(values = []) {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))];
}

function requirementList(requirements = {}, key) {
  if (Array.isArray(requirements?.[key])) return uniqueRequirementList(requirements[key]);
  if (!Array.isArray(requirements?.entries)) return [];
  const expectedStatus = key === "currently_due" ? "currently_due" : key === "past_due" ? "past_due" : "pending";
  return uniqueRequirementList(
    requirements.entries
      .filter((entry) => {
        const status = requirementDeadlineStatus(entry);
        if (expectedStatus === "pending") return status === "pending" || status === "pending_verification";
        return status === expectedStatus;
      })
      .map(requirementName)
  );
}

function requirementStatusDetails(capability = {}) {
  return Array.isArray(capability.status_details) ? capability.status_details : [];
}

function hasPendingCapabilityVerification(capability = {}) {
  return requirementStatusDetails(capability).some((detail) => detail.code === "requirements_pending_verification");
}

function payloadObject(payload = {}) {
  const object = payload.data?.object || payload.object;
  return object && typeof object === "object" ? object : {};
}

function stripeV2AccountPathWithIncludes(path = "") {
  if (!path) return "";
  const [pathname, rawQuery = ""] = path.split("?");
  if (!pathname.startsWith("/core/accounts/")) return "";
  const query = new URLSearchParams(rawQuery);
  const included = new Set([...query.getAll("include"), ...query.getAll("include[]")]);
  STRIPE_CONNECT_ACCOUNT_INCLUDES.forEach((include) => {
    if (!included.has(include)) query.append("include", include);
  });
  const queryString = query.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

function stripeV2AccountRetrievePath(accountId = "") {
  const safeAccountId = cleanString(accountId);
  return safeAccountId ? stripeV2AccountPathWithIncludes(`/core/accounts/${encodeURIComponent(safeAccountId)}`) : "";
}

function stripeV2AccountPathFromRelatedObject(relatedObject = {}) {
  if (relatedObject.type !== "v2.core.account") return "";
  const rawUrl = cleanString(relatedObject.url);
  if (!rawUrl) return stripeV2AccountRetrievePath(relatedObject.id);
  try {
    const parsedUrl = /^https?:\/\//i.test(rawUrl) ? new URL(rawUrl) : null;
    const pathWithQuery = parsedUrl ? `${parsedUrl.pathname}${parsedUrl.search}` : rawUrl;
    const path = pathWithQuery.startsWith("/v2/") ? pathWithQuery.slice(3) : pathWithQuery;
    return stripeV2AccountPathWithIncludes(path);
  } catch {
    return stripeV2AccountRetrievePath(relatedObject.id);
  }
}

function accountSnapshotFromV2Event(payload = {}) {
  const candidates = [
    payload.data?.object,
    payload.data?.account,
    payload.changes?.after
  ];
  return candidates.find((candidate) => candidate?.object === "v2.core.account") || null;
}

async function stripeAccountForLifecycleEvent({ payload, eventType, object }) {
  if (object.object === "v2.core.account" || eventType === "account.updated" || eventType === "v1.account.updated") return object;
  const snapshot = accountSnapshotFromV2Event(payload);
  if (snapshot) return snapshot;
  if (!eventType.startsWith("v2.core.account")) return object;
  const relatedObject = payload.related_object || object.related_object || {};
  const path = stripeV2AccountPathFromRelatedObject(relatedObject);
  if (!path) return null;
  assertStripeConnectConfigured();
  assertStripeConnectModeAllowed();
  return stripeV2Request({
    secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
    path,
    method: "GET",
    stripeContext: payload.context || object.context || ""
  });
}

export function normalizeStripeConnectAccountReadiness(account = {}) {
  const merchantConfiguration = account.configuration?.merchant || {};
  const merchantCapabilities = merchantConfiguration.capabilities || {};
  const cardPaymentsStatus = cleanString(merchantCapabilities.card_payments?.status || account.capabilities?.card_payments);
  const payoutsStatus = cleanString(merchantCapabilities.stripe_balance?.payouts?.status || account.capabilities?.transfers);
  const isAccountsV2 = account.object === "v2.core.account" || Boolean(account.configuration);
  const requirements = account.requirements || {};
  const futureRequirements = account.future_requirements || {};
  const currentlyDue = uniqueRequirementList([
    ...requirementList(requirements, "currently_due"),
    ...requirementList(futureRequirements, "currently_due")
  ]);
  const pastDue = uniqueRequirementList([
    ...requirementList(requirements, "past_due"),
    ...requirementList(futureRequirements, "past_due")
  ]);
  const pending = uniqueRequirementList([
    ...requirementList(requirements, "pending_verification"),
    ...requirementList(futureRequirements, "pending_verification")
  ]);
  const disabledReason = cleanString(requirements.disabled_reason || futureRequirements.disabled_reason);
  const chargesEnabled = isAccountsV2 ? cardPaymentsStatus === "active" : Boolean(account.charges_enabled);
  const payoutsEnabled = isAccountsV2 ? payoutsStatus === "active" : Boolean(account.payouts_enabled);
  const pendingVerification = pending.length > 0 || hasPendingCapabilityVerification(merchantCapabilities.card_payments) || hasPendingCapabilityVerification(merchantCapabilities.stripe_balance?.payouts);
  const detailsSubmitted = isAccountsV2
    ? Boolean(account.id && currentlyDue.length === 0 && pastDue.length === 0 && !disabledReason)
    : Boolean(account.details_submitted);
  const onboardingComplete = detailsSubmitted && chargesEnabled && pastDue.length === 0 && currentlyDue.length === 0 && !disabledReason;
  const actionRequired = Boolean(account.id && (currentlyDue.length > 0 || pastDue.length > 0 || disabledReason));
  let readinessStatus = "NOT_STARTED";
  if (chargesEnabled && payoutsEnabled && onboardingComplete) readinessStatus = "ENABLED";
  else if (actionRequired) readinessStatus = "ACTION_REQUIRED";
  else if (detailsSubmitted || pendingVerification) readinessStatus = "PENDING_VERIFICATION";
  else if (account.id) readinessStatus = "ACTION_REQUIRED";

  return {
    provider: "STRIPE",
    providerAccountId: account.id || null,
    accountPresent: Boolean(account.id),
    onboardingComplete,
    detailsSubmitted,
    chargesEnabled,
    payoutsEnabled,
    requirementsPending: pendingVerification,
    requirementsCurrentlyDue: currentlyDue,
    requirementsPastDue: pastDue,
    disabledReason: disabledReason || null,
    readinessStatus,
    capabilityStatus: {
      cardPayments: cardPaymentsStatus || null,
      stripeBalancePayouts: payoutsStatus || null
    }
  };
}

function merchantUpdateFromReadiness(readiness) {
  return {
    status: readiness.readinessStatus,
    stripeAccountId: readiness.providerAccountId,
    stripeChargesEnabled: readiness.chargesEnabled,
    stripePayoutsEnabled: readiness.payoutsEnabled,
    stripeDetailsSubmitted: readiness.detailsSubmitted,
    disabledReason: readiness.disabledReason,
    enabledAt: readiness.readinessStatus === "ENABLED" ? new Date() : undefined,
    requirementsJson: {
      source: "stripe_accounts_v2",
      currently_due: readiness.requirementsCurrentlyDue,
      past_due: readiness.requirementsPastDue,
      pending_verification: readiness.requirementsPending,
      capability_status: readiness.capabilityStatus,
      disabled_reason: readiness.disabledReason
    }
  };
}

function stripeDate(value) {
  if (!value) return null;
  if (Number.isFinite(Number(value))) return new Date(Number(value) * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function createStripeConnectedAccountV2({ restaurant, user }) {
  return stripeV2Request({
    secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
    path: "/core/accounts",
    body: buildStripeConnectAccountV2Body({ restaurant, user }),
    idempotencyKey: stripeConnectAccountIdempotencyKey(restaurant.id)
  });
}

async function createStripeConnectedAccountLinkV2({ stripeAccountId, refreshUrl, returnUrl }) {
  return stripeV2Request({
    secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
    path: "/core/account_links",
    body: buildStripeConnectAccountLinkV2Body({ accountId: stripeAccountId, refreshUrl, returnUrl })
  });
}

export function publicOrderPaymentStatus(payment) {
  if (!payment) return null;
  const refundedCents = Array.isArray(payment.refunds)
    ? payment.refunds
      .filter((refund) => refund.status === "SUCCEEDED")
      .reduce((sum, refund) => sum + (refund.amountCents || 0), 0)
    : 0;
  return {
    provider: payment.provider || null,
    status: payment.status || null,
    currency: payment.currency || "usd",
    subtotalCents: payment.subtotalCents ?? null,
    discountCents: payment.discountCents ?? 0,
    taxableAmountCents: payment.taxableAmountCents ?? null,
    taxCents: payment.taxCents ?? 0,
    deliveryFeeCents: payment.deliveryFeeCents ?? 0,
    serviceFeeCents: payment.serviceFeeCents ?? 0,
    restaurantTipCents: payment.restaurantTipCents ?? 0,
    driverTipCents: payment.driverTipCents ?? 0,
    totalCents: payment.totalCents ?? payment.amountCents ?? null,
    refundedCents,
    authorizedAt: payment.authorizedAt || null,
    paidAt: payment.paidAt || null,
    refundedAt: payment.refundedAt || null
  };
}

export async function getMerchantAccount({ user }) {
  if (!user?.restaurantId) {
    const error = new Error("Restaurant context is required");
    error.status = 403;
    throw error;
  }
  const merchantAccount = await prisma.restaurantMerchantAccount.upsert({
    where: { restaurantId_provider: { restaurantId: user.restaurantId, provider: "STRIPE_CONNECT" } },
    create: { restaurantId: user.restaurantId, provider: "STRIPE_CONNECT", status: "NOT_STARTED" },
    update: {}
  });
  return { merchantAccount };
}

export async function createMerchantOnboardingLink({ user }) {
  if (!user?.restaurantId) {
    const error = new Error("Restaurant context is required");
    error.status = 403;
    throw error;
  }
  assertStripeConnectConfigured();
  assertStripeConnectModeAllowed();
  const restaurant = await prisma.restaurant.findUnique({ where: { id: user.restaurantId } });
  if (!restaurant) {
    const error = new Error("Restaurant not found");
    error.status = 404;
    throw error;
  }
  let merchantAccount = await prisma.restaurantMerchantAccount.upsert({
    where: { restaurantId_provider: { restaurantId: user.restaurantId, provider: "STRIPE_CONNECT" } },
    create: { restaurantId: user.restaurantId, provider: "STRIPE_CONNECT", status: "NOT_STARTED" },
    update: {}
  });
  let stripeAccountId = merchantAccount.stripeAccountId;
  if (!stripeAccountId) {
    if (!cleanEmail(restaurant.email)) {
      const error = new Error("Restaurant contact email is required before starting Stripe Connect onboarding.");
      error.status = 400;
      error.code = "STRIPE_CONNECT_RESTAURANT_CONTACT_EMAIL_REQUIRED";
      throw error;
    }
    const account = await createStripeConnectedAccountV2({ restaurant, user });
    const readiness = normalizeStripeConnectAccountReadiness(account);
    stripeAccountId = account.id;
    merchantAccount = await prisma.restaurantMerchantAccount.update({
      where: { id: merchantAccount.id },
      data: merchantUpdateFromReadiness(readiness)
    });
  }
  const refreshUrl = process.env.STRIPE_CONNECT_REFRESH_URL || `${process.env.APP_URL || "https://loohar.com"}/restaurant/${restaurant?.slug || ""}/settings/payments?connect=refresh`;
  const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL || `${process.env.APP_URL || "https://loohar.com"}/restaurant/${restaurant?.slug || ""}/settings/payments?connect=return`;
  const link = await createStripeConnectedAccountLinkV2({ stripeAccountId, refreshUrl, returnUrl });
  merchantAccount = await prisma.restaurantMerchantAccount.update({
    where: { id: merchantAccount.id },
    data: {
      status: merchantAccount.status === "ENABLED" ? "ENABLED" : "ACTION_REQUIRED",
      stripeAccountId,
      onboardingUrlExpiresAt: stripeDate(link.expires_at)
    }
  });
  await recordAudit({ actorUserId: user.id, restaurantId: user.restaurantId, action: "merchant_account.onboarding_link.created", entityType: "RestaurantMerchantAccount", entityId: merchantAccount.id });
  return { onboardingUrl: link.url, merchantAccount };
}

async function createStripePaymentIntent({ quote, order, payment, merchant, idempotencyKey }) {
  assertStripeConnectConfigured();
  const feeParams = quote.platformFeeCents > 0 ? { application_fee_amount: quote.platformFeeCents } : {};
  const body = stripeForm({
    amount: quote.totalCents,
    currency: quote.currency,
    "automatic_payment_methods[enabled]": "true",
    ...feeParams,
    "metadata[domain]": "RESTAURANT_ORDER_PAYMENT",
    "metadata[restaurantId]": order.restaurantId,
    "metadata[orderId]": order.id,
    "metadata[orderPaymentId]": payment.id,
    "metadata[orderNumber]": order.orderNumber,
    "metadata[connectedAccountId]": merchant.stripeAccountId
  });
  return stripeRequest({
    secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
    path: "/payment_intents",
    body,
    stripeAccount: merchant.stripeAccountId,
    idempotencyKey: idempotencyKey || orderPaymentIntentIdempotencyKey(payment.id)
  });
}

// A replay hands the customer the stored client secret. Stripe may have cancelled that PaymentIntent
// since (cancelling an order cancels it, and Stripe cancels some intents that are never confirmed),
// or the payment row's amount may no longer match it. Confirming a dead intent is impossible and the
// customer only sees an opaque Stripe error, so check the intent before handing it back.
//
// Money is never re-created here: a replacement is made only for an intent that has no money
// attached, and only while the payment row is still awaiting payment.
const REPLACEABLE_PAYMENT_STATUSES = new Set(["REQUIRES_PAYMENT_METHOD", "REQUIRES_CONFIRMATION", "FAILED"]);
const INTENT_STATUSES_WITH_MONEY = new Set(["processing", "succeeded", "requires_capture"]);

async function refreshReplayPaymentIntent({ order, payment }) {
  if (!payment.providerPaymentIntentId || !REPLACEABLE_PAYMENT_STATUSES.has(payment.status)) return { payment };
  const merchant = await prisma.restaurantMerchantAccount.findUnique({
    where: { restaurantId_provider: { restaurantId: payment.restaurantId, provider: "STRIPE_CONNECT" } }
  });
  if (!merchant?.stripeAccountId) return { payment };

  let intent;
  try {
    intent = await stripeRequest({
      secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
      path: `/payment_intents/${payment.providerPaymentIntentId}`,
      method: "GET",
      stripeAccount: merchant.stripeAccountId
    });
  } catch {
    // Stripe unreachable: fall back to the stored secret rather than failing the replay.
    return { payment };
  }

  // The customer already paid, or payment is in flight. Never offer a secret to confirm again; the
  // webhook settles the order.
  if (INTENT_STATUSES_WITH_MONEY.has(intent.status)) return { payment, suppressClientSecret: true };

  const amountMatches = Number(intent.amount) === Number(payment.totalCents);
  if (intent.status !== "canceled" && amountMatches) return { payment };

  // A live intent for the wrong amount must be closed before its replacement is created, so a
  // customer holding the old secret cannot pay the wrong total.
  if (intent.status !== "canceled") {
    try {
      await stripeRequest({
        secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
        path: `/payment_intents/${intent.id}/cancel`,
        body: stripeForm({}),
        stripeAccount: merchant.stripeAccountId
      });
    } catch {
      return { payment };
    }
  }

  const replacement = await createStripePaymentIntent({
    quote: paymentIntentAmounts(payment),
    order,
    payment,
    merchant,
    idempotencyKey: orderPaymentIntentReplacementIdempotencyKey(payment.id, intent.id)
  });
  const updated = await prisma.restaurantOrderPayment.update({
    where: { id: payment.id },
    data: {
      status: replacement.status === "requires_confirmation" ? "REQUIRES_CONFIRMATION" : "REQUIRES_PAYMENT_METHOD",
      providerPaymentIntentId: replacement.id,
      providerClientSecret: replacement.client_secret || null
    }
  });
  await recordAudit({
    actorUserId: null,
    restaurantId: payment.restaurantId,
    action: "order_payment.intent.replaced",
    entityType: "RestaurantOrderPayment",
    entityId: payment.id,
    metadata: { replacedIntentId: intent.id, replacedIntentStatus: intent.status, replacementIntentId: replacement.id, totalCents: payment.totalCents }
  });
  return { payment: updated };
}

// PaymentIntent amounts always come from the persisted server-side payment row so the
// original request and any replay send identical parameters under one Stripe idempotency key.
function paymentIntentAmounts(payment) {
  return { totalCents: payment.totalCents, currency: payment.currency, platformFeeCents: payment.platformFeeCents };
}

function merchantNotReadyError(merchant) {
  const error = new Error("Restaurant order payments are not enabled for this restaurant yet. Complete Stripe Connect onboarding before accepting online payments.");
  error.status = 503;
  error.details = { merchantStatus: merchant?.status || "NOT_STARTED" };
  return error;
}

async function readyMerchantFor(restaurantId) {
  const merchant = await prisma.restaurantMerchantAccount.findUnique({
    where: { restaurantId_provider: { restaurantId, provider: "STRIPE_CONNECT" } }
  });
  if (!isMerchantAccountPaymentReady(merchant)) throw merchantNotReadyError(merchant);
  return merchant;
}

function onlineOrderNumber(attempt) {
  if (attempt === 0) return `${Date.now().toString().slice(-6)}`;
  return `${crypto.randomInt(0, 1_000_000)}`.padStart(6, "0");
}

async function attachPaymentIntent({ order, payment, merchant }) {
  const intent = await createStripePaymentIntent({ quote: paymentIntentAmounts(payment), order, payment, merchant });
  return prisma.restaurantOrderPayment.update({
    where: { id: payment.id },
    data: {
      status: intent.status === "requires_confirmation" ? "REQUIRES_CONFIRMATION" : "REQUIRES_PAYMENT_METHOD",
      providerPaymentIntentId: intent.id,
      providerClientSecret: intent.client_secret || null
    }
  });
}

// Anonymous checkout callers get the same limited order and payment views as order tracking, not the
// raw rows (which carry tenant settings, idempotency hashes and quote internals).
function checkoutResponse({ order, payment, trackingToken, idempotentReplay, stripeAccountId, suppressClientSecret = false }) {
  const limitedOrder = limitedTrackingOrder(order);
  return {
    order: { ...limitedOrder, totalCents: limitedOrder.totals?.totalCents ?? null },
    payment: { id: payment.id, providerPaymentIntentId: payment.providerPaymentIntentId || null, ...publicOrderPaymentStatus(payment) },
    publishableKey: stripeConnectPublishableKey(),
    // Direct charges live on the restaurant's connected account; Stripe.js must be initialised with it
    // to confirm the PaymentIntent. The account id is an identifier, not a credential.
    stripeAccountId: stripeAccountId || null,
    clientSecret: suppressClientSecret ? null : (payment.providerClientSecret || null),
    tracking: trackingToken ? { token: trackingToken, ...customerTrackingUrls(order, trackingToken) } : null,
    checkout: { idempotentReplay }
  };
}

async function replayCheckout({ existing, keyHash, requestHash }) {
  if (existing.checkoutRequestHash !== requestHash) throw checkoutKeyReusedError();
  const order = await prisma.order.findUnique({ where: { id: existing.orderId }, include: orderInclude() });
  // A declined card leaves the PaymentIntent reusable; only an attempt that never got one is terminal.
  const initializationFailed = existing.status === "FAILED" && !existing.providerPaymentIntentId;
  const settledElsewhere = existing.provider !== "STRIPE_CONNECT" || existing.status === "CANCELED";
  if (!order || initializationFailed || settledElsewhere || ["CANCELLED", "REJECTED"].includes(order.status)) throw checkoutAttemptFailedError();

  // The derived token no longer matches if staff reissued tracking (receipt QR) or the secret
  // changed. Never rotate here: that would silently break the token already in use.
  const derivedToken = checkoutTrackingToken({ keyHash });
  const trackingToken = order.trackingTokenHash === hashToken(derivedToken) ? derivedToken : null;

  let payment = existing;
  if (!payment.providerPaymentIntentId) {
    const merchant = await readyMerchantFor(payment.restaurantId);
    try {
      payment = await attachPaymentIntent({ order, payment, merchant });
    } catch (error) {
      if (isStripeIdempotencyInProgress(error)) throw checkoutInProgressError();
      throw error;
    }
  }
  const refreshed = await refreshReplayPaymentIntent({ order, payment });
  payment = refreshed.payment;
  const replayMerchant = await prisma.restaurantMerchantAccount.findUnique({
    where: { restaurantId_provider: { restaurantId: payment.restaurantId, provider: "STRIPE_CONNECT" } },
    select: { stripeAccountId: true, status: true }
  });
  // Without the connected account the client cannot confirm the PaymentIntent; fail visibly instead.
  if (payment.providerClientSecret && !replayMerchant?.stripeAccountId) throw merchantNotReadyError(replayMerchant);
  return checkoutResponse({ order, payment, trackingToken, idempotentReplay: true, stripeAccountId: replayMerchant?.stripeAccountId, suppressClientSecret: refreshed.suppressClientSecret });
}

export async function createOrderPayment({ body, idempotencyKey }) {
  const normalizedKey = normalizeCheckoutIdempotencyKey(idempotencyKey);
  const keyHash = checkoutIdempotencyKeyHash({ restaurantId: body.restaurantId, idempotencyKey: normalizedKey });
  const requestHash = checkoutRequestHash(body);
  const findExisting = () => prisma.restaurantOrderPayment.findUnique({ where: { checkoutIdempotencyKeyHash: keyHash } });

  const existing = await findExisting();
  if (existing) return replayCheckout({ existing, keyHash, requestHash });

  const quote = await calculateOrderQuote({ restaurantId: body.restaurantId, body });
  const merchant = await readyMerchantFor(quote.restaurant.id);

  // Checkout attaches the order to the restaurant's customer record for that email, which is how a
  // returning guest keeps one history and their loyalty. Anyone can type someone else's address,
  // though, so when that record belongs to a registered account an anonymous order is joining a real
  // person's profile. Nothing of theirs is read back or overwritten — connectOrCreate only writes
  // when creating, and the tracking payload carries the restaurant's details, not the customer's —
  // but the restaurant should be able to see that it happened rather than find a stranger's order in
  // someone's history with no explanation.
  const existingCustomer = body.customer?.email
    ? await prisma.customer.findUnique({
      where: { restaurantId_email: { restaurantId: quote.restaurant.id, email: body.customer.email } },
      select: { id: true, userId: true }
    })
    : null;

  const initialTrackingToken = checkoutTrackingToken({ keyHash });
  const createOrderAndPayment = (orderNumber) => {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          restaurant: { connect: { id: quote.restaurant.id } },
          ...(quote.locationId ? { location: { connect: { id: quote.locationId } } } : {}),
          orderNumber,
          type: body.type,
          deliveryAddress: body.deliveryAddress,
          notes: body.notes,
          subtotalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          couponCode: quote.couponCode,
          deliveryFeeCents: quote.deliveryFeeCents,
          taxCents: quote.taxCents,
          tipCents: quote.tipCents,
          restaurantTipCents: quote.restaurantTipCents,
          driverTipCents: quote.driverTipCents,
          customTipCents: quote.customTipCents,
          tipPercentage: quote.tipPercentage,
          tipType: quote.tipType,
          totalCents: quote.totalCents,
          trackingTokenHash: hashToken(initialTrackingToken),
          trackingTokenExpiresAt: trackingExpiresAt(),
          customer: {
            connectOrCreate: {
              where: { restaurantId_email: { restaurantId: quote.restaurant.id, email: body.customer.email } },
              create: { ...body.customer, restaurantId: quote.restaurant.id, defaultAddress: body.deliveryAddress }
            }
          },
          items: {
            create: quote.items.map((item) => ({
              menuItemId: item.menuItemId,
              name: item.name,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              optionsJson: {
                options: item.options || [],
                modifiers: item.modifiers || item.options || [],
                modifierSelections: item.modifierSelections || [],
                modifierOptionIds: item.modifierOptionIds || item.optionIds || []
              }
            }))
          },
          statusHistory: { create: { status: "PENDING", note: "Order placed by customer; awaiting payment" } }
        },
        include: orderInclude()
      });
      const payment = await tx.restaurantOrderPayment.create({
        data: {
          restaurantId: order.restaurantId,
          orderId: order.id,
          provider: "STRIPE_CONNECT",
          status: "REQUIRES_PAYMENT_METHOD",
          checkoutIdempotencyKeyHash: keyHash,
          checkoutRequestHash: requestHash,
          currency: quote.currency,
          subtotalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          taxableAmountCents: quote.taxableAmountCents,
          taxCents: quote.taxCents,
          deliveryFeeCents: quote.deliveryFeeCents,
          serviceFeeCents: quote.serviceFeeCents,
          restaurantTipCents: quote.restaurantTipCents,
          driverTipCents: quote.driverTipCents,
          totalCents: quote.totalCents,
          platformFeeCents: quote.platformFeeCents,
          restaurantGrossCents: quote.restaurantGrossCents,
          restaurantNetCents: quote.restaurantNetCents,
          quoteJson: {
            items: quote.items,
            breakdown: quote.breakdown,
            couponCode: quote.couponCode,
            taxRateBps: quote.taxRateBps,
            taxInclusive: quote.taxInclusive,
            locationId: quote.locationId,
            taxProfileId: quote.taxProfileId,
            taxConfigurationVersion: quote.taxConfigurationVersion,
            zeroLooharPlatformFee: quote.zeroLooharPlatformFee,
            looharPlatformFeeCents: quote.looharPlatformFeeCents,
            processorFeesMayApply: quote.processorFeesMayApply,
            paymentFeeDisclosure: quote.paymentFeeDisclosure
          }
        }
      });
      await tx.orderTaxSnapshot.create({
        data: {
          orderId: order.id,
          restaurantId: order.restaurantId,
          locationId: quote.locationId,
          taxProfileId: quote.taxProfileId,
          configurationVersion: quote.taxConfigurationVersion,
          provider: quote.taxConfiguration.provider,
          source: quote.taxConfiguration.source,
          taxableAmountCents: quote.taxableAmountCents,
          taxRateBps: quote.taxRateBps,
          taxCents: quote.taxCents,
          jurisdictionJson: {
            jurisdictionCode: quote.taxConfiguration.jurisdictionCode,
            jurisdictionMetadata: quote.taxConfiguration.jurisdictionMetadata,
            specialDistricts: quote.taxConfiguration.specialDistricts || [],
            taxComponents: quote.taxConfiguration.taxComponents || [],
            exemption: quote.taxConfiguration.exemption || null,
            taxProfileVersion: quote.taxConfigurationVersion,
            taxProfileEffectiveAt: quote.taxConfiguration.effectiveAt,
            taxProfileVerifiedAt: quote.taxConfiguration.verifiedAt,
            taxInclusive: quote.taxInclusive
          }
        }
      });
      return { order, payment };
    });
  };

  let created = null;
  for (let attempt = 0; !created; attempt += 1) {
    try {
      created = await createOrderAndPayment(onlineOrderNumber(attempt));
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      // Unique conflicts surface only after the competing transaction commits. If that was a
      // concurrent request with the same key, its order is the canonical one.
      const winner = await findExisting();
      if (winner) return replayCheckout({ existing: winner, keyHash, requestHash });
      // Order-number collisions and concurrent first-time customer creation are safe to retry.
      const retryable = isUniqueConflictOn(error, "orderNumber") || isUniqueConflictOn(error, "email");
      if (retryable && attempt < 4) continue;
      throw error;
    }
  }

  try {
    const payment = await attachPaymentIntent({ order: created.order, payment: created.payment, merchant });
    if (existingCustomer?.userId) {
      await recordAudit({
        restaurantId: quote.restaurant.id,
        action: "order.anonymous_checkout_joined_customer_account",
        entityType: "Customer",
        entityId: existingCustomer.id,
        metadata: { orderId: created.order.id, requiresReview: true, note: "An anonymous checkout used the email of a registered customer account." }
      }).catch(() => {});
    }
    return checkoutResponse({ order: created.order, payment, trackingToken: initialTrackingToken, idempotentReplay: false, stripeAccountId: merchant.stripeAccountId });
  } catch (error) {
    // A replay of this checkout is already talking to Stripe under the same key; leave state intact.
    if (isStripeIdempotencyInProgress(error)) throw checkoutInProgressError();
    // Cancel only if no concurrent replay attached a PaymentIntent in the meantime.
    await prisma.$transaction(async (tx) => {
      const released = await tx.restaurantOrderPayment.updateMany({
        where: { id: created.payment.id, providerPaymentIntentId: null },
        data: { status: "FAILED", failureReason: error.message || "Payment intent could not be initialized" }
      });
      if (released.count === 0) return;
      await tx.order.update({
        where: { id: created.order.id },
        data: { status: "CANCELLED", statusHistory: { create: { status: "CANCELLED", note: "Payment intent could not be initialized" } } }
      });
    });
    throw error;
  }
}

async function issueLoyaltyPoints(order, client = prisma) {
  const existing = await client.loyaltyPoint.findFirst({ where: { orderId: order.id, reason: "Order reward" } });
  if (existing) return existing;
  const settings = order.restaurant.loyaltySettingsJson || { pointsPerDollar: 1 };
  const points = Math.floor((order.subtotalCents / 100) * Number(settings.pointsPerDollar || 1));
  if (points <= 0) return null;
  return client.loyaltyPoint.create({
    data: {
      restaurantId: order.restaurantId,
      customerId: order.customerId,
      orderId: order.id,
      points,
      reason: "Order reward"
    }
  });
}

// Late or repeated payment events must not re-run paid side effects or downgrade a settled payment.
const ORDER_PAYMENT_SETTLED_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);

export async function markOrderPaymentPaid({ payment, providerChargeId }) {
  // Claiming settlement with a conditional update inside one transaction means concurrent
  // deliveries apply side effects once, and a failure never leaves PAID on an unaccepted order.
  const settled = await prisma.$transaction(async (tx) => {
    const claimed = await tx.restaurantOrderPayment.updateMany({
      where: { id: payment.id, status: { notIn: [...ORDER_PAYMENT_SETTLED_STATUSES] } },
      data: {
        status: "PAID",
        providerChargeId: providerChargeId || payment.providerChargeId,
        paidAt: new Date(),
        failureReason: null
      }
    });
    if (claimed.count === 0) return null;
    // Only a waiting order is accepted by payment; a payment that lands on a cancelled or already
    // progressed order is recorded and flagged instead of reviving or rewinding the order.
    const accepted = await tx.order.updateMany({ where: { id: payment.orderId, status: "PENDING" }, data: { status: "ACCEPTED" } });
    if (accepted.count === 0) {
      const current = await tx.order.findUnique({ where: { id: payment.orderId }, select: { status: true } });
      return { unexpectedOrderStatus: current?.status || "MISSING" };
    }
    await tx.orderStatusHistory.create({ data: { orderId: payment.orderId, status: "ACCEPTED", note: "Restaurant order payment succeeded" } });
    const order = await tx.order.findUnique({
      where: { id: payment.orderId },
      include: { restaurant: true, customer: true, items: true, statusHistory: true }
    });
    await issueLoyaltyPoints(order, tx);
    let couponRedemption = null;
    if (order.couponCode) {
      couponRedemption = await redeemCouponOnce(tx, { restaurantId: order.restaurantId, code: order.couponCode });
    }
    const updatedPayment = await tx.restaurantOrderPayment.findUnique({
      where: { id: payment.id },
      include: { order: { include: { restaurant: true, customer: true, items: true, statusHistory: true } } }
    });
    return { payment: updatedPayment, order, couponRedemption };
  });
  if (!settled) return { ignored: true, reason: "payment_already_settled" };
  // The customer already paid with the discount applied, so the payment stands. An exhausted coupon
  // is a business problem to review, not a reason to lose the money (L-28).
  if (settled.couponRedemption && !settled.couponRedemption.redeemed) {
    await recordAudit({
      restaurantId: payment.restaurantId,
      action: "coupon.redeemed_beyond_limit",
      entityType: "Order",
      entityId: payment.orderId,
      metadata: { reason: settled.couponRedemption.reason, usageLimit: settled.couponRedemption.usageLimit ?? null, redeemedCount: settled.couponRedemption.redeemedCount ?? null, requiresReview: true }
    });
  }
  if (settled.unexpectedOrderStatus) {
    await recordAudit({ restaurantId: payment.restaurantId, action: "order_payment.paid_on_closed_order", entityType: "RestaurantOrderPayment", entityId: payment.id, metadata: { orderStatus: settled.unexpectedOrderStatus, requiresReview: true } });
    return { reviewRequired: true, reason: "order_not_awaiting_payment", orderStatus: settled.unexpectedOrderStatus };
  }
  const { payment: updatedPayment, order } = settled;
  await Promise.allSettled([
    customerReceiptEmailFor(order).then((email) => notifyOrderConfirmation(email)),
    notifyNewOrderAlert({ order })
  ]);
  emitOrderUpdate(order);
  await recordAudit({ restaurantId: order.restaurantId, action: "order_payment.paid", entityType: "RestaurantOrderPayment", entityId: updatedPayment.id, metadata: { providerPaymentIntentId: updatedPayment.providerPaymentIntentId } });
  return settled;
}

// Builds the emailed receipt from the stored order, reusing the printed-receipt payload so the email
// and the paper agree. A failure here must never block settlement, so callers wrap it in allSettled.
async function customerReceiptEmailFor(order) {
  try {
    const full = await prisma.order.findUnique({ where: { id: order.id }, include: receiptOrderInclude() });
    if (!full) return { order };
    // The customer is already holding a tracking token from checkout; rotating it here would break
    // their tracking page and any 3DS return URL. Re-derive that token instead, and only mint a new
    // one when the order has no usable token at all.
    const keyHash = full.restaurantOrderPayment?.checkoutIdempotencyKeyHash || null;
    const derived = keyHash ? checkoutTrackingToken({ keyHash }) : null;
    const tokenStillValid = Boolean(full.trackingTokenHash) && (!full.trackingTokenExpiresAt || full.trackingTokenExpiresAt > new Date());
    let receiptOrder = full;
    let trackingToken = derived && full.trackingTokenHash === hashToken(derived) ? derived : null;
    if (!trackingToken && !tokenStillValid) {
      const issued = await issueOrderTrackingToken(order.id);
      receiptOrder = issued.order || full;
      trackingToken = issued.trackingToken;
    }
    const receipt = buildReceiptPayload(receiptOrder, { kind: "customer", trackingToken: trackingToken || undefined });
    const trackingUrl = trackingToken ? customerTrackingUrls(receiptOrder, trackingToken).webUrl : "";
    return { order: receiptOrder, receipt, trackingUrl };
  } catch {
    return { order };
  }
}

export async function markOrderPaymentFailed({ payment, failureReason }) {
  const claimed = await prisma.restaurantOrderPayment.updateMany({
    where: { id: payment.id, status: { notIn: [...ORDER_PAYMENT_SETTLED_STATUSES] } },
    data: { status: "FAILED", failureReason: failureReason || "Payment failed" }
  });
  const updatedPayment = await prisma.restaurantOrderPayment.findUnique({ where: { id: payment.id }, include: { order: true } });
  if (claimed.count === 0) return updatedPayment;
  await recordAudit({ restaurantId: updatedPayment.order.restaurantId, action: "order_payment.failed", entityType: "RestaurantOrderPayment", entityId: updatedPayment.id, metadata: { failureReason: updatedPayment.failureReason } });
  return updatedPayment;
}

const REFUNDABLE_PAYMENT_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED"]);

function refundError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function submitRefundToStripe({ refund, payment, merchant, reason }) {
  const stripeRefundReasons = new Set(["duplicate", "fraudulent", "requested_by_customer"]);
  const providerReason = stripeRefundReasons.has(reason) ? reason : "requested_by_customer";
  const body = stripeForm({
    payment_intent: payment.providerPaymentIntentId,
    amount: refund.amountCents,
    reason: providerReason,
    "metadata[domain]": "RESTAURANT_ORDER_PAYMENT",
    "metadata[orderPaymentId]": payment.id,
    "metadata[orderId]": payment.orderId,
    "metadata[restaurantRefundId]": refund.id,
    "metadata[refundNote]": reason || providerReason
  });
  let providerRefund;
  try {
    // Direct charges live on the restaurant's connected account, so the refund must too.
    providerRefund = await stripeRequest({
      secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
      path: "/refunds",
      body,
      stripeAccount: merchant.stripeAccountId,
      idempotencyKey: orderRefundIdempotencyKey(refund.id)
    });
  } catch (error) {
    if (isStripeIdempotencyInProgress(error)) throw refundError("This refund is still being processed. Retry the same request shortly.", 409, "REFUND_IN_PROGRESS");
    // Only a definite rejection releases the reserved balance. Timeouts, connection errors and
    // provider 5xx may have created the refund, so the row stays PENDING and a same-key retry
    // re-sends under the same Stripe idempotency key to learn the real outcome.
    if (!isDefiniteStripeRejection(error)) {
      throw refundError("The refund outcome is not confirmed yet. Retry the same request to confirm it.", 503, "REFUND_OUTCOME_UNKNOWN");
    }
    await prisma.restaurantRefund.updateMany({ where: { id: refund.id, providerRefundId: null }, data: { status: "FAILED" } });
    throw error;
  }
  return prisma.restaurantRefund.update({
    where: { id: refund.id },
    data: {
      providerRefundId: providerRefund.id,
      ...refundStatusFromProvider(providerRefund.status)
    }
  });
}

function isDefiniteStripeRejection(error) {
  const status = Number(error?.status || 0);
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}

// Records a refund the provider already performed and Loohar did not create. Idempotent: a
// redelivery of the same provider refund hits the unique providerRefundId and is acknowledged.
async function mirrorProviderRefund({ payment, object }) {
  const amountCents = Number(object.amount || 0);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ignored: true, reason: "refund_without_amount" };
  const providerRefundId = object.id;
  if (!providerRefundId) return { ignored: true, reason: "refund_without_id" };
  try {
    const mirrored = await prisma.restaurantRefund.create({
      data: {
        restaurantId: payment.restaurantId,
        orderPaymentId: payment.id,
        provider: payment.provider,
        providerRefundId,
        amountCents,
        reason: object.reason ? String(object.reason).slice(0, 200) : "provider_initiated",
        requestedByUserId: null,
        ...refundStatusFromProvider(object.status)
      }
    });
    await recordAudit({
      restaurantId: payment.restaurantId,
      action: "refund.mirrored_from_provider",
      entityType: "RestaurantRefund",
      entityId: mirrored.id,
      metadata: { providerRefundId, amountCents, status: mirrored.status, orderPaymentId: payment.id, requiresReview: true }
    });
    return { refundMirrored: true, refundId: mirrored.id };
  } catch (error) {
    if (isUniqueConflictOn(error, "providerRefundId")) return { ignored: true, reason: "refund_already_mirrored" };
    throw error;
  }
}

function refundStatusFromProvider(providerStatus) {
  if (providerStatus === "succeeded") return { status: "SUCCEEDED", processedAt: new Date() };
  if (providerStatus === "failed") return { status: "FAILED", processedAt: new Date() };
  if (providerStatus === "canceled") return { status: "CANCELED", processedAt: new Date() };
  return { status: "PENDING", processedAt: null };
}

export async function refundOrderPayment({ orderId, amountCents, reason, user, idempotencyKey }) {
  const normalizedKey = normalizeRefundIdempotencyKey(idempotencyKey);
  const payment = await prisma.restaurantOrderPayment.findUnique({ where: { orderId }, include: { order: true, restaurant: true } });
  if (!payment) {
    const error = new Error("Order payment not found");
    error.status = 404;
    throw error;
  }
  if (user?.role !== "SUPER_ADMIN" && user?.restaurantId !== payment.restaurantId) {
    const error = new Error("Tenant access denied");
    error.status = 403;
    throw error;
  }
  const requestedCents = amountCents === undefined || amountCents === null ? null : Math.floor(Number(amountCents));
  if (requestedCents !== null && !(requestedCents > 0)) {
    throw refundError("Refund amount must be greater than zero", 400, "REFUND_AMOUNT_INVALID");
  }
  const keyHash = refundIdempotencyKeyHash({ orderPaymentId: payment.id, idempotencyKey: normalizedKey });
  const merchant = await prisma.restaurantMerchantAccount.findUnique({
    where: { restaurantId_provider: { restaurantId: payment.restaurantId, provider: "STRIPE_CONNECT" } }
  });

  const replay = async (existing) => {
    if (requestedCents !== null && requestedCents !== existing.amountCents) {
      throw refundError("This Idempotency-Key was already used for a different refund.", 409, "REFUND_IDEMPOTENCY_KEY_REUSED");
    }
    if (existing.status === "FAILED" || existing.providerRefundId) return existing;
    if (!merchant?.stripeAccountId) throw refundError("Restaurant payment account is unavailable for refunds.", 409, "REFUND_MERCHANT_UNAVAILABLE");
    assertStripeConnectConfigured();
    return submitRefundToStripe({ refund: existing, payment, merchant, reason: existing.reason });
  };

  const existing = await prisma.restaurantRefund.findUnique({ where: { idempotencyKey: keyHash } });
  if (existing) return replay(existing);

  if (payment.provider !== "STRIPE_CONNECT" || !REFUNDABLE_PAYMENT_STATUSES.has(payment.status) || !payment.providerPaymentIntentId) {
    throw refundError("Only paid orders can be refunded.", 409, "REFUND_PAYMENT_NOT_REFUNDABLE");
  }
  if (!merchant?.stripeAccountId) throw refundError("Restaurant payment account is unavailable for refunds.", 409, "REFUND_MERCHANT_UNAVAILABLE");
  assertStripeConnectConfigured();

  let reservation;
  try {
    // Lock the payment row so concurrent refunds see each other's reservations and can never
    // exceed the captured amount.
    reservation = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RestaurantOrderPayment" WHERE id = ${payment.id} FOR UPDATE`;
      // A concurrent request with the same key may have reserved while this one waited on the lock.
      const alreadyReserved = await tx.restaurantRefund.findUnique({ where: { idempotencyKey: keyHash } });
      if (alreadyReserved) return { replayOf: alreadyReserved };
      const reserved = await tx.restaurantRefund.aggregate({
        where: { orderPaymentId: payment.id, status: { in: ["PENDING", "SUCCEEDED"] } },
        _sum: { amountCents: true }
      });
      const remainingCents = payment.totalCents - (reserved._sum.amountCents || 0);
      // Over-balance requests are rejected rather than silently reduced, so a retry of the same
      // request always matches the stored refund amount.
      const refundCents = requestedCents ?? remainingCents;
      if (remainingCents <= 0 || refundCents > remainingCents) {
        throw refundError("Refund amount exceeds the refundable balance remaining.", 409, "REFUND_EXCEEDS_REMAINING");
      }
      return tx.restaurantRefund.create({
        data: {
          restaurantId: payment.restaurantId,
          orderPaymentId: payment.id,
          provider: "STRIPE_CONNECT",
          idempotencyKey: keyHash,
          status: "PENDING",
          amountCents: refundCents,
          reason,
          requestedByUserId: user?.id
        }
      });
    });
  } catch (error) {
    if (!isUniqueConflictOn(error, "idempotencyKey")) throw error;
    return replay(await prisma.restaurantRefund.findUnique({ where: { idempotencyKey: keyHash } }));
  }

  if (reservation.replayOf) return replay(reservation.replayOf);
  const restaurantRefund = await submitRefundToStripe({ refund: reservation, payment, merchant, reason });
  await recordAudit({ actorUserId: user?.id, restaurantId: payment.restaurantId, action: "order_payment.refund.requested", entityType: "RestaurantRefund", entityId: restaurantRefund.id, metadata: { amountCents: restaurantRefund.amountCents } });
  return restaurantRefund;
}

export async function statusForOrder({ orderId, user }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { restaurantOrderPayment: { include: { refunds: true } }, customer: true, items: true, statusHistory: true }
  });
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  if (!canReadOrderPayment(user, order)) throw accessError("Order access denied", 403, "ORDER_ACCESS_DENIED");
  return { order, payment: order.restaurantOrderPayment };
}

export async function publicStatusForOrder({ orderId, token }) {
  const order = await findOrderForTracking(orderId, token);
  if (!order) throw accessError("Valid order access token is required", 403, "ORDER_ACCESS_TOKEN_REQUIRED");
  const limitedOrder = limitedTrackingOrder(order);
  return {
    order: { ...limitedOrder, totalCents: limitedOrder.totals?.totalCents ?? null },
    payment: publicOrderPaymentStatus(order.restaurantOrderPayment || order.payment)
  };
}

export async function receiptForOrder({ orderId, user }) {
  const { order, payment } = await statusForOrder({ orderId, user });
  return {
    order,
    payment,
    totals: {
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      deliveryFeeCents: order.deliveryFeeCents,
      taxCents: order.taxCents,
      restaurantTipCents: order.restaurantTipCents,
      driverTipCents: order.driverTipCents,
      totalCents: order.totalCents
    }
  };
}

export async function publicReceiptForOrder({ orderId, token }) {
  const order = await findOrderForTracking(orderId, token);
  if (!order) throw accessError("Valid order access token is required", 403, "ORDER_ACCESS_TOKEN_REQUIRED");
  return { receipt: buildReceiptPayload(order, { kind: "customer", trackingToken: token }) };
}

export async function handleStripeConnectWebhook(payload = {}) {
  const eventType = payload.type || payload.eventType;
  const object = payloadObject(payload);
  const accountLifecycleEvent = isStripeAccountLifecycleEvent(eventType || "", object);
  const accountObject = accountLifecycleEvent ? await stripeAccountForLifecycleEvent({ payload, eventType: eventType || "", object }) : null;
  const eventId = payload.id || payload.providerEventId;
  const providerEventId = eventId || `manual-${eventType || "unknown"}-${object.id || Date.now()}`;
  // Charge and refund objects reference their PaymentIntent; PaymentIntent events are the object itself.
  const paymentIntentId = object.payment_intent || object.id;
  const orderPaymentId = object.metadata?.orderPaymentId;
  const orderId = object.metadata?.orderId;
  let payment = orderPaymentId ? await prisma.restaurantOrderPayment.findUnique({ where: { id: orderPaymentId } }) : null;
  if (!payment && paymentIntentId) payment = await prisma.restaurantOrderPayment.findFirst({ where: { providerPaymentIntentId: paymentIntentId } });
  if (!payment && orderId) payment = await prisma.restaurantOrderPayment.findUnique({ where: { orderId } });

  const eventRecord = {
    restaurantId: payment?.restaurantId || accountObject?.metadata?.restaurantId || object.metadata?.restaurantId || null,
    paymentId: payment?.id || null,
    eventDomain: accountLifecycleEvent ? "MERCHANT_ACCOUNT" : eventType?.startsWith("payout.") ? "PAYOUT" : eventType?.startsWith("charge.dispute") ? "DISPUTE" : "RESTAURANT_ORDER_PAYMENT",
    provider: "stripe_connect",
    providerEventId,
    eventType: eventType || "unknown",
    payloadJson: payload
  };
  return processStripeWebhookEventOnce(eventRecord, () => applyStripeConnectEvent({ eventType, object, accountObject, accountLifecycleEvent, payment, eventAccount: payload.account || null }));
}

async function applyStripeConnectEvent({ eventType, object, accountObject, accountLifecycleEvent, payment, eventAccount }) {
  if (accountLifecycleEvent) {
    const readiness = normalizeStripeConnectAccountReadiness(accountObject || object);
    if (!readiness.providerAccountId) return { received: true, ignored: true, reason: "account_id_missing" };
    await prisma.restaurantMerchantAccount.updateMany({
      where: { stripeAccountId: readiness.providerAccountId },
      data: merchantUpdateFromReadiness(readiness)
    });
    return { received: true, merchantAccountUpdated: true };
  }
  if (!payment) return { received: true, ignored: true, reason: "payment_not_found" };
  if (["payment_intent.succeeded", "payment.succeeded"].includes(eventType)) {
    if (ORDER_PAYMENT_SETTLED_STATUSES.has(payment.status)) {
      if (payment.provider !== "STRIPE_CONNECT") {
        // The order was settled another way (e.g. cash) but the card also succeeded: a double charge to refund.
        await recordAudit({ restaurantId: payment.restaurantId, action: "order_payment.duplicate_settlement", entityType: "RestaurantOrderPayment", entityId: payment.id, metadata: { settledProvider: payment.provider, paymentIntentId: object.id, requiresReview: true } });
        return { received: true, reviewRequired: true, reason: "paid_by_other_method" };
      }
      return { received: true, ignored: true, reason: "payment_already_settled" };
    }
    // The event must be for this payment's own PaymentIntent, on this restaurant's connected account,
    // for the exact server-computed amount; metadata alone is not trusted.
    const merchant = await prisma.restaurantMerchantAccount.findUnique({ where: { restaurantId_provider: { restaurantId: payment.restaurantId, provider: "STRIPE_CONNECT" } }, select: { stripeAccountId: true } });
    const mismatch = object.id !== payment.providerPaymentIntentId
      || Number(object.amount_received ?? object.amount) !== payment.totalCents
      || String(object.currency || "").toLowerCase() !== String(payment.currency || "").toLowerCase()
      || !eventAccount
      || eventAccount !== merchant?.stripeAccountId;
    if (mismatch) {
      await recordAudit({ restaurantId: payment.restaurantId, action: "order_payment.webhook_mismatch", entityType: "RestaurantOrderPayment", entityId: payment.id, metadata: { paymentIntentId: object.id, amount: object.amount_received ?? object.amount, currency: object.currency, account: eventAccount || null } });
      return { received: true, ignored: true, reason: "payment_event_mismatch" };
    }
    return { received: true, ...(await markOrderPaymentPaid({ payment, providerChargeId: object.latest_charge })) };
  }
  if (["payment_intent.payment_failed", "payment.failed"].includes(eventType)) {
    if (ORDER_PAYMENT_SETTLED_STATUSES.has(payment.status)) return { received: true, ignored: true, reason: "payment_already_settled" };
    return { received: true, payment: await markOrderPaymentFailed({ payment, failureReason: object.last_payment_error?.message }) };
  }
  if (["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"].includes(eventType)) {
    const restaurantRefund = await prisma.restaurantRefund.findFirst({
      where: {
        orderPaymentId: payment.id,
        OR: [{ providerRefundId: object.id }, ...(object.metadata?.restaurantRefundId ? [{ id: object.metadata.restaurantRefundId }] : [])]
      }
    });
    // A refund raised outside Loohar (the Stripe dashboard, or a provider-side reversal) used to be
    // dropped here as refund_not_found. The money had already left the merchant account while Loohar
    // still counted it as refundable and reported it as collected, so the balance a restaurant sees
    // disagreed with the provider (L-20). Mirror it instead. This records only what the provider has
    // already done; it never moves money.
    if (!restaurantRefund) return { received: true, ...(await mirrorProviderRefund({ payment, object })) };
    await prisma.restaurantRefund.update({
      where: { id: restaurantRefund.id },
      data: { providerRefundId: restaurantRefund.providerRefundId || object.id, ...refundStatusFromProvider(object.status) }
    });
    return { received: true, refundUpdated: true };
  }
  if (eventType === "charge.refunded") {
    const refundedAmount = Number(object.amount_refunded || 0);
    await prisma.restaurantOrderPayment.update({
      where: { id: payment.id },
      data: {
        status: refundedAmount >= payment.totalCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
        refundedAt: new Date()
      }
    });
    return { received: true, refunded: true };
  }
  return { received: true, ignored: true };
}

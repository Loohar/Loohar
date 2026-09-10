import { prisma } from "../../config/prisma.js";
import { recordAudit } from "../../services/auditService.js";
import { notifyNewOrderAlert, notifyOrderConfirmation } from "../../services/notificationService.js";
import { buildReceiptPayload, createTrackingToken, customerTrackingUrls, findOrderForTracking, hashToken, limitedTrackingOrder, trackingExpiresAt } from "../../services/orderWorkflowService.js";
import { emitOrderUpdate } from "../../services/realtimeService.js";
import { assertStripeConnectConfigured, assertStripeConnectModeAllowed, stripeConnectPublishableKey, stripeRequest, stripeV2Request, stripeForm } from "../paymentProviders/stripeRest.js";
import { isMerchantAccountPaymentReady } from "./merchantReadiness.js";
import { calculateOrderQuote } from "./quoteService.js";

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

async function createStripePaymentIntent({ quote, order, payment, merchant }) {
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
    stripeAccount: merchant.stripeAccountId
  });
}

export async function createOrderPayment({ body }) {
  const quote = await calculateOrderQuote({ restaurantId: body.restaurantId, body });
  const merchant = await prisma.restaurantMerchantAccount.findUnique({
    where: { restaurantId_provider: { restaurantId: quote.restaurant.id, provider: "STRIPE_CONNECT" } }
  });
  if (!isMerchantAccountPaymentReady(merchant)) {
    const error = new Error("Restaurant order payments are not enabled for this restaurant yet. Complete Stripe Connect onboarding before accepting online payments.");
    error.status = 503;
    error.details = { merchantStatus: merchant?.status || "NOT_STARTED" };
    throw error;
  }

  const initialTrackingToken = createTrackingToken();
  const orderNumber = `${Date.now().toString().slice(-6)}`;
  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        restaurantId: quote.restaurant.id,
        locationId: quote.locationId,
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
              modifiers: item.modifiers || item.options || []
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

  try {
    const intent = await createStripePaymentIntent({ quote, order: created.order, payment: created.payment, merchant });
    const payment = await prisma.restaurantOrderPayment.update({
      where: { id: created.payment.id },
      data: {
        status: intent.status === "requires_confirmation" ? "REQUIRES_CONFIRMATION" : "REQUIRES_PAYMENT_METHOD",
        providerPaymentIntentId: intent.id,
        providerClientSecret: intent.client_secret || null
      }
    });
    return {
      order: created.order,
      payment,
      publishableKey: stripeConnectPublishableKey(),
      clientSecret: intent.client_secret || null,
      tracking: { token: initialTrackingToken, ...customerTrackingUrls(created.order, initialTrackingToken) }
    };
  } catch (error) {
    await prisma.$transaction([
      prisma.restaurantOrderPayment.update({
        where: { id: created.payment.id },
        data: { status: "FAILED", failureReason: error.message || "Payment intent could not be initialized" }
      }),
      prisma.order.update({
        where: { id: created.order.id },
        data: { status: "CANCELLED", statusHistory: { create: { status: "CANCELLED", note: "Payment intent could not be initialized" } } }
      })
    ]);
    throw error;
  }
}

async function issueLoyaltyPoints(order) {
  const existing = await prisma.loyaltyPoint.findFirst({ where: { orderId: order.id, reason: "Order reward" } });
  if (existing) return existing;
  const settings = order.restaurant.loyaltySettingsJson || { pointsPerDollar: 1 };
  const points = Math.floor((order.subtotalCents / 100) * Number(settings.pointsPerDollar || 1));
  if (points <= 0) return null;
  return prisma.loyaltyPoint.create({
    data: {
      restaurantId: order.restaurantId,
      customerId: order.customerId,
      orderId: order.id,
      points,
      reason: "Order reward"
    }
  });
}

export async function markOrderPaymentPaid({ payment, providerChargeId }) {
  const updatedPayment = await prisma.restaurantOrderPayment.update({
    where: { id: payment.id },
    data: {
      status: "PAID",
      providerChargeId: providerChargeId || payment.providerChargeId,
      paidAt: new Date(),
      failureReason: null
    },
    include: { order: { include: { restaurant: true, customer: true, items: true, statusHistory: true } } }
  });
  const order = await prisma.order.update({
    where: { id: updatedPayment.orderId },
    data: {
      status: "ACCEPTED",
      statusHistory: { create: { status: "ACCEPTED", note: "Restaurant order payment succeeded" } }
    },
    include: { restaurant: true, customer: true, items: true, statusHistory: true }
  });
  await issueLoyaltyPoints(order);
  if (order.couponCode) {
    await prisma.coupon.updateMany({
      where: { restaurantId: order.restaurantId, code: order.couponCode },
      data: { redeemedCount: { increment: 1 } }
    });
  }
  await Promise.allSettled([notifyOrderConfirmation({ order }), notifyNewOrderAlert({ order })]);
  emitOrderUpdate(order);
  await recordAudit({ restaurantId: order.restaurantId, action: "order_payment.paid", entityType: "RestaurantOrderPayment", entityId: updatedPayment.id, metadata: { providerPaymentIntentId: updatedPayment.providerPaymentIntentId } });
  return { payment: updatedPayment, order };
}

export async function markOrderPaymentFailed({ payment, failureReason }) {
  const updatedPayment = await prisma.restaurantOrderPayment.update({
    where: { id: payment.id },
    data: { status: "FAILED", failureReason: failureReason || "Payment failed" },
    include: { order: true }
  });
  await recordAudit({ restaurantId: updatedPayment.order.restaurantId, action: "order_payment.failed", entityType: "RestaurantOrderPayment", entityId: updatedPayment.id, metadata: { failureReason: updatedPayment.failureReason } });
  return updatedPayment;
}

export async function refundOrderPayment({ orderId, amountCents, reason, user }) {
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
  const safeAmount = Math.min(Math.max(0, Number(amountCents || payment.totalCents)), payment.totalCents);
  if (!safeAmount) {
    const error = new Error("Refund amount must be greater than zero");
    error.status = 400;
    throw error;
  }
  assertStripeConnectConfigured();
  const stripeRefundReasons = new Set(["duplicate", "fraudulent", "requested_by_customer"]);
  const providerReason = stripeRefundReasons.has(reason) ? reason : "requested_by_customer";
  const body = stripeForm({
    payment_intent: payment.providerPaymentIntentId,
    amount: safeAmount,
    reason: providerReason,
    "metadata[domain]": "RESTAURANT_ORDER_PAYMENT",
    "metadata[orderPaymentId]": payment.id,
    "metadata[orderId]": payment.orderId,
    "metadata[refundNote]": reason || providerReason
  });
  const refund = await stripeRequest({ secretKey: process.env.STRIPE_CONNECT_SECRET_KEY, path: "/refunds", body });
  const restaurantRefund = await prisma.restaurantRefund.create({
    data: {
      restaurantId: payment.restaurantId,
      orderPaymentId: payment.id,
      provider: "STRIPE_CONNECT",
      providerRefundId: refund.id,
      status: refund.status === "succeeded" ? "SUCCEEDED" : "PENDING",
      amountCents: safeAmount,
      reason,
      requestedByUserId: user?.id,
      processedAt: refund.status === "succeeded" ? new Date() : null
    }
  });
  await recordAudit({ actorUserId: user?.id, restaurantId: payment.restaurantId, action: "order_payment.refund.requested", entityType: "RestaurantRefund", entityId: restaurantRefund.id, metadata: { amountCents: safeAmount } });
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
  const paymentIntentId = object.id || object.payment_intent;
  const orderPaymentId = object.metadata?.orderPaymentId;
  const orderId = object.metadata?.orderId;
  let payment = orderPaymentId ? await prisma.restaurantOrderPayment.findUnique({ where: { id: orderPaymentId } }) : null;
  if (!payment && paymentIntentId) payment = await prisma.restaurantOrderPayment.findFirst({ where: { providerPaymentIntentId: paymentIntentId } });
  if (!payment && orderId) payment = await prisma.restaurantOrderPayment.findUnique({ where: { orderId } });

  await prisma.restaurantPaymentEvent.upsert({
    where: { providerEventId },
    create: {
      restaurantId: payment?.restaurantId || accountObject?.metadata?.restaurantId || object.metadata?.restaurantId || null,
      paymentId: payment?.id || null,
      eventDomain: accountLifecycleEvent ? "MERCHANT_ACCOUNT" : eventType?.startsWith("payout.") ? "PAYOUT" : eventType?.startsWith("charge.dispute") ? "DISPUTE" : "RESTAURANT_ORDER_PAYMENT",
      provider: "stripe_connect",
      providerEventId,
      eventType: eventType || "unknown",
      payloadJson: payload,
      processedAt: new Date()
    },
    update: { processedAt: new Date() }
  });

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
    return { received: true, ...(await markOrderPaymentPaid({ payment, providerChargeId: object.latest_charge })) };
  }
  if (["payment_intent.payment_failed", "payment.failed"].includes(eventType)) {
    return { received: true, payment: await markOrderPaymentFailed({ payment, failureReason: object.last_payment_error?.message }) };
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

import { prisma } from "../../config/prisma.js";
import { recordAudit } from "../../services/auditService.js";
import { notifyNewOrderAlert, notifyOrderConfirmation } from "../../services/notificationService.js";
import { createTrackingToken, customerTrackingUrls, hashToken, trackingExpiresAt } from "../../services/orderWorkflowService.js";
import { emitOrderUpdate } from "../../services/realtimeService.js";
import { assertStripeOrderPaymentsEnabled, sanitizeStripePayload, stripeConnectPublishableKey, stripeRequest, stripeForm } from "../paymentProviders/stripeRest.js";
import { calculateOrderQuote } from "./quoteService.js";

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function merchantReady(merchant) {
  return merchant?.provider === "STRIPE_CONNECT"
    && merchant.status === "ENABLED"
    && merchant.stripeAccountId
    && merchant.stripeChargesEnabled
    && merchant.stripePayoutsEnabled
    && merchant.stripeDetailsSubmitted;
}

function orderInclude() {
  return { items: true, customer: true, restaurant: { include: { domains: true } }, statusHistory: true };
}

function providerObjectId(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id || null;
}

function eventDomainFor(eventType = "") {
  if (eventType.startsWith("account.")) return "MERCHANT_ACCOUNT";
  if (eventType.startsWith("payout.")) return "PAYOUT";
  if (eventType.startsWith("charge.dispute")) return "DISPUTE";
  return "RESTAURANT_ORDER_PAYMENT";
}

function refundStatusFromStripe(status = "") {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "failed") return "FAILED";
  if (status === "canceled") return "CANCELED";
  return "PENDING";
}

function disputeStatusFromStripe(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "warning_needs_response") return "WARNING_NEEDS_RESPONSE";
  if (normalized === "warning_under_review") return "WARNING_UNDER_REVIEW";
  if (normalized === "warning_closed") return "WARNING_CLOSED";
  if (normalized === "under_review") return "UNDER_REVIEW";
  if (normalized === "won") return "WON";
  if (normalized === "lost") return "LOST";
  return "NEEDS_RESPONSE";
}

function payoutStatusFromStripe(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "paid") return "PAID";
  if (normalized === "failed") return "FAILED";
  if (normalized === "canceled") return "CANCELED";
  return "PENDING";
}

async function recordPaymentReconciliation({ restaurantId, orderPaymentId, recordType, expectedCents = 0, actualCents = 0, providerObjectId: objectId, providerEventId, metadata = {}, status }) {
  if (!restaurantId) return null;
  return prisma.paymentReconciliationRecord.create({
    data: {
      restaurantId,
      orderPaymentId: orderPaymentId || null,
      provider: "STRIPE_CONNECT",
      recordType,
      status: status || (expectedCents === actualCents ? "MATCHED" : "PENDING_REVIEW"),
      expectedCents,
      actualCents,
      deltaCents: actualCents - expectedCents,
      providerObjectId: objectId || null,
      providerEventId: providerEventId || null,
      metadataJson: metadata
    }
  }).catch(() => null);
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
  assertStripeOrderPaymentsEnabled();
  const restaurant = await prisma.restaurant.findUnique({ where: { id: user.restaurantId } });
  const current = await prisma.restaurantMerchantAccount.findUnique({
    where: { restaurantId_provider: { restaurantId: user.restaurantId, provider: "STRIPE_CONNECT" } }
  });
  let stripeAccountId = current?.stripeAccountId;
  if (!stripeAccountId) {
    const account = await stripeRequest({
      secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
      path: "/accounts",
      body: stripeForm({
        type: "express",
        country: process.env.STRIPE_CONNECT_COUNTRY || "US",
        email: user.email,
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
        "business_profile[name]": restaurant?.businessName || restaurant?.name || "Loohar restaurant",
        "metadata[restaurantId]": user.restaurantId,
        "metadata[domain]": "MERCHANT_ACCOUNT"
      }),
      idempotencyKey: `merchant-account:${user.restaurantId}`
    });
    stripeAccountId = account.id;
  }
  const refreshUrl = process.env.STRIPE_CONNECT_REFRESH_URL || `${process.env.APP_URL || "https://loohar.com"}/restaurant/${restaurant?.slug || ""}/settings/payments?connect=refresh`;
  const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL || `${process.env.APP_URL || "https://loohar.com"}/restaurant/${restaurant?.slug || ""}/settings/payments?connect=return`;
  const link = await stripeRequest({
    secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
    path: "/account_links",
    body: stripeForm({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding"
    })
  });
  const merchantAccount = await prisma.restaurantMerchantAccount.upsert({
    where: { restaurantId_provider: { restaurantId: user.restaurantId, provider: "STRIPE_CONNECT" } },
    create: {
      restaurantId: user.restaurantId,
      provider: "STRIPE_CONNECT",
      status: "ACTION_REQUIRED",
      stripeAccountId,
      accountType: "express",
      country: process.env.STRIPE_CONNECT_COUNTRY || "US",
      onboardingUrlExpiresAt: link.expires_at ? new Date(link.expires_at * 1000) : null
    },
    update: {
      status: current?.status === "ENABLED" ? "ENABLED" : "ACTION_REQUIRED",
      stripeAccountId,
      accountType: current?.accountType || "express",
      country: current?.country || process.env.STRIPE_CONNECT_COUNTRY || "US",
      onboardingUrlExpiresAt: link.expires_at ? new Date(link.expires_at * 1000) : null
    }
  });
  await recordAudit({ actorUserId: user.id, restaurantId: user.restaurantId, action: "merchant_account.onboarding_link.created", entityType: "RestaurantMerchantAccount", entityId: merchantAccount.id });
  return { onboardingUrl: link.url, merchantAccount };
}

async function createStripePaymentIntent({ quote, order, payment, merchant }) {
  assertStripeOrderPaymentsEnabled();
  const chargeModel = process.env.STRIPE_CONNECT_CHARGE_MODEL || "destination_charge";
  if (chargeModel !== "destination_charge") {
    const error = new Error("Only Stripe Connect destination charges are certified for restaurant order payments.");
    error.status = 503;
    throw error;
  }
  const body = stripeForm({
    amount: quote.totalCents,
    currency: quote.currency,
    "automatic_payment_methods[enabled]": "true",
    application_fee_amount: quote.platformFeeCents,
    "transfer_data[destination]": merchant.stripeAccountId,
    "metadata[domain]": "RESTAURANT_ORDER_PAYMENT",
    "metadata[restaurantId]": order.restaurantId,
    "metadata[orderId]": order.id,
    "metadata[orderPaymentId]": payment.id,
    "metadata[orderNumber]": order.orderNumber
  });
  return stripeRequest({
    secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
    path: "/payment_intents",
    body,
    idempotencyKey: `order-payment:${payment.id}`
  });
}

export async function createOrderPayment({ body }) {
  assertStripeOrderPaymentsEnabled();
  const quote = await calculateOrderQuote({ restaurantId: body.restaurantId, body });
  const merchant = await prisma.restaurantMerchantAccount.findUnique({
    where: { restaurantId_provider: { restaurantId: quote.restaurant.id, provider: "STRIPE_CONNECT" } }
  });
  if (!merchantReady(merchant)) {
    const error = new Error("Restaurant order payments are not enabled for this restaurant yet. Complete Stripe Connect onboarding before accepting online payments.");
    error.status = 503;
    error.details = { merchantStatus: merchant?.status || "NOT_STARTED" };
    throw error;
  }

  const initialTrackingToken = createTrackingToken();
  const orderNumber = `${Date.now().toString().slice(-6)}`;
  const created = await prisma.$transaction(async (tx) => {
    const paymentQuote = await tx.paymentQuote.create({
      data: {
        restaurantId: quote.restaurant.id,
        provider: "STRIPE_CONNECT",
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
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        quoteJson: {
          items: quote.items,
          breakdown: quote.breakdown,
          couponCode: quote.couponCode,
          taxRateBps: quote.taxRateBps
        }
      }
    });
    const order = await tx.order.create({
      data: {
        restaurantId: quote.restaurant.id,
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
            unitPriceCents: item.baseUnitPriceCents,
            optionsJson: item.options
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
        paymentQuoteId: paymentQuote.id,
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
        transferAmountCents: Math.max(0, quote.totalCents - quote.platformFeeCents),
        quoteJson: {
          items: quote.items,
          breakdown: quote.breakdown,
          couponCode: quote.couponCode,
          taxRateBps: quote.taxRateBps
        }
      }
    });
    await tx.orderTaxSnapshot.create({
      data: {
        orderId: order.id,
        restaurantId: order.restaurantId,
        provider: "manual",
        taxableAmountCents: quote.taxableAmountCents,
        taxRateBps: quote.taxRateBps,
        taxCents: quote.taxCents
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
        providerClientSecret: intent.client_secret || null,
        transferAmountCents: Math.max(0, quote.totalCents - quote.platformFeeCents)
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
  if (payment.status === "PAID") {
    const current = await prisma.restaurantOrderPayment.findUnique({
      where: { id: payment.id },
      include: { order: { include: { restaurant: true, customer: true, items: true, statusHistory: true } } }
    });
    return { payment: current, order: current?.order };
  }
  const updatedPayment = await prisma.restaurantOrderPayment.update({
    where: { id: payment.id },
    data: {
      status: "PAID",
      providerChargeId: providerObjectId(providerChargeId) || payment.providerChargeId,
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
  await recordPaymentReconciliation({
    restaurantId: order.restaurantId,
    orderPaymentId: updatedPayment.id,
    recordType: "PAYMENT_CAPTURE",
    expectedCents: updatedPayment.totalCents,
    actualCents: updatedPayment.totalCents,
    providerObjectId: providerObjectId(providerChargeId) || updatedPayment.providerPaymentIntentId,
    metadata: { platformFeeCents: updatedPayment.platformFeeCents, restaurantNetCents: updatedPayment.restaurantNetCents }
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
  if (["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status)) return payment;
  const updatedPayment = await prisma.restaurantOrderPayment.update({
    where: { id: payment.id },
    data: { status: "FAILED", failureReason: failureReason || "Payment failed" },
    include: { order: true }
  });
  await recordAudit({ restaurantId: updatedPayment.order.restaurantId, action: "order_payment.failed", entityType: "RestaurantOrderPayment", entityId: updatedPayment.id, metadata: { failureReason: updatedPayment.failureReason } });
  return updatedPayment;
}

export async function refundOrderPayment({ orderId, amountCents, reason, idempotencyKey, user }) {
  const payment = await prisma.restaurantOrderPayment.findUnique({ where: { orderId }, include: { order: true, restaurant: true, refunds: true } });
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
  if (!payment.providerPaymentIntentId) {
    const error = new Error("This order does not have a provider payment intent to refund.");
    error.status = 409;
    throw error;
  }
  assertStripeOrderPaymentsEnabled();
  const completedOrPendingRefundCents = payment.refunds
    .filter((refund) => ["PENDING", "SUCCEEDED"].includes(refund.status))
    .reduce((sum, refund) => sum + refund.amountCents, 0);
  const remainingRefundableCents = Math.max(0, payment.totalCents - completedOrPendingRefundCents);
  const safeAmount = Math.min(Math.max(0, Number(amountCents || remainingRefundableCents)), remainingRefundableCents);
  if (!safeAmount) {
    const error = new Error("Refund amount must be greater than zero");
    error.status = 400;
    throw error;
  }
  const safeIdempotencyKey = idempotencyKey || `refund:${payment.id}:${safeAmount}:${completedOrPendingRefundCents}`;
  const existingRefund = await prisma.restaurantRefund.findUnique({ where: { idempotencyKey: safeIdempotencyKey } }).catch(() => null);
  if (existingRefund) return existingRefund;
  const stripeRefundReasons = new Set(["duplicate", "fraudulent", "requested_by_customer"]);
  const providerReason = stripeRefundReasons.has(reason) ? reason : "requested_by_customer";
  const reverseTransfer = envFlag("STRIPE_CONNECT_REVERSE_TRANSFER_ON_REFUND", true);
  const refundApplicationFee = envFlag("STRIPE_CONNECT_REFUND_APPLICATION_FEE", true);
  const proportionalPlatformFee = payment.totalCents > 0
    ? Math.min(payment.platformFeeCents, Math.round((payment.platformFeeCents * safeAmount) / payment.totalCents))
    : 0;
  const body = stripeForm({
    payment_intent: payment.providerPaymentIntentId,
    amount: safeAmount,
    reason: providerReason,
    reverse_transfer: reverseTransfer ? "true" : undefined,
    refund_application_fee: refundApplicationFee ? "true" : undefined,
    "metadata[domain]": "RESTAURANT_ORDER_PAYMENT",
    "metadata[orderPaymentId]": payment.id,
    "metadata[orderId]": payment.orderId,
    "metadata[refundNote]": reason || providerReason
  });
  const refund = await stripeRequest({ secretKey: process.env.STRIPE_CONNECT_SECRET_KEY, path: "/refunds", body, idempotencyKey: safeIdempotencyKey });
  const restaurantRefund = await prisma.restaurantRefund.create({
    data: {
      restaurantId: payment.restaurantId,
      orderPaymentId: payment.id,
      provider: "STRIPE_CONNECT",
      providerRefundId: refund.id,
      idempotencyKey: safeIdempotencyKey,
      status: refundStatusFromStripe(refund.status),
      amountCents: safeAmount,
      applicationFeeRefundedCents: refundApplicationFee ? proportionalPlatformFee : 0,
      transferReversedCents: reverseTransfer ? Math.max(0, safeAmount - proportionalPlatformFee) : 0,
      reason,
      requestedByUserId: user?.id,
      processedAt: refund.status === "succeeded" ? new Date() : null,
      completedAt: refund.status === "succeeded" ? new Date() : null
    }
  });
  await recordPaymentReconciliation({
    restaurantId: payment.restaurantId,
    orderPaymentId: payment.id,
    recordType: "REFUND",
    expectedCents: safeAmount,
    actualCents: refund.amount || safeAmount,
    providerObjectId: refund.id,
    metadata: { reverseTransfer, refundApplicationFee }
  });
  await recordAudit({ actorUserId: user?.id, restaurantId: payment.restaurantId, action: "order_payment.refund.requested", entityType: "RestaurantRefund", entityId: restaurantRefund.id, metadata: { amountCents: safeAmount } });
  return restaurantRefund;
}

export async function statusForOrder({ orderId }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { restaurantOrderPayment: true, customer: true, items: true, statusHistory: true }
  });
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  return { order, payment: order.restaurantOrderPayment };
}

export async function receiptForOrder({ orderId }) {
  const { order, payment } = await statusForOrder({ orderId });
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

async function upsertDisputeFromStripe({ object, payment, providerEventId }) {
  const chargeId = providerObjectId(object.charge);
  const paymentIntentId = providerObjectId(object.payment_intent) || payment?.providerPaymentIntentId || null;
  const resolvedPayment = payment
    || (chargeId ? await prisma.restaurantOrderPayment.findFirst({ where: { providerChargeId: chargeId } }) : null)
    || (paymentIntentId ? await prisma.restaurantOrderPayment.findFirst({ where: { providerPaymentIntentId: paymentIntentId } }) : null);
  const restaurantId = resolvedPayment?.restaurantId || object.metadata?.restaurantId;
  if (!restaurantId || !object.id) return null;
  const dispute = await prisma.restaurantPaymentDispute.upsert({
    where: { providerDisputeId: object.id },
    create: {
      restaurantId,
      orderPaymentId: resolvedPayment?.id || null,
      provider: "STRIPE_CONNECT",
      providerDisputeId: object.id,
      providerChargeId: chargeId,
      providerPaymentIntentId: paymentIntentId,
      status: disputeStatusFromStripe(object.status),
      amountCents: Number(object.amount || 0),
      currency: String(object.currency || resolvedPayment?.currency || "usd").toLowerCase(),
      reason: object.reason || null,
      evidenceDueAt: object.evidence_details?.due_by ? new Date(Number(object.evidence_details.due_by) * 1000) : null,
      openedAt: object.created ? new Date(Number(object.created) * 1000) : new Date(),
      closedAt: ["won", "lost", "warning_closed"].includes(String(object.status || "").toLowerCase()) ? new Date() : null,
      metadataJson: sanitizeStripePayload(object)
    },
    update: {
      orderPaymentId: resolvedPayment?.id || null,
      providerChargeId: chargeId,
      providerPaymentIntentId: paymentIntentId,
      status: disputeStatusFromStripe(object.status),
      amountCents: Number(object.amount || 0),
      reason: object.reason || null,
      evidenceDueAt: object.evidence_details?.due_by ? new Date(Number(object.evidence_details.due_by) * 1000) : null,
      closedAt: ["won", "lost", "warning_closed"].includes(String(object.status || "").toLowerCase()) ? new Date() : null,
      metadataJson: sanitizeStripePayload(object)
    }
  });
  await recordPaymentReconciliation({
    restaurantId,
    orderPaymentId: resolvedPayment?.id || null,
    recordType: "DISPUTE",
    expectedCents: resolvedPayment?.totalCents || Number(object.amount || 0),
    actualCents: Number(object.amount || 0),
    providerObjectId: object.id,
    providerEventId,
    metadata: { status: dispute.status, reason: dispute.reason }
  });
  return dispute;
}

async function upsertPayoutFromStripe({ payload, object, providerEventId }) {
  const accountId = payload.account || object.destination || object.account || null;
  const merchant = accountId ? await prisma.restaurantMerchantAccount.findFirst({ where: { stripeAccountId: accountId } }) : null;
  if (!merchant?.restaurantId || !object.id) return null;
  const payout = await prisma.restaurantPayout.upsert({
    where: { providerPayoutId: object.id },
    create: {
      restaurantId: merchant.restaurantId,
      provider: "STRIPE_CONNECT",
      providerPayoutId: object.id,
      status: payoutStatusFromStripe(object.status),
      amountCents: Number(object.amount || 0),
      currency: String(object.currency || merchant.defaultCurrency || "usd").toLowerCase(),
      arrivalDate: object.arrival_date ? new Date(Number(object.arrival_date) * 1000) : null,
      paidAt: object.status === "paid" ? new Date() : null,
      failureReason: object.failure_message || object.failure_code || null,
      metadataJson: sanitizeStripePayload(object)
    },
    update: {
      status: payoutStatusFromStripe(object.status),
      amountCents: Number(object.amount || 0),
      arrivalDate: object.arrival_date ? new Date(Number(object.arrival_date) * 1000) : null,
      paidAt: object.status === "paid" ? new Date() : null,
      failureReason: object.failure_message || object.failure_code || null,
      metadataJson: sanitizeStripePayload(object)
    }
  });
  await recordPaymentReconciliation({
    restaurantId: merchant.restaurantId,
    recordType: "PAYOUT",
    expectedCents: Number(object.amount || 0),
    actualCents: Number(object.amount || 0),
    providerObjectId: object.id,
    providerEventId,
    metadata: { status: payout.status, stripeAccountId: accountId }
  });
  return payout;
}

export async function handleStripeConnectWebhook(payload = {}) {
  const eventType = payload.type || payload.eventType || "unknown";
  const object = payload.data?.object || payload.object || {};
  const eventId = payload.id || payload.providerEventId;
  const providerEventId = eventId || `manual-${eventType}-${object.id || Date.now()}`;
  const existingEvent = eventId ? await prisma.restaurantPaymentEvent.findUnique({ where: { providerEventId } }) : null;
  if (existingEvent?.processedAt) return { received: true, duplicate: true };

  const paymentIntentId = providerObjectId(object.payment_intent) || (eventType.startsWith("payment_intent.") ? object.id : null);
  const orderPaymentId = object.metadata?.orderPaymentId;
  const orderId = object.metadata?.orderId;
  let payment = orderPaymentId ? await prisma.restaurantOrderPayment.findUnique({ where: { id: orderPaymentId } }) : null;
  if (!payment && paymentIntentId) payment = await prisma.restaurantOrderPayment.findFirst({ where: { providerPaymentIntentId: paymentIntentId } });
  if (!payment && object.latest_charge) payment = await prisma.restaurantOrderPayment.findFirst({ where: { providerChargeId: providerObjectId(object.latest_charge) } });
  if (!payment && orderId) payment = await prisma.restaurantOrderPayment.findUnique({ where: { orderId } });

  const eventRecord = await prisma.restaurantPaymentEvent.upsert({
    where: { providerEventId },
    create: {
      restaurantId: payment?.restaurantId || object.metadata?.restaurantId || null,
      paymentId: payment?.id || null,
      eventDomain: eventDomainFor(eventType),
      provider: "stripe_connect",
      providerEventId,
      eventType,
      payloadJson: sanitizeStripePayload(payload),
      processedAt: null
    },
    update: {
      restaurantId: payment?.restaurantId || object.metadata?.restaurantId || existingEvent?.restaurantId || null,
      paymentId: payment?.id || existingEvent?.paymentId || null,
      eventType,
      payloadJson: sanitizeStripePayload(payload)
    }
  });

  const finish = async (result) => {
    await prisma.restaurantPaymentEvent.update({ where: { id: eventRecord.id }, data: { processedAt: new Date() } });
    return result;
  };

  if (eventType === "account.updated") {
    const accountId = object.id;
    const status = object.charges_enabled && object.payouts_enabled && object.details_submitted ? "ENABLED" : object.details_submitted ? "PENDING_VERIFICATION" : "ACTION_REQUIRED";
    await prisma.restaurantMerchantAccount.updateMany({
      where: { stripeAccountId: accountId },
      data: {
        status,
        stripeChargesEnabled: Boolean(object.charges_enabled),
        stripePayoutsEnabled: Boolean(object.payouts_enabled),
        stripeDetailsSubmitted: Boolean(object.details_submitted),
        accountType: object.type || null,
        country: object.country || null,
        disabledReason: object.requirements?.disabled_reason || null,
        requirementsJson: object.requirements || {},
        onboardingCompletedAt: object.details_submitted ? new Date() : null,
        enabledAt: status === "ENABLED" ? new Date() : null,
        lastSyncedAt: new Date()
      }
    });
    return finish({ received: true, merchantAccountUpdated: true });
  }

  if (eventType.startsWith("charge.dispute")) {
    const dispute = await upsertDisputeFromStripe({ object, payment, providerEventId });
    return finish({ received: true, disputeUpdated: Boolean(dispute) });
  }

  if (eventType.startsWith("payout.")) {
    const payout = await upsertPayoutFromStripe({ payload, object, providerEventId });
    return finish({ received: true, payoutUpdated: Boolean(payout) });
  }

  if (!payment) return finish({ received: true, ignored: true, reason: "payment_not_found" });

  if (["payment_intent.succeeded", "payment.succeeded"].includes(eventType)) {
    return finish({ received: true, ...(await markOrderPaymentPaid({ payment, providerChargeId: object.latest_charge })) });
  }

  if (["payment_intent.payment_failed", "payment.failed"].includes(eventType)) {
    return finish({ received: true, payment: await markOrderPaymentFailed({ payment, failureReason: object.last_payment_error?.message }) });
  }

  if (eventType === "charge.refunded") {
    const refundedAmount = Number(object.amount_refunded || 0);
    await prisma.restaurantOrderPayment.update({
      where: { id: payment.id },
      data: {
        status: refundedAmount >= payment.totalCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
        providerChargeId: object.id || payment.providerChargeId,
        refundedAt: new Date()
      }
    });
    await recordPaymentReconciliation({
      restaurantId: payment.restaurantId,
      orderPaymentId: payment.id,
      recordType: "REFUND_WEBHOOK",
      expectedCents: refundedAmount,
      actualCents: refundedAmount,
      providerObjectId: object.id,
      providerEventId,
      metadata: { paymentIntentId: payment.providerPaymentIntentId }
    });
    return finish({ received: true, refunded: true });
  }

  return finish({ received: true, ignored: true });
}

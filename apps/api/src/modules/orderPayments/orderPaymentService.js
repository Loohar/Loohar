import { prisma } from "../../config/prisma.js";
import { recordAudit } from "../../services/auditService.js";
import { notifyNewOrderAlert, notifyOrderConfirmation } from "../../services/notificationService.js";
import { createTrackingToken, customerTrackingUrls, hashToken, trackingExpiresAt } from "../../services/orderWorkflowService.js";
import { emitOrderUpdate } from "../../services/realtimeService.js";
import { assertStripeConnectConfigured, stripeConnectPublishableKey, stripeRequest, stripeForm } from "../paymentProviders/stripeRest.js";
import { calculateOrderQuote } from "./quoteService.js";

function merchantReady(merchant) {
  return merchant?.provider === "STRIPE_CONNECT" && merchant.status === "ENABLED" && merchant.stripeAccountId && merchant.stripeChargesEnabled;
}

function orderInclude() {
  return { items: true, customer: true, restaurant: { include: { domains: true } }, statusHistory: true };
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
      })
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
      onboardingUrlExpiresAt: link.expires_at ? new Date(link.expires_at * 1000) : null
    },
    update: {
      status: current?.status === "ENABLED" ? "ENABLED" : "ACTION_REQUIRED",
      stripeAccountId,
      onboardingUrlExpiresAt: link.expires_at ? new Date(link.expires_at * 1000) : null
    }
  });
  await recordAudit({ actorUserId: user.id, restaurantId: user.restaurantId, action: "merchant_account.onboarding_link.created", entityType: "RestaurantMerchantAccount", entityId: merchantAccount.id });
  return { onboardingUrl: link.url, merchantAccount };
}

async function createStripePaymentIntent({ quote, order, payment, merchant }) {
  assertStripeConnectConfigured();
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
    body
  });
}

export async function createOrderPayment({ body }) {
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

export async function handleStripeConnectWebhook(payload = {}) {
  const eventType = payload.type || payload.eventType;
  const object = payload.data?.object || payload.object || {};
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
      restaurantId: payment?.restaurantId || object.metadata?.restaurantId || null,
      paymentId: payment?.id || null,
      eventDomain: eventType?.startsWith("account.") ? "MERCHANT_ACCOUNT" : eventType?.startsWith("payout.") ? "PAYOUT" : eventType?.startsWith("charge.dispute") ? "DISPUTE" : "RESTAURANT_ORDER_PAYMENT",
      provider: "stripe_connect",
      providerEventId,
      eventType: eventType || "unknown",
      payloadJson: payload,
      processedAt: new Date()
    },
    update: { processedAt: new Date() }
  });

  if (eventType === "account.updated") {
    const accountId = object.id;
    const status = object.charges_enabled && object.payouts_enabled ? "ENABLED" : object.details_submitted ? "PENDING_VERIFICATION" : "ACTION_REQUIRED";
    await prisma.restaurantMerchantAccount.updateMany({
      where: { stripeAccountId: accountId },
      data: {
        status,
        stripeChargesEnabled: Boolean(object.charges_enabled),
        stripePayoutsEnabled: Boolean(object.payouts_enabled),
        stripeDetailsSubmitted: Boolean(object.details_submitted),
        disabledReason: object.requirements?.disabled_reason || null,
        requirementsJson: object.requirements || {}
      }
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

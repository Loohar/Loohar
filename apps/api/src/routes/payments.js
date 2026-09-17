import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { parseRawWebhook, verifyStripeWebhook } from "../modules/paymentProviders/stripeRest.js";
import { processStripeWebhookEventOnce } from "../modules/paymentProviders/stripeWebhookEvents.js";
import { recordAudit } from "../services/auditService.js";
import { normalizeStripeEvent } from "../services/paymentService.js";
import { notifyNewOrderAlert, notifyOrderConfirmation } from "../services/notificationService.js";
import { emitOrderUpdate } from "../services/realtimeService.js";

const router = Router();

async function issueLoyaltyPoints({ order }) {
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

async function markPaymentPaid({ payment, providerPaymentId, stripePaymentIntentId, stripeCustomerId }) {
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "PAID",
      providerPaymentId: payment.providerPaymentId || providerPaymentId,
      stripePaymentIntentId: stripePaymentIntentId || payment.stripePaymentIntentId,
      stripeCustomerId: stripeCustomerId || payment.stripeCustomerId,
      paidAt: new Date(),
      failureReason: null
    },
    include: { order: { include: { restaurant: true, customer: true, items: true, statusHistory: true } } }
  });
  const order = await prisma.order.update({
    where: { id: updatedPayment.orderId },
    data: {
      status: "ACCEPTED",
      statusHistory: { create: { status: "ACCEPTED", note: "Payment succeeded" } }
    },
    include: { restaurant: true, customer: true, items: true, statusHistory: true }
  });
  await issueLoyaltyPoints({ order });
  if (order.couponCode) {
    await prisma.coupon.updateMany({
      where: { restaurantId: order.restaurantId, code: order.couponCode },
      data: { redeemedCount: { increment: 1 } }
    });
  }
  await Promise.allSettled([notifyOrderConfirmation({ order }), notifyNewOrderAlert({ order })]);
  emitOrderUpdate(order);
  await recordAudit({ restaurantId: order.restaurantId, action: "payment.paid", entityType: "Payment", entityId: updatedPayment.id, metadata: { providerPaymentId: updatedPayment.providerPaymentId, stripePaymentIntentId: updatedPayment.stripePaymentIntentId } });
  return { payment: updatedPayment, order };
}

async function markPaymentFailed({ payment, failureReason, stripePaymentIntentId, stripeCustomerId }) {
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "FAILED",
      stripePaymentIntentId: stripePaymentIntentId || payment.stripePaymentIntentId,
      stripeCustomerId: stripeCustomerId || payment.stripeCustomerId,
      failureReason: failureReason || "Payment failed"
    },
    include: { order: true }
  });
  await recordAudit({ restaurantId: updatedPayment.order.restaurantId, action: "payment.failed", entityType: "Payment", entityId: updatedPayment.id, metadata: { failureReason: updatedPayment.failureReason } });
  return updatedPayment;
}

async function markPaymentRefunded({ payment }) {
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "REFUNDED", refundedAt: new Date() },
    include: { order: true }
  });
  await recordAudit({ restaurantId: updatedPayment.order.restaurantId, action: "payment.refunded", entityType: "Payment", entityId: updatedPayment.id });
  return updatedPayment;
}

function dateFromStripeUnix(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined;
}

async function updateTenantSubscriptionFromStripe({ event }) {
  const where = event.stripeSubscriptionId
    ? { stripeSubscriptionId: event.stripeSubscriptionId }
    : event.stripeCustomerId
      ? { stripeCustomerId: event.stripeCustomerId }
      : null;
  if (!where) return { ignored: true, reason: "missing_subscription_identity" };
  const subscription = await prisma.tenantSubscription.findFirst({ where, include: { restaurant: true } });
  if (!subscription) return { ignored: true, reason: "subscription_not_found" };
  const deleting = event.eventType === "customer.subscription.deleted";
  const data = {
    active: !deleting,
    ...(event.stripeCustomerId ? { stripeCustomerId: event.stripeCustomerId } : {}),
    ...(event.stripeSubscriptionId ? { stripeSubscriptionId: event.stripeSubscriptionId } : {}),
    ...(dateFromStripeUnix(event.currentPeriodStart) ? { currentPeriodStart: dateFromStripeUnix(event.currentPeriodStart) } : {}),
    ...(dateFromStripeUnix(event.currentPeriodEnd) ? { currentPeriodEnd: dateFromStripeUnix(event.currentPeriodEnd), renewalDate: dateFromStripeUnix(event.currentPeriodEnd) } : {})
  };
  const updatedSubscription = await prisma.tenantSubscription.update({
    where: { id: subscription.id },
    data,
    include: { plan: true, restaurant: true }
  });
  await recordAudit({
    restaurantId: updatedSubscription.restaurantId,
    action: deleting ? "subscription.deleted" : "subscription.updated",
    entityType: "TenantSubscription",
    entityId: updatedSubscription.id,
    metadata: { stripeCustomerId: event.stripeCustomerId, stripeSubscriptionId: event.stripeSubscriptionId }
  });
  return { subscription: updatedSubscription };
}

const LEGACY_PAID_STATUSES = new Set(["PAID", "REFUNDED"]);

async function applyLegacyStripeEvent(event) {
  if (["customer.subscription.updated", "customer.subscription.deleted"].includes(event.eventType)) {
    return { received: true, ...(await updateTenantSubscriptionFromStripe({ event })) };
  }
  let payment = event.providerPaymentId
    ? await prisma.payment.findFirst({ where: { providerPaymentId: event.providerPaymentId } })
    : null;
  if (!payment && event.stripePaymentIntentId) {
    payment = await prisma.payment.findFirst({ where: { stripePaymentIntentId: event.stripePaymentIntentId } });
  }
  if (!payment && event.orderId) {
    payment = await prisma.payment.findUnique({ where: { orderId: event.orderId } });
  }
  if (!payment) return { received: true, ignored: true, reason: "payment_not_found" };

  // Guards keep late or repeated deliveries from re-running paid side effects (order status reset,
  // coupon redemption, notifications) or downgrading a settled payment.
  if (["payment_intent.succeeded", "checkout.session.completed", "payment.succeeded"].includes(event.eventType)) {
    if (LEGACY_PAID_STATUSES.has(payment.status)) return { received: true, ignored: true, reason: "payment_already_settled" };
    return { received: true, ...(await markPaymentPaid({ payment, providerPaymentId: event.providerPaymentId, stripePaymentIntentId: event.stripePaymentIntentId, stripeCustomerId: event.stripeCustomerId })) };
  }
  if (["payment_intent.payment_failed", "payment.failed"].includes(event.eventType)) {
    if (LEGACY_PAID_STATUSES.has(payment.status)) return { received: true, ignored: true, reason: "payment_already_settled" };
    return { received: true, payment: await markPaymentFailed({ payment, failureReason: event.failureReason, stripePaymentIntentId: event.stripePaymentIntentId, stripeCustomerId: event.stripeCustomerId }) };
  }
  if (["charge.refunded", "payment.refunded"].includes(event.eventType)) {
    if (payment.status === "REFUNDED") return { received: true, ignored: true, reason: "payment_already_refunded" };
    return { received: true, payment: await markPaymentRefunded({ payment }) };
  }
  return { received: true, ignored: true };
}

router.post("/webhook", async (req, res, next) => {
  try {
    const { rawBody, payload } = parseRawWebhook(req);
    // Fails closed: a missing STRIPE_WEBHOOK_SECRET rejects every event instead of skipping verification.
    verifyStripeWebhook({
      rawBody,
      signatureHeader: req.get("stripe-signature") || "",
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
    });
    if (!payload.id || !payload.type) {
      const error = new Error("Stripe event id and type are required");
      error.status = 400;
      throw error;
    }
    const event = normalizeStripeEvent(payload);
    const result = await processStripeWebhookEventOnce({
      restaurantId: null,
      paymentId: null,
      eventDomain: event.eventType.startsWith("customer.subscription.") ? "PLATFORM_BILLING" : "RESTAURANT_ORDER_PAYMENT",
      provider: "stripe_legacy",
      providerEventId: `stripe_legacy:${payload.id}`,
      eventType: event.eventType,
      payloadJson: { id: payload.id, type: payload.type }
    }, () => applyLegacyStripeEvent(event));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;

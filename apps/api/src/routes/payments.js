import crypto from "crypto";
import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { recordAudit } from "../services/auditService.js";
import { normalizeStripeEvent } from "../services/paymentService.js";
import { notifyNewOrderAlert, notifyOrderConfirmation } from "../services/notificationService.js";
import { emitOrderUpdate } from "../services/realtimeService.js";

const router = Router();

function timingSafeEqualHex(left = "", right = "") {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseStripeSignature(signatureHeader = "") {
  return signatureHeader.split(",").reduce((parts, pair) => {
    const [key, value] = pair.split("=");
    if (!key || !value) return parts;
    if (key === "t") parts.timestamp = value;
    if (key === "v1") parts.signatures.push(value);
    return parts;
  }, { timestamp: "", signatures: [] });
}

function parseWebhookBody(req) {
  if (Buffer.isBuffer(req.body)) {
    const rawBody = req.body.toString("utf8");
    try {
      return { rawBody, payload: JSON.parse(rawBody) };
    } catch {
      const error = new Error("Invalid webhook JSON payload");
      error.status = 400;
      throw error;
    }
  }
  const rawBody = JSON.stringify(req.body || {});
  return { rawBody, payload: req.body || {} };
}

function verifyStripeWebhookSignature({ rawBody, signatureHeader }) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return;
  if (!signatureHeader) {
    const error = new Error("Missing Stripe signature");
    error.status = 400;
    throw error;
  }
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!timestamp || signatures.length === 0) {
    const error = new Error("Invalid Stripe signature header");
    error.status = 400;
    throw error;
  }
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(signedPayload, "utf8").digest("hex");
  const valid = signatures.some((signature) => timingSafeEqualHex(signature, expectedSignature));
  if (!valid) {
    const error = new Error("Invalid Stripe signature");
    error.status = 400;
    throw error;
  }
}

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

router.post("/webhook", async (req, res, next) => {
  try {
    const { rawBody, payload } = parseWebhookBody(req);
    verifyStripeWebhookSignature({ rawBody, signatureHeader: req.get("stripe-signature") || "" });
    const event = normalizeStripeEvent(payload);
    if (["customer.subscription.updated", "customer.subscription.deleted"].includes(event.eventType)) {
      const result = await updateTenantSubscriptionFromStripe({ event });
      return res.json({ received: true, ...result });
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
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    if (["payment_intent.succeeded", "checkout.session.completed", "payment.succeeded"].includes(event.eventType)) {
      const result = await markPaymentPaid({ payment, providerPaymentId: event.providerPaymentId, stripePaymentIntentId: event.stripePaymentIntentId, stripeCustomerId: event.stripeCustomerId });
      return res.json({ received: true, ...result });
    }
    if (["payment_intent.payment_failed", "payment.failed"].includes(event.eventType)) {
      const failedPayment = await markPaymentFailed({ payment, failureReason: event.failureReason, stripePaymentIntentId: event.stripePaymentIntentId, stripeCustomerId: event.stripeCustomerId });
      return res.json({ received: true, payment: failedPayment });
    }
    if (["charge.refunded", "payment.refunded"].includes(event.eventType)) {
      const refundedPayment = await markPaymentRefunded({ payment });
      return res.json({ received: true, payment: refundedPayment });
    }
    res.json({ received: true, ignored: true });
  } catch (error) {
    next(error);
  }
});

export default router;

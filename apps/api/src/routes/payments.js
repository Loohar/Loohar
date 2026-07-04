import { Router } from "express";
import { prisma } from "../config/prisma.js";
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

async function markPaymentPaid({ payment, providerPaymentId }) {
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PAID", providerPaymentId: providerPaymentId || payment.providerPaymentId, paidAt: new Date(), failureReason: null },
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
  await recordAudit({ restaurantId: order.restaurantId, action: "payment.paid", entityType: "Payment", entityId: updatedPayment.id, metadata: { providerPaymentId: updatedPayment.providerPaymentId } });
  return { payment: updatedPayment, order };
}

async function markPaymentFailed({ payment, failureReason }) {
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "FAILED", failureReason: failureReason || "Payment failed" },
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

router.post("/placeholder/:orderId/succeed", async (req, res, next) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { orderId: req.params.orderId } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    if (payment.status === "PAID") {
      const order = await prisma.order.findUnique({ where: { id: payment.orderId }, include: { restaurant: true, customer: true, items: true, statusHistory: true } });
      return res.json({ payment, order });
    }
    const result = await markPaymentPaid({ payment, providerPaymentId: payment.providerPaymentId });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/webhook", async (req, res, next) => {
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET && !req.get("stripe-signature")) {
      return res.status(400).json({ error: "Missing Stripe signature" });
    }
    const event = normalizeStripeEvent(req.body);
    const payment = event.providerPaymentId
      ? await prisma.payment.findFirst({ where: { providerPaymentId: event.providerPaymentId } })
      : await prisma.payment.findUnique({ where: { orderId: event.orderId } });
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    if (["payment_intent.succeeded", "checkout.session.completed", "payment.succeeded"].includes(event.eventType)) {
      const result = await markPaymentPaid({ payment, providerPaymentId: event.providerPaymentId });
      return res.json({ received: true, ...result });
    }
    if (["payment_intent.payment_failed", "payment.failed"].includes(event.eventType)) {
      const failedPayment = await markPaymentFailed({ payment, failureReason: event.failureReason });
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

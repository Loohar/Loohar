import { Router } from "express";
import { FEATURE } from "../config/entitlements.js";
import { prisma } from "../config/prisma.js";
import { assertFeatureForRestaurant } from "../middleware/entitlements.js";
import { requireAuth } from "../middleware/auth.js";
import { recordAudit } from "../services/auditService.js";
import { buildReceiptPayload, findOrderForTracking, issueOrderTrackingToken, limitedTrackingOrder, normalizeTipInput, receiptOrderInclude } from "../services/orderWorkflowService.js";

const router = Router();
const restaurantRoles = new Set(["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER"]);

function canReadOrder(req, order) {
  if (!req.user) return false;
  if (restaurantRoles.has(req.user.role)) return req.user.role === "SUPER_ADMIN" || req.user.restaurantId === order.restaurantId;
  if (req.user.role === "CUSTOMER") return order.customer?.userId === req.user.id;
  if (req.user.role === "DRIVER") return order.delivery?.driver?.userId === req.user.id;
  return false;
}

function receiptFormatFor(req) {
  const requested = req.body?.format || req.query?.format || "80mm";
  return requested === "58mm" ? "58mm" : "80mm";
}

function receiptKindFor(req) {
  const requested = String(req.body?.kind || req.query?.kind || "customer").toLowerCase();
  if (["kitchen", "kitchen_ticket"].includes(requested)) return "kitchen";
  if (["driver", "driver_slip"].includes(requested)) return "driver";
  if (["guest", "guest_check"].includes(requested)) return "guest";
  return "customer";
}

function receiptReprintFor(req) {
  return req.body?.reprint === true || req.query?.reprint === "1" || req.query?.reprint === "true";
}

router.get("/:orderId/track", async (req, res, next) => {
  try {
    const order = await findOrderForTracking(req.params.orderId, req.query.token?.toString());
    if (!order) return res.status(403).json({ error: "Invalid or expired tracking token" });
    res.json({ order: limitedTrackingOrder(order) });
  } catch (error) {
    next(error);
  }
});

router.patch("/:orderId/tip", async (req, res, next) => {
  try {
    const order = await findOrderForTracking(req.params.orderId, req.query.token?.toString() || req.body.token);
    if (!order) return res.status(403).json({ error: "Invalid or expired tracking token" });
    await assertFeatureForRestaurant({ restaurantId: order.restaurantId, feature: FEATURE.ORDER_PAYMENTS, method: req.method });
    if (order.type === "DELIVERY") {
      await assertFeatureForRestaurant({ restaurantId: order.restaurantId, feature: FEATURE.DELIVERY, method: req.method });
    }
    if (["DELIVERED", "CANCELLED"].includes(order.status) || ["PAID", "REFUNDED"].includes(order.payment?.status)) {
      return res.status(409).json({ error: "Tips cannot be changed after final payment settlement in this workflow" });
    }
    const tipBreakdown = normalizeTipInput({ body: req.body, orderType: order.type, subtotalCents: order.subtotalCents });
    const nextTotal = Math.max(0, order.subtotalCents - (order.discountCents || 0)) + (order.deliveryFeeCents || 0) + (order.taxCents || 0) + tipBreakdown.tipCents;
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        ...tipBreakdown,
        tipUpdatedAt: new Date(),
        totalCents: nextTotal,
        payment: order.payment ? {
          update: {
            amountCents: nextTotal,
            driverTipCents: tipBreakdown.driverTipCents,
            restaurantNetCents: nextTotal - (order.payment.technologyFeeCents || 0) - tipBreakdown.driverTipCents
          }
        } : undefined
      },
      include: receiptOrderInclude()
    });
    await recordAudit({ restaurantId: order.restaurantId, action: "order.tip.updated", entityType: "Order", entityId: order.id, metadata: { source: "tracking_link" } });
    res.json({ order: limitedTrackingOrder(updated) });
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth);

router.get("/:orderId/receipt", async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId }, include: receiptOrderInclude() });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!canReadOrder(req, order)) return res.status(403).json({ error: "Order access denied" });
    const issued = await issueOrderTrackingToken(order.id);
    res.json({ receipt: buildReceiptPayload(issued.order, { kind: receiptKindFor(req), trackingToken: issued.trackingToken, format: receiptFormatFor(req), isReprint: receiptReprintFor(req) }) });
  } catch (error) {
    next(error);
  }
});

router.get("/:orderId/receipt/print", async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId }, include: receiptOrderInclude() });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!canReadOrder(req, order)) return res.status(403).json({ error: "Order access denied" });
    const kind = receiptKindFor(req);
    const format = receiptFormatFor(req);
    const isReprint = receiptReprintFor(req);
    const issued = await issueOrderTrackingToken(order.id);
    await recordAudit({ actorUserId: req.user.id, restaurantId: order.restaurantId, action: isReprint ? "receipt.reprinted" : "receipt.printed", entityType: "Order", entityId: order.id, metadata: { kind, format, isReprint } });
    res.json({ receipt: buildReceiptPayload(issued.order, { kind, trackingToken: issued.trackingToken, format, isReprint }) });
  } catch (error) {
    next(error);
  }
});

export default router;

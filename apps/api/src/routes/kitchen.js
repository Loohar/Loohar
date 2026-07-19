import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { FEATURE } from "../config/entitlements.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { featureGuard } from "../middleware/entitlements.js";
import { notifyOrderStatusUpdate } from "../services/notificationService.js";
import { emitKitchenUpdate, emitOrderUpdate } from "../services/realtimeService.js";

const router = Router();
const kitchenRoles = ["KITCHEN_STAFF", "CASHIER", "RESTAURANT_MANAGER", "RESTAURANT_ADMIN", "TENANT_OWNER", "SUPER_ADMIN"];
const activeOrderStatuses = ["PENDING", "ACCEPTED", "PREPARING", "READY"];
const kdsStatusToOrderStatus = {
  NEW: "PENDING",
  ACCEPTED: "ACCEPTED",
  PREPARING: "PREPARING",
  READY: "READY",
  COMPLETED: "DELIVERED"
};

router.use(requireAuth, requireRole(...kitchenRoles));
router.use(featureGuard(FEATURE.KITCHEN_DISPLAY));

function kdsStatusFor(orderStatus) {
  if (orderStatus === "PENDING") return "NEW";
  if (["ACCEPTED", "PREPARING", "READY"].includes(orderStatus)) return orderStatus;
  if (["PICKED_UP", "ON_THE_WAY", "DELIVERED"].includes(orderStatus)) return "COMPLETED";
  return orderStatus;
}

function kdsOrder(order) {
  const createdAt = new Date(order.createdAt);
  return {
    ...order,
    kdsStatus: kdsStatusFor(order.status),
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 1000))
  };
}

function includeKitchenOrder() {
  return {
    customer: true,
    items: true,
    delivery: { include: { driver: { include: { user: true } } } },
    statusHistory: { orderBy: { createdAt: "asc" } },
    restaurant: true
  };
}

async function resolveKitchenRestaurant(req, res) {
  if (req.params.restaurantSlug) {
    const restaurant = await prisma.restaurant.findFirst({ where: { OR: [{ slug: req.params.restaurantSlug }, { id: req.params.restaurantSlug }] } });
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant not found" });
      return null;
    }
    if (req.user.role !== "SUPER_ADMIN" && req.user.restaurantId !== restaurant.id) {
      res.status(403).json({ error: "Kitchen access denied" });
      return null;
    }
    return restaurant;
  }

  if (!req.user.restaurantId) {
    res.status(400).json({ error: "restaurantSlug is required for users without a restaurant assignment" });
    return null;
  }
  const restaurant = await prisma.restaurant.findUnique({ where: { id: req.user.restaurantId } });
  if (!restaurant) res.status(404).json({ error: "Restaurant not found" });
  return restaurant;
}

async function listKitchenOrders(req, res, next) {
  try {
    const restaurant = await resolveKitchenRestaurant(req, res);
    if (!restaurant) return;
    const orders = await prisma.order.findMany({
      where: { restaurantId: restaurant.id, status: { in: activeOrderStatuses } },
      include: includeKitchenOrder(),
      orderBy: { createdAt: "asc" }
    });
    res.json({ restaurant, orders: orders.map(kdsOrder) });
  } catch (error) {
    next(error);
  }
}

async function updateKitchenOrderStatus(req, res, next) {
  try {
    const restaurant = await resolveKitchenRestaurant(req, res);
    if (!restaurant) return;
    const requested = req.body.status;
    const status = kdsStatusToOrderStatus[requested] || requested;
    if (!Object.values(kdsStatusToOrderStatus).includes(status)) {
      return res.status(400).json({ error: "Invalid kitchen status" });
    }
    const order = await prisma.order.update({
      where: { id_restaurantId: { id: req.params.orderId, restaurantId: restaurant.id } },
      data: {
        status,
        statusHistory: { create: { status, note: req.body.note || `Kitchen marked ${requested}`, changedBy: req.user.id } }
      },
      include: includeKitchenOrder()
    });
    await Promise.allSettled([notifyOrderStatusUpdate({ order })]);
    emitOrderUpdate(order);
    emitKitchenUpdate(order);
    res.json({ order: kdsOrder(order) });
  } catch (error) {
    next(error);
  }
}

router.get("/orders", listKitchenOrders);
router.get("/:restaurantSlug/orders", listKitchenOrders);
router.patch("/orders/:orderId/status", updateKitchenOrderStatus);
router.patch("/:restaurantSlug/orders/:orderId/status", updateKitchenOrderStatus);

export default router;

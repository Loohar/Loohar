import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { FEATURE } from "../config/entitlements.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { featureGuard } from "../middleware/entitlements.js";
import { notifyOrderStatusUpdate } from "../services/notificationService.js";
import { emitKitchenUpdate, emitOrderUpdate, serializeKitchenOrder } from "../services/realtimeService.js";

const router = Router();
const kitchenRoles = ["KITCHEN_STAFF", "CASHIER", "RESTAURANT_MANAGER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "TENANT_OWNER", "SUPER_ADMIN"];
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
  const serialized = serializeKitchenOrder(order);
  const createdAt = new Date(serialized.createdAt);
  return {
    ...serialized,
    kdsStatus: kdsStatusFor(serialized.status),
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 1000))
  };
}

function includeKitchenOrder() {
  return {
    customer: true,
    location: true,
    items: true,
    delivery: { include: { driver: { include: { user: true } } } },
    statusHistory: { orderBy: { createdAt: "asc" } }
  };
}

async function resolveKitchenRestaurant(req, res) {
  if (req.params.restaurantSlug) {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ slug: req.params.restaurantSlug }, { id: req.params.restaurantSlug }] },
      select: { id: true, slug: true, name: true, businessName: true, status: true }
    });
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
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: req.user.restaurantId },
    select: { id: true, slug: true, name: true, businessName: true, status: true }
  });
  if (!restaurant) res.status(404).json({ error: "Restaurant not found" });
  return restaurant;
}

async function resolveKitchenLocations(req, res, restaurantId) {
  const locations = await prisma.restaurantLocation.findMany({
    where: { restaurantId, active: true },
    select: { id: true, name: true, address: true, timezone: true },
    orderBy: { createdAt: "asc" }
  });
  const requestedLocationId = req.query.locationId ? String(req.query.locationId) : null;
  if (requestedLocationId === "all") return { locations, selectedLocation: null };
  if (requestedLocationId) {
    const selectedLocation = locations.find((location) => location.id === requestedLocationId);
    if (!selectedLocation) {
      res.status(403).json({ error: "Kitchen location access denied", code: "KITCHEN_LOCATION_FORBIDDEN" });
      return null;
    }
    return { locations, selectedLocation };
  }
  return { locations, selectedLocation: locations[0] || null };
}

function parseSince(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function listKitchenOrders(req, res, next) {
  try {
    const queryStartedAt = new Date();
    const restaurant = await resolveKitchenRestaurant(req, res);
    if (!restaurant) return;
    const locationContext = await resolveKitchenLocations(req, res, restaurant.id);
    if (!locationContext) return;
    const since = parseSince(req.query.since);
    if (req.query.since && !since) return res.status(400).json({ error: "Invalid reconciliation cursor" });

    const where = {
      restaurantId: restaurant.id,
      ...(locationContext.selectedLocation ? { locationId: locationContext.selectedLocation.id } : {}),
      ...(since ? { updatedAt: { gt: since } } : { status: { in: activeOrderStatuses } })
    };
    const orders = await prisma.order.findMany({
      where,
      include: includeKitchenOrder(),
      orderBy: { updatedAt: "asc" },
      take: 250
    });
    res.json({
      restaurant,
      locations: locationContext.locations,
      selectedLocation: locationContext.selectedLocation,
      orders: orders.map(kdsOrder),
      cursor: queryStartedAt.toISOString(),
      reconciliation: Boolean(since)
    });
  } catch (error) {
    next(error);
  }
}

async function updateKitchenOrderStatus(req, res, next) {
  try {
    const restaurant = await resolveKitchenRestaurant(req, res);
    if (!restaurant) return;
    const locationContext = await resolveKitchenLocations(req, res, restaurant.id);
    if (!locationContext) return;
    const requested = req.body.status;
    const status = kdsStatusToOrderStatus[requested] || requested;
    if (!Object.values(kdsStatusToOrderStatus).includes(status)) {
      return res.status(400).json({ error: "Invalid kitchen status" });
    }

    const existing = await prisma.order.findFirst({
      where: {
        id: req.params.orderId,
        restaurantId: restaurant.id,
        ...(locationContext.selectedLocation ? { locationId: locationContext.selectedLocation.id } : {})
      },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ error: "Kitchen order not found" });

    const order = await prisma.order.update({
      where: { id_restaurantId: { id: existing.id, restaurantId: restaurant.id } },
      data: {
        status,
        statusHistory: { create: { status, note: req.body.note || `Kitchen marked ${requested}`, changedBy: req.user.id } }
      },
      include: includeKitchenOrder()
    });
    emitOrderUpdate(order);
    emitKitchenUpdate(order);
    await Promise.allSettled([notifyOrderStatusUpdate({ order })]);
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

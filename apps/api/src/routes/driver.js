import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { FEATURE } from "../config/entitlements.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { featureGuard } from "../middleware/entitlements.js";
import { getNavigationUrl, normalizeLocationUpdate } from "../services/mapsService.js";
import { emitDeliveryUpdate } from "../services/realtimeService.js";

const router = Router();
router.use(requireAuth, requireRole("DRIVER"));
router.use(featureGuard(FEATURE.DRIVER_MANAGEMENT));
const deliveryStatuses = ["ACCEPTED", "ARRIVED_AT_RESTAURANT", "PICKED_UP", "ON_THE_WAY", "ARRIVED_AT_CUSTOMER", "DELIVERED", "ISSUE_REPORTED"];
const statusTransitions = {
  ASSIGNED: ["ACCEPTED"],
  ACCEPTED: ["ARRIVED_AT_RESTAURANT", "PICKED_UP", "ISSUE_REPORTED"],
  ARRIVED_AT_RESTAURANT: ["PICKED_UP", "ISSUE_REPORTED"],
  PICKED_UP: ["ON_THE_WAY", "ISSUE_REPORTED"],
  ON_THE_WAY: ["ARRIVED_AT_CUSTOMER", "DELIVERED", "ISSUE_REPORTED"],
  ARRIVED_AT_CUSTOMER: ["DELIVERED", "ISSUE_REPORTED"],
  ISSUE_REPORTED: ["ARRIVED_AT_RESTAURANT", "PICKED_UP", "ON_THE_WAY", "ARRIVED_AT_CUSTOMER", "DELIVERED"],
  DELIVERED: [],
  CANCELLED: []
};
const orderStatusForDeliveryStatus = {
  PICKED_UP: "PICKED_UP",
  ON_THE_WAY: "ON_THE_WAY",
  ARRIVED_AT_CUSTOMER: "ON_THE_WAY",
  DELIVERED: "DELIVERED"
};

async function currentDriver(req) {
  return prisma.driver.findUnique({ where: { userId: req.user.id }, include: { user: true } });
}

async function requireCurrentDriver(req, res) {
  const driver = await currentDriver(req);
  if (!driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return null;
  }
  return driver;
}

function includeDeliveryDetails() {
  return { order: { include: { customer: true, restaurant: true, items: true } }, statusHistory: true };
}

function timestampDataFor(status) {
  if (status === "ACCEPTED") return { claimedAt: new Date() };
  if (status === "PICKED_UP") return { pickedUpAt: new Date() };
  if (status === "DELIVERED") return { deliveredAt: new Date() };
  return {};
}

function assertTransition(delivery, nextStatus) {
  if (!deliveryStatuses.includes(nextStatus)) {
    const error = new Error("Invalid delivery status");
    error.status = 400;
    throw error;
  }
  const allowed = statusTransitions[delivery.status] || [];
  if (delivery.status !== nextStatus && !allowed.includes(nextStatus)) {
    const error = new Error(`Delivery cannot move from ${delivery.status} to ${nextStatus}`);
    error.status = 409;
    throw error;
  }
}

function conflictError(message, code) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  return error;
}

async function updateOwnedDeliveryStatus({ delivery, status, userId, note }) {
  assertTransition(delivery, status);
  return prisma.$transaction(async (tx) => {
    // The transition was validated against the status we read; apply it only if that is still current.
    const moved = await tx.delivery.updateMany({
      where: { id: delivery.id, driverId: delivery.driverId, status: delivery.status },
      data: { status, ...timestampDataFor(status) }
    });
    if (moved.count === 0) throw conflictError("Delivery status changed; refresh and try again.", "DELIVERY_STATUS_CONFLICT");
    await tx.deliveryStatusHistory.create({ data: { deliveryId: delivery.id, status, note, changedBy: userId } });
    if (orderStatusForDeliveryStatus[status]) {
      // A restaurant-cancelled or rejected order is never revived by a driver update.
      const orderMoved = await tx.order.updateMany({
        where: { id: delivery.orderId, status: { notIn: ["CANCELLED", "REJECTED"] } },
        data: { status: orderStatusForDeliveryStatus[status] }
      });
      if (orderMoved.count === 0) throw conflictError("This order was cancelled by the restaurant.", "DELIVERY_ORDER_CLOSED");
      await tx.orderStatusHistory.create({
        data: { orderId: delivery.orderId, status: orderStatusForDeliveryStatus[status], note: `Driver marked delivery ${status}`, changedBy: userId }
      });
    }
    return tx.delivery.findUnique({ where: { id: delivery.id }, include: includeDeliveryDetails() });
  });
}

// Base delivery pay is set by the restaurant, never by the claiming driver.
const DEFAULT_DELIVERY_BASE_EARNINGS_CENTS = 500;
const UNCLAIMABLE_ORDER_STATUSES = new Set(["REJECTED", "DELIVERED", "CANCELLED"]);
// Unowned deliveries can be claimed only before pickup work starts, so a claim never rewinds one.
const CLAIMABLE_DELIVERY_STATUSES = ["ASSIGNED", "ACCEPTED"];

async function claimDeliveryForDriver({ order, driver, userId }) {
  const history = { status: "ACCEPTED", note: "Driver claimed delivery from QR", changedBy: userId };
  if (!order.delivery) {
    try {
      return await prisma.delivery.create({
        data: {
          restaurantId: order.restaurantId,
          orderId: order.id,
          driverId: driver.id,
          status: "ACCEPTED",
          claimedAt: new Date(),
          baseEarningsCents: DEFAULT_DELIVERY_BASE_EARNINGS_CENTS,
          tipCents: order.driverTipCents ?? order.tipCents ?? 0,
          pickupAddress: order.restaurant.address || "Restaurant pickup",
          dropoffAddress: order.deliveryAddress || "Customer dropoff",
          statusHistory: { create: history }
        },
        include: includeDeliveryDetails()
      });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      // Another claim created the delivery first; fall through to the conditional claim.
    }
  }
  const claimed = await prisma.delivery.updateMany({
    where: { orderId: order.id, driverId: null, status: { in: CLAIMABLE_DELIVERY_STATUSES } },
    data: { driverId: driver.id, status: "ACCEPTED", claimedAt: new Date(), tipCents: order.driverTipCents ?? order.tipCents ?? 0 }
  });
  const current = await prisma.delivery.findUnique({ where: { orderId: order.id } });
  if (claimed.count === 1) {
    await prisma.deliveryStatusHistory.create({ data: { deliveryId: current.id, ...history } });
  } else if (current?.driverId !== driver.id) {
    throw conflictError("Delivery is already claimed by another driver", "DELIVERY_ALREADY_CLAIMED");
  } else if (current.status === "ASSIGNED") {
    const accepted = await prisma.delivery.updateMany({
      where: { id: current.id, driverId: driver.id, status: "ASSIGNED" },
      data: { status: "ACCEPTED", claimedAt: new Date() }
    });
    if (accepted.count === 1) await prisma.deliveryStatusHistory.create({ data: { deliveryId: current.id, ...history } });
  }
  return prisma.delivery.findUnique({ where: { orderId: order.id }, include: includeDeliveryDetails() });
}

router.get("/me", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    res.json({
      driver: {
        id: driver.id,
        available: driver.available,
        currentLat: driver.currentLat,
        currentLng: driver.currentLng,
        restaurantId: driver.restaurantId,
        user: driver.user
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/deliveries", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const deliveries = await prisma.delivery.findMany({
      where: { driverId: driver.id, status: { not: "DELIVERED" } },
      include: includeDeliveryDetails(),
      orderBy: { createdAt: "desc" }
    });
    res.json({ deliveries });
  } catch (error) {
    next(error);
  }
});

router.get("/deliveries/:deliveryId", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.deliveryId, driverId: driver.id },
      include: includeDeliveryDetails()
    });
    if (!delivery) return res.status(403).json({ error: "Delivery not found or not assigned to this driver" });
    res.json({
      delivery,
      navigation: {
        pickup: getNavigationUrl(delivery.pickupAddress),
        dropoff: getNavigationUrl(delivery.dropoffAddress)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/deliveries/:deliveryId/accept", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const existing = await prisma.delivery.findFirst({
      where: { id: req.params.deliveryId, driverId: driver.id },
      include: includeDeliveryDetails()
    });
    if (!existing) return res.status(403).json({ error: "Delivery not found or not assigned to this driver" });
    const delivery = await updateOwnedDeliveryStatus({ delivery: existing, status: "ACCEPTED", userId: req.user.id });
    emitDeliveryUpdate(delivery);
    res.json({ delivery });
  } catch (error) {
    next(error);
  }
});

router.patch("/deliveries/:deliveryId/status", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    if (!deliveryStatuses.includes(req.body.status)) {
      return res.status(400).json({ error: "Invalid delivery status" });
    }
    const existing = await prisma.delivery.findFirst({
      where: { id: req.params.deliveryId, driverId: driver.id },
      include: includeDeliveryDetails()
    });
    if (!existing) return res.status(403).json({ error: "Delivery not found or not assigned to this driver" });
    const delivery = await updateOwnedDeliveryStatus({ delivery: existing, status: req.body.status, userId: req.user.id, note: req.body.note });
    emitDeliveryUpdate(delivery);
    res.json({ delivery });
  } catch (error) {
    next(error);
  }
});

router.get("/orders/:orderId", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: { customer: true, restaurant: true, items: true, delivery: { include: { driver: { include: { user: true } }, statusHistory: true } } }
    });
    if (!order || order.restaurantId !== driver.restaurantId || order.type !== "DELIVERY") {
      return res.status(404).json({ error: "Delivery order not found for this driver fleet" });
    }
    if (order.delivery?.driverId && order.delivery.driverId !== driver.id) {
      return res.status(403).json({ error: "Delivery is already assigned to another driver" });
    }
    res.json({ order, delivery: order.delivery, claimable: !order.delivery?.driverId || order.delivery.driverId === driver.id });
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:orderId/claim", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId }, include: { customer: true, restaurant: true, delivery: true } });
    if (!order || order.restaurantId !== driver.restaurantId || order.type !== "DELIVERY") {
      return res.status(404).json({ error: "Delivery order not found for this driver fleet" });
    }
    if (order.delivery?.driverId && order.delivery.driverId !== driver.id) {
      return res.status(409).json({ error: "Delivery is already claimed by another driver" });
    }
    if (UNCLAIMABLE_ORDER_STATUSES.has(order.status)) {
      return res.status(409).json({ error: "This order can no longer be claimed", code: "DELIVERY_ORDER_NOT_CLAIMABLE" });
    }
    const delivery = await claimDeliveryForDriver({ order, driver, userId: req.user.id });
    emitDeliveryUpdate(delivery);
    res.json({ delivery });
  } catch (error) {
    next(error);
  }
});

router.patch("/orders/:orderId/status", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const delivery = await prisma.delivery.findFirst({
      where: { orderId: req.params.orderId, driverId: driver.id },
      include: includeDeliveryDetails()
    });
    if (!delivery) return res.status(403).json({ error: "Delivery not found or not assigned to this driver" });
    const updated = await updateOwnedDeliveryStatus({ delivery, status: req.body.status, userId: req.user.id, note: req.body.note });
    emitDeliveryUpdate(updated);
    res.json({ delivery: updated });
  } catch (error) {
    next(error);
  }
});

router.patch("/availability", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const updated = await prisma.driver.update({ where: { id: driver.id }, data: { available: Boolean(req.body.available) } });
    res.json({ driver: updated });
  } catch (error) {
    next(error);
  }
});

router.patch("/location", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const location = normalizeLocationUpdate(req.body);
    const updated = await prisma.driver.update({ where: { id: driver.id }, data: { currentLat: location.lat, currentLng: location.lng } });
    res.json({ driver: updated, location });
  } catch (error) {
    next(error);
  }
});

router.get("/earnings", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const totals = await prisma.delivery.aggregate({
      where: { driverId: driver.id, status: "DELIVERED" },
      _sum: { baseEarningsCents: true, tipCents: true },
      _count: true
    });
    const deliveryFeesCents = totals._sum.baseEarningsCents || 0;
    const tipsCents = totals._sum.tipCents || 0;
    res.json({
      completedDeliveryCount: totals._count,
      deliveryFeeCents: deliveryFeesCents,
      tipsCents,
      totalEarningsCents: deliveryFeesCents + tipsCents,
      deliveries: totals._count,
      earnings: deliveryFeesCents,
      tips: tipsCents
    });
  } catch (error) {
    next(error);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    const driver = await requireCurrentDriver(req, res);
    if (!driver) return;
    const deliveries = await prisma.delivery.findMany({
      where: { driverId: driver.id, status: "DELIVERED" },
      include: includeDeliveryDetails(),
      orderBy: { updatedAt: "desc" },
      take: 50
    });
    res.json({ deliveries });
  } catch (error) {
    next(error);
  }
});

export default router;

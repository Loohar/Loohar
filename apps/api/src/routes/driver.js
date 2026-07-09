import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getNavigationUrl, normalizeLocationUpdate } from "../services/mapsService.js";
import { emitDeliveryUpdate } from "../services/realtimeService.js";

const router = Router();
router.use(requireAuth, requireRole("DRIVER"));
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

async function updateOwnedDeliveryStatus({ delivery, status, userId, note }) {
  assertTransition(delivery, status);
  return prisma.delivery.update({
    where: { id_driverId: { id: delivery.id, driverId: delivery.driverId } },
    data: {
      status,
      ...timestampDataFor(status),
      statusHistory: { create: { status, note, changedBy: userId } },
      ...(orderStatusForDeliveryStatus[status] ? {
        order: {
          update: {
            status: orderStatusForDeliveryStatus[status],
            statusHistory: { create: { status: orderStatusForDeliveryStatus[status], note: `Driver marked delivery ${status}`, changedBy: userId } }
          }
        }
      } : {})
    },
    include: includeDeliveryDetails()
  });
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
    const delivery = await prisma.delivery.upsert({
      where: { orderId: order.id },
      create: {
        restaurantId: order.restaurantId,
        orderId: order.id,
        driverId: driver.id,
        status: "ACCEPTED",
        claimedAt: new Date(),
        baseEarningsCents: Number(req.body.baseEarningsCents || 500),
        tipCents: order.driverTipCents ?? order.tipCents ?? 0,
        pickupAddress: order.restaurant.address || "Restaurant pickup",
        dropoffAddress: order.deliveryAddress || "Customer dropoff",
        statusHistory: { create: { status: "ACCEPTED", note: "Driver claimed delivery from QR", changedBy: req.user.id } }
      },
      update: {
        driverId: driver.id,
        status: "ACCEPTED",
        claimedAt: new Date(),
        tipCents: order.driverTipCents ?? order.tipCents ?? 0,
        statusHistory: { create: { status: "ACCEPTED", note: "Driver claimed delivery from QR", changedBy: req.user.id } }
      },
      include: includeDeliveryDetails()
    });
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

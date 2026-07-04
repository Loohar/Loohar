import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getNavigationUrl, normalizeLocationUpdate } from "../services/mapsService.js";
import { emitDeliveryUpdate } from "../services/realtimeService.js";

const router = Router();
router.use(requireAuth, requireRole("DRIVER"));
const deliveryStatuses = ["ACCEPTED", "ARRIVED_AT_RESTAURANT", "PICKED_UP", "ON_THE_WAY", "DELIVERED"];

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
    const delivery = await prisma.delivery.update({
      where: { id_driverId: { id: req.params.deliveryId, driverId: driver.id } },
      data: { status: "ACCEPTED", statusHistory: { create: { status: "ACCEPTED", changedBy: req.user.id } } },
      include: includeDeliveryDetails()
    });
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
    const delivery = await prisma.delivery.update({
      where: { id_driverId: { id: req.params.deliveryId, driverId: driver.id } },
      data: { status: req.body.status, statusHistory: { create: { status: req.body.status, note: req.body.note, changedBy: req.user.id } } },
      include: includeDeliveryDetails()
    });
    emitDeliveryUpdate(delivery);
    res.json({ delivery });
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

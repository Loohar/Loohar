import express from "express";
import rateLimit from "express-rate-limit";
import { FEATURE } from "../config/entitlements.js";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { featureGuard } from "../middleware/entitlements.js";
import {
  cardPaymentIntent,
  cashPayment,
  closeShift,
  createPosQuote,
  currentShift,
  exitKioskMode,
  holdPosOrder,
  httpError,
  openShift,
  posConfig,
  posMenu,
  registerPosDevice,
  resolveRestaurantForPos,
  setKioskMode,
  submitPosOrder,
  updatePosDevice
} from "../services/posService.js";

const router = express.Router();

const kioskExitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many kiosk exit attempts. Please wait before trying again." }
});

function deviceContext(req) {
  return {
    deviceId: req.get("x-loohar-device-id") || req.body?.deviceId || req.query?.deviceId || null,
    fingerprint: req.get("x-loohar-device-fingerprint") || req.body?.deviceFingerprint || null
  };
}

async function resolvePosContext(req, res, next) {
  try {
    const restaurant = await resolveRestaurantForPos(req.params.restaurantId, req.user);
    req.posRestaurant = restaurant;
    req.resolvedRestaurantId = restaurant.id;
    next();
  } catch (error) {
    next(error);
  }
}

router.use("/:restaurantId/pos", requireAuth, resolvePosContext, featureGuard(FEATURE.POS_REGISTER, {
  allowSuperAdmin: false,
  restaurantId: (req) => req.resolvedRestaurantId
}));

router.get("/:restaurantId/pos/config", async (req, res, next) => {
  try {
    const config = await posConfig({ restaurant: req.posRestaurant, user: req.user, ...deviceContext(req) });
    res.json(config);
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/menu", async (req, res, next) => {
  try {
    const categories = await posMenu(req.resolvedRestaurantId);
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/quotes", async (req, res, next) => {
  try {
    const quote = await createPosQuote({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      body: req.body,
      deviceId: deviceContext(req).deviceId || null,
      sessionId: req.body?.sessionId || null
    });
    res.status(201).json({ quote });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/orders", async (req, res, next) => {
  try {
    const { quoteId, sessionId, customer, notes } = req.body || {};
    if (!quoteId) throw httpError("quoteId is required.", 400);
    const result = await submitPosOrder({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      quoteId,
      sessionId: sessionId || null,
      customerJson: customer || {},
      notes,
      deviceId: deviceContext(req).deviceId || null
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/held-orders", async (req, res, next) => {
  try {
    const heldOrders = await prisma.posOrderSession.findMany({
      where: { restaurantId: req.resolvedRestaurantId, status: "HELD" },
      orderBy: { updatedAt: "desc" },
      take: 50
    });
    res.json({ heldOrders });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/held-orders", async (req, res, next) => {
  try {
    const session = await holdPosOrder({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      body: req.body,
      deviceId: deviceContext(req).deviceId || null
    });
    res.status(201).json({ session });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/held-orders/:sessionId/recall", async (req, res, next) => {
  try {
    const session = await prisma.posOrderSession.findFirst({
      where: { id: req.params.sessionId, restaurantId: req.resolvedRestaurantId, status: "HELD" }
    });
    if (!session) throw httpError("Held POS order not found.", 404);
    res.json({ session });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/held-orders/:sessionId/submit", async (req, res, next) => {
  try {
    const session = await prisma.posOrderSession.findFirst({
      where: { id: req.params.sessionId, restaurantId: req.resolvedRestaurantId, status: "HELD" }
    });
    if (!session) throw httpError("Held POS order not found.", 404);
    const quote = await createPosQuote({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      body: {
        ...(session.cartJson || {}),
        orderType: session.orderType,
        locationId: session.locationId
      },
      deviceId: session.deviceId || deviceContext(req).deviceId || null,
      sessionId: session.id
    });
    const result = await submitPosOrder({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      quoteId: quote.id,
      sessionId: session.id,
      customerJson: session.customerJson || {},
      notes: req.body?.notes,
      deviceId: session.deviceId || deviceContext(req).deviceId || null
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/payments/cash", async (req, res, next) => {
  try {
    const result = await cashPayment({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      orderId: req.body?.orderId,
      amountCents: req.body?.amountCents ?? null,
      ...deviceContext(req)
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/payments/card", async (req, res, next) => {
  try {
    const result = await cardPaymentIntent({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      orderId: req.body?.orderId,
      ...deviceContext(req)
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/devices", async (req, res, next) => {
  try {
    const devices = await prisma.posDevice.findMany({
      where: { restaurantId: req.resolvedRestaurantId },
      orderBy: { updatedAt: "desc" }
    });
    res.json({ devices });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/devices", async (req, res, next) => {
  try {
    const device = await registerPosDevice({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      body: req.body,
      fingerprint: deviceContext(req).fingerprint
    });
    res.status(201).json({ device });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/pos/devices/:deviceId", async (req, res, next) => {
  try {
    const device = await updatePosDevice({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      deviceId: req.params.deviceId,
      body: req.body
    });
    res.json({ device });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/devices/:deviceId/kiosk", async (req, res, next) => {
  try {
    const device = await setKioskMode({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      deviceId: req.params.deviceId,
      enabled: req.body?.enabled !== false,
      exitPin: req.body?.exitPin || null
    });
    res.json({ device });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/devices/:deviceId/kiosk/exit", kioskExitLimiter, async (req, res, next) => {
  try {
    const device = await exitKioskMode({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      deviceId: req.params.deviceId,
      pin: req.body?.pin || null
    });
    res.json({ device });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/shifts/current", async (req, res, next) => {
  try {
    const shift = await currentShift({
      restaurantId: req.resolvedRestaurantId,
      userId: req.user.id,
      deviceId: deviceContext(req).deviceId || null
    });
    res.json({ shift });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/shifts/clock-in", async (req, res, next) => {
  try {
    const shift = await openShift({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      body: req.body,
      deviceId: deviceContext(req).deviceId || null
    });
    res.status(201).json({ shift });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/shifts/:shiftId/clock-out", async (req, res, next) => {
  try {
    const shift = await closeShift({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      shiftId: req.params.shiftId,
      body: req.body
    });
    res.json({ shift });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/orders/:orderId/receipt", async (req, res, next) => {
  try {
    const receipt = await prisma.posReceipt.findFirst({
      where: { restaurantId: req.resolvedRestaurantId, orderId: req.params.orderId },
      orderBy: { createdAt: "desc" }
    });
    if (!receipt) throw httpError("POS receipt not found.", 404);
    res.json({ receipt });
  } catch (error) {
    next(error);
  }
});

export default router;

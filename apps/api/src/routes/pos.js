import express from "express";
import rateLimit from "express-rate-limit";
import { FEATURE } from "../config/entitlements.js";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { featureGuard } from "../middleware/entitlements.js";
import { requirePosSession } from "../middleware/posSession.js";
import {
  cardPaymentIntent,
  cashierPinStatus,
  cashPayment,
  closeShift,
  createPosQuote,
  currentShift,
  exitKioskMode,
  holdPosOrder,
  httpError,
  listPosOrders,
  openShift,
  posConfig,
  posMenu,
  posMenuAvailabilityDiagnostics,
  registerPosDevice,
  resolveRestaurantForPos,
  setKioskMode,
  setCashierPin,
  submitPosOrder,
  unlockPosDevice,
  updatePosDevice
} from "../services/posService.js";

const router = express.Router();

const kioskExitLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many kiosk exit attempts. Please wait before trying again.", code: "RATE_LIMITED" }
});

const posReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "POS is receiving too many requests. Please wait a moment and try again.",
    code: "RATE_LIMITED"
  }
});

const posPinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many POS PIN attempts. Please wait before trying again.", code: "RATE_LIMITED" }
});

function deviceContext(req) {
  return {
    deviceId: req.get("x-loohar-device-id") || req.body?.deviceId || req.query?.deviceId || null,
    fingerprint: req.get("x-loohar-device-fingerprint") || req.body?.deviceFingerprint || null
  };
}

function summarizePosMenu(categories = []) {
  const items = categories.flatMap((category) => category.items || []);
  const latestUpdatedAt = [categories, items]
    .flat()
    .map((record) => record?.updatedAt || record?.createdAt)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0] || 0;
  const availableItems = items.filter((item) => item.available !== false).length;

  return {
    categoryCount: categories.length,
    itemCount: items.length,
    availableItems,
    menuVersion: `${categories.length}:${items.length}:${latestUpdatedAt}`
  };
}

function posEntitlementPayload(req) {
  if (!req.entitlements) return null;
  return {
    planCode: req.entitlements.planCode,
    subscriptionStatus: req.entitlements.subscriptionStatus,
    subscriptionSource: req.entitlements.subscriptionSource,
    fullAccess: Boolean(req.entitlements.fullAccess),
    simulation: req.entitlements.simulation || null
  };
}

async function buildPosMenuPayload(req, categories, requestId = req.get("x-loohar-pos-request-id") || null) {
  const summary = summarizePosMenu(categories);
  const menuDiagnostics = await posMenuAvailabilityDiagnostics(req.resolvedRestaurantId, categories);
  return {
    requestId,
    generatedAt: new Date().toISOString(),
    tenantId: req.resolvedRestaurantId,
    restaurantId: req.resolvedRestaurantId,
    restaurantSlug: req.posRestaurant.slug,
    locationId: req.posRestaurant.locations?.[0]?.id || null,
    timezone: req.posRestaurant.timezone || "America/Denver",
    menuVersion: summary.menuVersion,
    availabilitySummary: {
      categories: summary.categoryCount,
      items: summary.itemCount,
      availableItems: summary.availableItems,
      visibleItems: menuDiagnostics.visibleItems,
      totalItems: menuDiagnostics.totalItems,
      availableItemsTotal: menuDiagnostics.availableItemsTotal
    },
    menuDiagnostics,
    entitlement: posEntitlementPayload(req),
    categories
  };
}

async function findHeldOrders(restaurantId, locationId = null) {
  return prisma.posOrderSession.findMany({
    where: { restaurantId, status: "HELD", ...(locationId ? { locationId } : { locationId: null }) },
    orderBy: { updatedAt: "desc" },
    take: 50
  });
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

router.get("/:restaurantId/pos/bootstrap", posReadLimiter, async (req, res, next) => {
  const startedAt = Date.now();
  const requestId = req.get("x-loohar-pos-request-id") || `pos:${Date.now()}`;
  try {
    const [config, categories] = await Promise.all([
      posConfig({ restaurant: req.posRestaurant, user: req.user, ...deviceContext(req) }),
      posMenu(req.resolvedRestaurantId)
    ]);
    res.json({
      requestId,
      generatedAt: new Date().toISOString(),
      performance: { serverDurationMs: Date.now() - startedAt },
      config,
      menu: await buildPosMenuPayload(req, categories, requestId)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/config", posReadLimiter, async (req, res, next) => {
  try {
    const config = await posConfig({ restaurant: req.posRestaurant, user: req.user, ...deviceContext(req) });
    res.json(config);
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/pin", posReadLimiter, async (req, res, next) => {
  try {
    const pinStatus = await cashierPinStatus({ restaurantId: req.resolvedRestaurantId, user: req.user });
    res.json({ pinStatus });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/pos/pin", posPinLimiter, async (req, res, next) => {
  try {
    const pinStatus = await setCashierPin({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      pin: req.body?.pin
    });
    res.json({ pinStatus });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/unlock", posPinLimiter, async (req, res, next) => {
  try {
    const result = await unlockPosDevice({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      pin: req.body?.pin,
      ...deviceContext(req),
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/menu", posReadLimiter, async (req, res, next) => {
  try {
    const categories = await posMenu(req.resolvedRestaurantId);
    res.json(await buildPosMenuPayload(req, categories));
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/quotes", requirePosSession, async (req, res, next) => {
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

router.post("/:restaurantId/pos/orders", requirePosSession, async (req, res, next) => {
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
      deviceId: deviceContext(req).deviceId || null,
      entitlementVerified: Boolean(req.entitlementDecision?.allowed)
    });
    if (result.performance) {
      res.setHeader("Server-Timing", [
        `pos-order-db;dur=${result.performance.dbTransactionMs}`,
        `pos-kds;dur=${result.performance.kdsMs}`,
        `pos-order-total;dur=${result.performance.serviceTotalMs}`
      ].join(", "));
    }
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/held-orders", posReadLimiter, requirePosSession, async (req, res, next) => {
  try {
    const config = await posConfig({ restaurant: req.posRestaurant, user: req.user, ...deviceContext(req) });
    const heldOrders = await findHeldOrders(req.resolvedRestaurantId, config.device?.locationId || config.locations?.[0]?.id || null);
    res.json({ heldOrders });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/open-orders", posReadLimiter, requirePosSession, async (req, res, next) => {
  try {
    res.json(await listPosOrders({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      ...deviceContext(req),
      recent: false
    }));
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/pos/recent-orders", posReadLimiter, requirePosSession, async (req, res, next) => {
  try {
    res.json(await listPosOrders({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      ...deviceContext(req),
      recent: true
    }));
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/held-orders", requirePosSession, async (req, res, next) => {
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

router.post("/:restaurantId/pos/held-orders/:sessionId/recall", requirePosSession, async (req, res, next) => {
  try {
    const config = await posConfig({ restaurant: req.posRestaurant, user: req.user, ...deviceContext(req) });
    const locationId = config.device?.locationId || config.locations?.[0]?.id || null;
    const session = await prisma.posOrderSession.findFirst({
      where: {
        id: req.params.sessionId,
        restaurantId: req.resolvedRestaurantId,
        status: "HELD",
        ...(locationId ? { locationId } : { locationId: null })
      }
    });
    if (!session) throw httpError("Held POS order not found.", 404);
    res.json({ session });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/held-orders/:sessionId/submit", requirePosSession, async (req, res, next) => {
  try {
    const config = await posConfig({ restaurant: req.posRestaurant, user: req.user, ...deviceContext(req) });
    const locationId = config.device?.locationId || config.locations?.[0]?.id || null;
    const session = await prisma.posOrderSession.findFirst({
      where: {
        id: req.params.sessionId,
        restaurantId: req.resolvedRestaurantId,
        status: "HELD",
        ...(locationId ? { locationId } : { locationId: null })
      }
    });
    if (!session) throw httpError("Held POS order not found.", 404);
    const quote = await createPosQuote({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      body: {
        ...(session.cartJson || {}),
        orderType: session.orderType,
        locationId: session.locationId,
        deliveryZoneId: session.customerJson?.deliveryZoneId || null
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
      deviceId: session.deviceId || deviceContext(req).deviceId || null,
      entitlementVerified: Boolean(req.entitlementDecision?.allowed)
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/payments/cash", requirePosSession, async (req, res, next) => {
  try {
    const result = await cashPayment({
      restaurantId: req.resolvedRestaurantId,
      user: req.user,
      orderId: req.body?.orderId,
      amountCents: req.body?.amountCents ?? null,
      entitlementVerified: Boolean(req.entitlementDecision?.allowed),
      sessionDevice: req.posSessionDevice,
      ...deviceContext(req)
    });
    if (result.performance) {
      res.setHeader("Server-Timing", [
        `pos-access;dur=${result.performance.accessAndOrderMs}`,
        `pos-db;dur=${result.performance.dbTransactionMs}`,
        `pos-receipt;dur=${result.performance.receiptMs}`,
        `pos-total;dur=${result.performance.serviceTotalMs}`
      ].join(", "));
    }
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/pos/payments/card", requirePosSession, async (req, res, next) => {
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

router.get("/:restaurantId/pos/devices", posReadLimiter, async (req, res, next) => {
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

router.post("/:restaurantId/pos/devices/:deviceId/kiosk", requirePosSession, async (req, res, next) => {
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

router.post("/:restaurantId/pos/devices/:deviceId/kiosk/exit", kioskExitLimiter, requirePosSession, async (req, res, next) => {
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

router.get("/:restaurantId/pos/shifts/current", posReadLimiter, requirePosSession, async (req, res, next) => {
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

router.post("/:restaurantId/pos/shifts/clock-in", requirePosSession, async (req, res, next) => {
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

router.post("/:restaurantId/pos/shifts/:shiftId/clock-out", requirePosSession, async (req, res, next) => {
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

router.get("/:restaurantId/pos/orders/:orderId/receipt", posReadLimiter, requirePosSession, async (req, res, next) => {
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

import express from "express";
import { PLAN_CODES, normalizePlanCode, normalizeSubscriptionStatus, planMatrixRows } from "../config/entitlements.js";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { loadRestaurantEntitlements } from "../middleware/entitlements.js";

const router = express.Router();

const simulationModes = new Set([
  "FULL_ACCESS",
  "SIMULATE_PLAN",
  "SIMULATE_SUSPENDED",
  "SIMULATE_EXPIRED_TRIAL",
  "SIMULATE_PAST_DUE",
  "SIMULATE_CANCELLED"
]);
const simulatorRoles = new Set(["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"]);
const internalTenantClassifications = new Set(["INTERNAL_DEVELOPMENT", "PRIVATE_BETA"]);

function canManageSimulation(user, restaurant) {
  if (!user || !simulatorRoles.has(user.role)) return false;
  if (user.role === "SUPER_ADMIN") return true;
  return user.restaurantId === restaurant.id;
}

async function resolveRestaurant(req, res, next) {
  try {
    const identifier = req.params.restaurantId;
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: identifier }, { slug: identifier }] },
      select: {
        id: true,
        slug: true,
        name: true,
        businessName: true,
        status: true,
        tenantClassification: true,
        entitlementSimulation: true
      }
    });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found.", code: "RESTAURANT_NOT_FOUND" });
    if (!canManageSimulation(req.user, restaurant)) return res.status(403).json({ error: "Tenant access denied.", code: "TENANT_ACCESS_DENIED" });
    req.simulationRestaurant = restaurant;
    next();
  } catch (error) {
    next(error);
  }
}

function requireInternalTenant(req, res, next) {
  if (!internalTenantClassifications.has(req.simulationRestaurant.tenantClassification)) {
    return res.status(403).json({
      error: "Entitlement simulation is available only for internal development or private beta tenants.",
      code: "ENTITLEMENT_SIMULATION_NOT_AVAILABLE"
    });
  }
  next();
}

function simulationPayload(simulation) {
  if (!simulation) {
    return {
      enabled: true,
      mode: "FULL_ACCESS",
      simulatedPlan: "ENTERPRISE",
      simulatedSubscriptionStatus: "ACTIVE",
      expiresAt: null,
      active: true,
      source: "INTERNAL_FULL_ACCESS_DEFAULT"
    };
  }
  return {
    enabled: Boolean(simulation.enabled),
    mode: simulation.mode,
    simulatedPlan: simulation.simulatedPlan || null,
    simulatedSubscriptionStatus: simulation.simulatedSubscriptionStatus || null,
    expiresAt: simulation.expiresAt || null,
    active: Boolean(simulation.enabled && (!simulation.expiresAt || new Date(simulation.expiresAt).getTime() > Date.now())),
    source: "DATABASE"
  };
}

router.use("/:restaurantId/entitlements/simulation", requireAuth, resolveRestaurant, requireInternalTenant);

router.get("/:restaurantId/entitlements/simulation", async (req, res, next) => {
  try {
    const entitlements = await loadRestaurantEntitlements(req.simulationRestaurant.id, req);
    res.json({
      restaurant: {
        id: req.simulationRestaurant.id,
        slug: req.simulationRestaurant.slug,
        name: req.simulationRestaurant.businessName || req.simulationRestaurant.name,
        status: req.simulationRestaurant.status,
        tenantClassification: req.simulationRestaurant.tenantClassification
      },
      entitlements,
      simulation: simulationPayload(req.simulationRestaurant.entitlementSimulation),
      planMatrix: planMatrixRows()
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/entitlements/simulation", async (req, res, next) => {
  try {
    const current = req.simulationRestaurant.entitlementSimulation || null;
    const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : true;
    const mode = String(req.body?.mode || current?.mode || "FULL_ACCESS").toUpperCase();
    if (!simulationModes.has(mode)) {
      return res.status(400).json({ error: "Invalid entitlement simulation mode.", code: "INVALID_SIMULATION_MODE" });
    }
    const simulatedPlan = req.body?.simulatedPlan ? normalizePlanCode(req.body.simulatedPlan) : mode === "FULL_ACCESS" ? "ENTERPRISE" : current?.simulatedPlan || "STARTER";
    if (!PLAN_CODES.includes(simulatedPlan)) {
      return res.status(400).json({ error: "Invalid simulated plan.", code: "INVALID_SIMULATED_PLAN" });
    }
    const simulatedSubscriptionStatus = req.body?.simulatedSubscriptionStatus
      ? normalizeSubscriptionStatus(req.body.simulatedSubscriptionStatus)
      : mode === "SIMULATE_SUSPENDED"
        ? "SUSPENDED"
        : mode === "SIMULATE_PAST_DUE"
          ? "PAST_DUE"
          : mode === "SIMULATE_CANCELLED" || mode === "SIMULATE_EXPIRED_TRIAL"
            ? "CANCELLED"
            : "ACTIVE";
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return res.status(400).json({ error: "Invalid simulation expiration date.", code: "INVALID_SIMULATION_EXPIRATION" });
    }

    const simulation = await prisma.tenantEntitlementSimulation.upsert({
      where: { tenantId: req.simulationRestaurant.id },
      create: {
        tenantId: req.simulationRestaurant.id,
        enabled,
        mode,
        simulatedPlan,
        simulatedSubscriptionStatus,
        expiresAt,
        createdByUserId: req.user.id,
        updatedByUserId: req.user.id
      },
      update: {
        enabled,
        mode,
        simulatedPlan,
        simulatedSubscriptionStatus,
        expiresAt,
        updatedByUserId: req.user.id
      }
    });
    await prisma.auditLog.create({
      data: {
        restaurantId: req.simulationRestaurant.id,
        actorUserId: req.user.id,
        action: "development.entitlement_simulation.updated",
        entityType: "TenantEntitlementSimulation",
        entityId: simulation.id,
        metadataJson: {
          previous: current ? simulationPayload(current) : null,
          next: simulationPayload(simulation),
          note: "Simulation changes do not modify Stripe, platform subscriptions, tenant subscriptions, payments, or billing records."
        }
      }
    });
    req.entitlementCache?.delete(req.simulationRestaurant.id);
    const entitlements = await loadRestaurantEntitlements(req.simulationRestaurant.id, req);
    res.json({
      simulation: simulationPayload(simulation),
      entitlements
    });
  } catch (error) {
    next(error);
  }
});

export default router;

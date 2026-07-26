import { prisma } from "../config/prisma.js";
import {
  entitlementDecision,
  FEATURE,
  FEATURE_LABELS,
  isMutatingMethod,
  normalizePlanCode,
  normalizeSubscriptionStatus,
  PLAN_RANK,
  requiredPlanForFeature,
  usageLimitDecision,
  USAGE_LIMIT_LABELS
} from "../config/entitlements.js";

function httpError(message, status = 403, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function newestPlatformSubscription(subscriptions = []) {
  const activeFirst = [...subscriptions].sort((a, b) => {
    const aActive = ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"].includes(String(a.status));
    const bActive = ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"].includes(String(b.status));
    if (aActive !== bActive) return aActive ? -1 : 1;
    return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
  });
  return activeFirst[0] || null;
}

function newestLegacySubscription(subscriptions = []) {
  const active = subscriptions.find((subscription) => subscription.active);
  return active || subscriptions[0] || null;
}

function isInternalTenantClassification(value) {
  return ["INTERNAL_DEVELOPMENT", "PRIVATE_BETA"].includes(String(value || "").toUpperCase());
}

function isActiveSimulation(simulation) {
  if (!simulation?.enabled) return false;
  if (!simulation.expiresAt) return true;
  return new Date(simulation.expiresAt).getTime() > Date.now();
}

function applyEntitlementSimulation(entitlement, restaurant) {
  const tenantClassification = restaurant.tenantClassification || "STANDARD";
  const activeSimulation = isActiveSimulation(restaurant.entitlementSimulation)
    ? restaurant.entitlementSimulation
    : null;
  const simulation = activeSimulation || (
    isInternalTenantClassification(tenantClassification) && entitlement.tenantStatus === "ACTIVE"
      ? { enabled: true, mode: "FULL_ACCESS", source: "INTERNAL_FULL_ACCESS_DEFAULT" }
      : null
  );

  if (!simulation) {
    return {
      ...entitlement,
      tenantClassification,
      actualPlanCode: entitlement.planCode,
      actualSubscriptionStatus: entitlement.subscriptionStatus,
      fullAccess: false,
      simulation: restaurant.entitlementSimulation
        ? {
            enabled: Boolean(restaurant.entitlementSimulation.enabled),
            mode: restaurant.entitlementSimulation.mode,
            simulatedPlan: restaurant.entitlementSimulation.simulatedPlan || null,
            simulatedSubscriptionStatus: restaurant.entitlementSimulation.simulatedSubscriptionStatus || null,
            expiresAt: restaurant.entitlementSimulation.expiresAt || null,
            active: false
          }
        : null
    };
  }

  const mode = String(simulation.mode || "FULL_ACCESS").toUpperCase();
  const simulatedPlan = normalizePlanCode(simulation.simulatedPlan || entitlement.planCode);
  const statusByMode = {
    FULL_ACCESS: "ACTIVE",
    SIMULATE_PLAN: normalizeSubscriptionStatus(simulation.simulatedSubscriptionStatus || "ACTIVE"),
    SIMULATE_SUSPENDED: "SUSPENDED",
    SIMULATE_EXPIRED_TRIAL: "CANCELLED",
    SIMULATE_PAST_DUE: "PAST_DUE",
    SIMULATE_CANCELLED: "CANCELLED"
  };
  const simulatedStatus = statusByMode[mode] || normalizeSubscriptionStatus(simulation.simulatedSubscriptionStatus || entitlement.subscriptionStatus);

  return {
    ...entitlement,
    tenantClassification,
    actualPlanCode: entitlement.planCode,
    actualSubscriptionStatus: entitlement.subscriptionStatus,
    planCode: mode === "FULL_ACCESS" ? "ENTERPRISE" : simulatedPlan,
    subscriptionStatus: entitlement.tenantStatus === "ACTIVE" ? simulatedStatus : entitlement.subscriptionStatus,
    subscriptionSource: activeSimulation ? "ENTITLEMENT_SIMULATION" : "INTERNAL_FULL_ACCESS_DEFAULT",
    fullAccess: mode === "FULL_ACCESS" && entitlement.tenantStatus === "ACTIVE",
    fullAccessSource: activeSimulation ? "ENTITLEMENT_SIMULATION" : "INTERNAL_FULL_ACCESS_DEFAULT",
    simulation: {
      enabled: true,
      mode,
      simulatedPlan: mode === "FULL_ACCESS" ? "ENTERPRISE" : simulatedPlan,
      simulatedSubscriptionStatus: simulatedStatus,
      expiresAt: simulation.expiresAt || null,
      active: true,
      source: simulation.source || (activeSimulation ? "DATABASE" : "DEFAULT")
    }
  };
}

export function restaurantIdFromRequest(req) {
  return req.resolvedRestaurantId || req.params?.restaurantId || req.body?.restaurantId || req.query?.restaurantId || req.tenantId || req.user?.restaurantId || null;
}

export async function loadRestaurantEntitlements(restaurantId, req = null) {
  if (!restaurantId) throw httpError("restaurantId is required for entitlement checks.", 400);
  if (req) {
    req.entitlementCache ||= new Map();
    if (req.entitlementCache.has(restaurantId)) return req.entitlementCache.get(restaurantId);
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      id: true,
      slug: true,
      name: true,
      businessName: true,
      status: true,
      enabledModules: true,
      tenantClassification: true,
      entitlementSimulation: true,
      platformSubscriptions: {
        include: { plan: true },
        orderBy: [{ updatedAt: "desc" }],
        take: 5
      },
      subscriptions: {
        include: { plan: true },
        orderBy: [{ currentPeriodStart: "desc" }],
        take: 5
      }
    }
  });

  if (!restaurant) throw httpError("Restaurant not found for entitlement checks.", 404);

  const platformSubscription = newestPlatformSubscription(restaurant.platformSubscriptions);
  const legacySubscription = newestLegacySubscription(restaurant.subscriptions);
  const selected = platformSubscription || legacySubscription || null;
  const planCode = normalizePlanCode(selected?.plan?.code);
  const subscriptionStatus = restaurant.status === "SUSPENDED" || restaurant.status === "DELETED" || restaurant.status === "PENDING"
    ? restaurant.status
    : platformSubscription
      ? normalizeSubscriptionStatus(platformSubscription.status)
      : legacySubscription?.active === false
        ? "CANCELLED"
        : "ACTIVE";

  const baseEntitlement = {
    restaurantId: restaurant.id,
    restaurantSlug: restaurant.slug,
    restaurantName: restaurant.businessName || restaurant.name,
    tenantStatus: restaurant.status,
    enabledModules: restaurant.enabledModules || [],
    planCode,
    subscriptionStatus,
    subscriptionSource: platformSubscription ? "PLATFORM_SUBSCRIPTION" : legacySubscription ? "TENANT_SUBSCRIPTION" : "STARTER_FALLBACK",
    stripeCustomerId: platformSubscription?.stripeCustomerId || legacySubscription?.stripeCustomerId || null,
    stripeSubscriptionId: platformSubscription?.stripeSubscriptionId || legacySubscription?.stripeSubscriptionId || null,
    platformSubscriptionId: platformSubscription?.id || null,
    tenantSubscriptionId: legacySubscription?.id || null
  };
  const entitlement = applyEntitlementSimulation(baseEntitlement, restaurant);

  if (req) req.entitlementCache.set(restaurantId, entitlement);
  return entitlement;
}

function sendEntitlementError(res, decision) {
  return res.status(decision.status || 403).json({
    error: decision.error,
    code: decision.code,
    feature: decision.feature,
    featureLabel: decision.featureLabel,
    currentPlan: decision.currentPlan,
    requiredPlan: decision.requiredPlan,
    subscriptionStatus: decision.subscriptionStatus,
    upgradeRequired: decision.code === "FEATURE_NOT_INCLUDED"
  });
}

function sendUsageLimitError(res, decision) {
  return res.status(decision.status || 403).json({
    error: decision.error,
    code: decision.code,
    limitCode: decision.limitCode,
    limitLabel: decision.limitLabel,
    currentPlan: decision.currentPlan,
    used: decision.used,
    requestedIncrement: decision.requestedIncrement,
    maxAllowed: decision.maxAllowed,
    upgradeRequired: Boolean(decision.upgradeRequired)
  });
}

export function featureGuard(featureOrResolver, options = {}) {
  return async (req, res, next) => {
    try {
      if (options.allowSuperAdmin !== false && req.user?.role === "SUPER_ADMIN") return next();
      const feature = typeof featureOrResolver === "function" ? featureOrResolver(req) : featureOrResolver;
      const restaurantId = options.restaurantId ? options.restaurantId(req) : restaurantIdFromRequest(req);
      const entitlement = await loadRestaurantEntitlements(restaurantId, req);
      const decision = entitlementDecision(entitlement, feature, req.method);
      req.entitlements = entitlement;
      req.entitlementDecision = decision;
      if (!decision.allowed) return sendEntitlementError(res, decision);
      if (decision.warning) res.setHeader("x-loohar-subscription-warning", decision.warning);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function planGuard(requiredPlan, options = {}) {
  return async (req, res, next) => {
    try {
      if (options.allowSuperAdmin !== false && req.user?.role === "SUPER_ADMIN") return next();
      const restaurantId = options.restaurantId ? options.restaurantId(req) : restaurantIdFromRequest(req);
      const entitlement = await loadRestaurantEntitlements(restaurantId, req);
      req.entitlements = entitlement;
      const currentPlan = normalizePlanCode(entitlement.planCode);
      const required = normalizePlanCode(requiredPlan);
      if (PLAN_RANK[currentPlan] < PLAN_RANK[required]) {
        return res.status(403).json({
          error: "Feature not included in current plan.",
          code: "PLAN_NOT_INCLUDED",
          currentPlan,
          requiredPlan: required,
          upgradeRequired: true
        });
      }
      if (isMutatingMethod(req.method)) {
        const decision = entitlementDecision(entitlement, FEATURE.BASIC_DASHBOARD, req.method);
        if (!decision.allowed) return sendEntitlementError(res, decision);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function usageLimitGuard(limitCode, usageResolver, options = {}) {
  return async (req, res, next) => {
    try {
      if (options.allowSuperAdmin !== false && req.user?.role === "SUPER_ADMIN") return next();
      const restaurantId = options.restaurantId ? options.restaurantId(req) : restaurantIdFromRequest(req);
      const entitlement = await loadRestaurantEntitlements(restaurantId, req);
      const usage = await usageResolver(req, entitlement);
      const decision = usageLimitDecision({
        entitlement,
        limitCode,
        used: usage?.used,
        requestedIncrement: usage?.requestedIncrement ?? 1
      });
      req.entitlements = entitlement;
      req.usageLimitDecision = decision;
      if (!decision.allowed) return sendUsageLimitError(res, decision);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function assertFeatureForRestaurant({ restaurantId, feature, method = "GET" }) {
  const entitlement = await loadRestaurantEntitlements(restaurantId);
  const decision = entitlementDecision(entitlement, feature, method);
  if (!decision.allowed) {
    throw httpError(decision.error, decision.status || 403, {
      code: decision.code,
      feature,
      featureLabel: FEATURE_LABELS[feature] || feature,
      currentPlan: decision.currentPlan,
      requiredPlan: decision.requiredPlan || requiredPlanForFeature(feature),
      subscriptionStatus: decision.subscriptionStatus
    });
  }
  return { entitlement, decision };
}

export async function assertUsageLimitForRestaurant({ restaurantId, limitCode, used = 0, requestedIncrement = 1 }) {
  const entitlement = await loadRestaurantEntitlements(restaurantId);
  const decision = usageLimitDecision({ entitlement, limitCode, used, requestedIncrement });
  if (!decision.allowed) {
    throw httpError(decision.error, decision.status || 403, {
      code: decision.code,
      limitCode,
      limitLabel: USAGE_LIMIT_LABELS[limitCode] || limitCode,
      currentPlan: decision.currentPlan,
      used: decision.used,
      requestedIncrement: decision.requestedIncrement,
      maxAllowed: decision.maxAllowed,
      upgradeRequired: Boolean(decision.upgradeRequired)
    });
  }
  return { entitlement, decision };
}

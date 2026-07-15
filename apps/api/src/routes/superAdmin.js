import bcrypt from "bcrypt";
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { recordAudit } from "../services/auditService.js";
import { sendAccountSetupEmail } from "../services/accountAccessService.js";
import { DNS_TARGET, ensureDomain, ensureWebsiteSettings } from "../services/websiteService.js";
import { defaultTenantHost, domainInfoForRestaurant, domainUpdateDataForRestaurant } from "../services/domainService.js";
import { normalizeEmail } from "../utils/authSecurity.js";
import { sanitizeUser } from "../utils/sanitize.js";
import { signAccessToken, signRefreshToken } from "../utils/tokens.js";

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN"));

const tenantInclude = {
  users: { select: { id: true, email: true, name: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: true, lastLoginAt: true, createdAt: true, updatedAt: true } },
  websiteSettings: true,
  domains: true,
  deliveryZones: true,
  subscriptions: { include: { plan: true } },
  _count: { select: { orders: true, menuItems: true, drivers: true, customers: true } }
};

const defaultCategoriesByBusinessType = {
  RESTAURANT: ["Appetizers", "Soups", "Salads", "Lunch", "Dinner", "Desserts", "Drinks"],
  BAKERY: ["Cakes", "Pastries", "Bread", "Coffee", "Tea", "Desserts"],
  LIQUOR_STORE: ["Beer", "Wine", "Whiskey", "Vodka", "Rum", "Tequila", "Mixers"],
  COFFEE_SHOP: ["Espresso", "Coffee", "Tea", "Breakfast", "Bakery", "Sandwiches"]
};

function defaultCategoriesFor(businessType) {
  return defaultCategoriesByBusinessType[businessType] || defaultCategoriesByBusinessType.RESTAURANT;
}

function generatedAdminEmail(ownerEmail, slug) {
  const [local, domain] = normalizeEmail(ownerEmail).split("@");
  if (!domain) return `admin+${slug}@loohar.local`;
  return `${local}+admin@${domain}`;
}

function adminOnboardingSummary(restaurant) {
  const website = restaurant.websiteSettings || {};
  const domain = restaurant.domains?.[0] || {};
  const ownerReady = (restaurant.users || []).some((user) => ["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN"].includes(user.role) && user.status === "ACTIVE");
  const sections = {
    business: Boolean(restaurant.name && restaurant.slug && restaurant.email && restaurant.phone && restaurant.address && restaurant.city && restaurant.state && restaurant.zip),
    owner: ownerReady,
    branding: Boolean((website.logoUrl || restaurant.logoUrl) && website.heroImageUrl),
    content: Boolean(website.heroTitle && website.heroSubtitle && website.aboutStory),
    hours: Boolean(website.storeHoursJson || restaurant.storeHoursJson),
    fulfillment: Boolean(restaurant.pickupEnabled || restaurant.deliveryEnabled) && (!restaurant.deliveryEnabled || (restaurant.deliveryZones || []).length > 0 || Number(restaurant.deliveryRadiusMiles || 0) > 0),
    menu: (restaurant._count?.menuItems || 0) > 0,
    domain: Boolean(domain.defaultSubdomain || restaurant.slug),
    payments: Boolean(restaurant.settingsJson?.paymentSetup?.status === "CONNECTED" || restaurant.settingsJson?.paymentSetup?.connected === true)
  };
  const completedSectionCount = Object.values(sections).filter(Boolean).length;
  const completionPercentage = Math.round((completedSectionCount / Object.keys(sections).length) * 100);
  return {
    status: restaurant.onboardingStatus,
    currentStep: restaurant.onboardingCurrentStep,
    completionPercentage,
    websitePublished: Boolean(restaurant.websitePublishedAt),
    websitePublishedAt: restaurant.websitePublishedAt,
    orderingEnabled: Boolean(restaurant.settingsJson?.onlineOrderingEnabled),
    paymentConnected: sections.payments,
    domainStatus: domain.domainStatus || "NOT_CONFIGURED",
    lastUpdatedAt: restaurant.onboardingUpdatedAt || restaurant.updatedAt
  };
}

function attachAdminOnboardingSummary(restaurant) {
  return { ...restaurant, onboarding: adminOnboardingSummary(restaurant) };
}

function generateTemporaryPassword() {
  return `Temp-${crypto.randomBytes(9).toString("base64url")}1!`;
}

const restaurantSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    businessName: z.string().min(2),
    businessType: z.enum(["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"]).default("RESTAURANT"),
    enabledModules: z.array(z.enum(["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"])).default(["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"]),
    slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    timezone: z.string().optional(),
    brandingJson: z.record(z.unknown()).optional(),
    settingsJson: z.record(z.unknown()).optional(),
    deliveryEnabled: z.boolean().optional(),
    pickupEnabled: z.boolean().optional(),
    websiteEnabled: z.boolean().optional(),
    cuisineType: z.string().optional(),
    ownerEmail: z.string().email(),
    ownerPassword: z.string().min(8).optional(),
    ownerTemporaryPassword: z.string().min(8).optional(),
    planCode: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]).default("STARTER")
  })
});

function normalizeTenantPayload(req, res, next) {
  const body = { ...req.body };
  const businessName = body.businessName || body.name;
  const slug = body.slug || businessName?.toLowerCase()?.trim()?.replace(/[^a-z0-9]+/g, "-")?.replace(/^-+|-+$/g, "");
  req.body = {
    ...body,
    name: body.name || businessName,
    businessName: body.publicBusinessName || businessName,
    slug,
    email: body.businessEmail ? normalizeEmail(body.businessEmail) : body.email ? normalizeEmail(body.email) : body.email,
    ownerEmail: body.ownerEmail ? normalizeEmail(body.ownerEmail) : body.ownerEmail,
    restaurantAdminEmail: body.restaurantAdminEmail ? normalizeEmail(body.restaurantAdminEmail) : body.restaurantAdminEmail,
    cuisineType: body.categoryLabel || body.cuisineType,
    planCode: (body.planCode || body.plan || "STARTER").toString().toUpperCase()
  };
  next();
}

async function listBusinesses(req, res, next) {
  try {
    const where = {
      ...(req.query.includeDeleted === "true" ? {} : { status: { not: "DELETED" } }),
      ...(req.query.businessType ? { businessType: req.query.businessType } : {})
    };
    const restaurants = await prisma.restaurant.findMany({
      where,
      include: tenantInclude,
      orderBy: { createdAt: "desc" }
    });
    const businesses = restaurants.map(attachAdminOnboardingSummary);
    res.json({ restaurants: businesses, businesses });
  } catch (error) {
    next(error);
  }
}

router.get("/restaurants", listBusinesses);
router.get("/businesses", listBusinesses);
router.get("/tenants", listBusinesses);

router.get("/dashboard-summary", async (req, res, next) => {
  try {
    const [
      totalBusinesses,
      activeBusinesses,
      suspendedBusinesses,
      totalCustomers,
      totalOrders,
      orderVolume,
      activeDrivers,
      professionalPlans,
      enterprisePlans
    ] = await Promise.all([
      prisma.restaurant.count({ where: { status: { not: "DELETED" } } }),
      prisma.restaurant.count({ where: { status: "ACTIVE" } }),
      prisma.restaurant.count({ where: { status: "SUSPENDED" } }),
      prisma.customer.count(),
      prisma.order.count(),
      prisma.order.aggregate({ _sum: { totalCents: true } }),
      prisma.driver.count({ where: { available: true, user: { status: "ACTIVE" } } }),
      prisma.tenantSubscription.count({ where: { active: true, plan: { code: "PROFESSIONAL" } } }),
      prisma.tenantSubscription.count({ where: { active: true, plan: { code: "ENTERPRISE" } } })
    ]);
    res.json({
      totalBusinesses,
      activeBusinesses,
      suspendedBusinesses,
      totalCustomers,
      totalOrders,
      grossOrderVolume: orderVolume._sum.totalCents || 0,
      activeDrivers,
      professionalPlans,
      enterprisePlans
    });
  } catch (error) {
    next(error);
  }
});

async function createBusiness(req, res, next) {
  try {
    const { ownerEmail, ownerPassword: _ownerPassword, ownerTemporaryPassword: _providedOwnerTemporaryPassword, restaurantAdminEmail: requestedRestaurantAdminEmail, planCode, websiteEnabled, cuisineType, ...restaurantData } = req.body;
    const normalizedOwnerEmail = normalizeEmail(ownerEmail);
    const restaurantAdminEmail = normalizeEmail(requestedRestaurantAdminEmail || generatedAdminEmail(normalizedOwnerEmail, restaurantData.slug));
    const [existingSlug, existingOwner, existingAdmin] = await Promise.all([
      prisma.restaurant.findUnique({ where: { slug: restaurantData.slug }, select: { id: true } }),
      prisma.user.findFirst({ where: { email: { equals: normalizedOwnerEmail, mode: "insensitive" } }, select: { id: true } }),
      prisma.user.findFirst({ where: { email: { equals: restaurantAdminEmail, mode: "insensitive" } }, select: { id: true } })
    ]);
    if (existingSlug) return res.status(409).json({ error: `Slug "${restaurantData.slug}" is already used by another tenant.` });
    if (existingOwner) return res.status(409).json({ error: `Owner email "${normalizedOwnerEmail}" is already used by another account.` });
    if (existingAdmin) return res.status(409).json({ error: `Restaurant admin email "${restaurantAdminEmail}" is already used by another account.` });
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: planCode } });
    if (!plan) return res.status(404).json({ error: `Plan "${planCode}" not found.` });
    const ownerTemporaryPassword = generateTemporaryPassword();
    const adminTemporaryPassword = generateTemporaryPassword();
    const [ownerPasswordHash, adminPasswordHash] = await Promise.all([
      bcrypt.hash(ownerTemporaryPassword, 12),
      bcrypt.hash(adminTemporaryPassword, 12)
    ]);
    const categories = defaultCategoriesFor(restaurantData.businessType);
    const restaurant = await prisma.$transaction(async (tx) => {
      const createdRestaurant = await tx.restaurant.create({
        data: {
          ...restaurantData,
          businessName: restaurantData.businessName || restaurantData.name,
          status: "ACTIVE",
          settingsJson: {
            ...(restaurantData.settingsJson || {}),
            enabledModules: restaurantData.enabledModules,
            createdBy: "MASTER_ADMIN"
          },
          websiteSettings: { create: { websiteEnabled: websiteEnabled ?? true, cuisineType, tagline: cuisineType, heroTitle: restaurantData.name, heroSubtitle: restaurantData.description || `Order directly from ${restaurantData.name}.`, brandColor: "#1f9d80", accentColor: "#f4b740" } },
          domains: { create: { defaultSubdomain: restaurantData.slug, primaryDomain: defaultTenantHost(restaurantData.slug), canonicalDomain: defaultTenantHost(restaurantData.slug), customDomain: null, dnsTarget: DNS_TARGET, domainStatus: "NOT_CONFIGURED", sslStatus: "NOT_CONFIGURED" } },
          categories: {
            create: categories.map((name, index) => ({ name, sortOrder: index + 1 }))
          },
          subscriptions: plan ? { create: { planId: plan.id } } : undefined
        }
      });
      const owner = await tx.user.create({
        data: {
          email: normalizedOwnerEmail,
          name: `${restaurantData.name} Owner`,
          passwordHash: ownerPasswordHash,
          role: "TENANT_OWNER",
          status: "ACTIVE",
          forcePasswordChange: true,
          temporaryPassword: true,
          passwordChangedAt: null,
          restaurantId: createdRestaurant.id
        }
      });
      const restaurantAdmin = await tx.user.create({
        data: {
          email: restaurantAdminEmail,
          name: `${restaurantData.name} Admin`,
          passwordHash: adminPasswordHash,
          role: "RESTAURANT_ADMIN",
          status: "ACTIVE",
          forcePasswordChange: true,
          temporaryPassword: true,
          passwordChangedAt: null,
          restaurantId: createdRestaurant.id
        }
      });
      await tx.restaurantStaff.create({
        data: { restaurantId: createdRestaurant.id, userId: owner.id, role: "TENANT_OWNER" }
      });
      await tx.restaurantStaff.create({
        data: { restaurantId: createdRestaurant.id, userId: restaurantAdmin.id, role: "RESTAURANT_ADMIN" }
      });
      return tx.restaurant.findUnique({
        where: { id: createdRestaurant.id },
        include: tenantInclude
      });
    }, { timeout: 20_000 });
    const owner = restaurant.users?.find((user) => user.role === "TENANT_OWNER");
    const restaurantAdmin = restaurant.users?.find((user) => user.role === "RESTAURANT_ADMIN");
    await Promise.allSettled([
      owner ? sendAccountSetupEmail({ user: owner }) : null,
      restaurantAdmin ? sendAccountSetupEmail({ user: restaurantAdmin }) : null
    ]);
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "business.created", entityType: "Business", entityId: restaurant.id });
    res.status(201).json({ restaurant, business: restaurant, generatedAccounts: { ownerEmail: normalizedOwnerEmail, restaurantAdminEmail, delivery: "set_password_email" } });
  } catch (error) {
    next(error);
  }
}

router.post("/restaurants", normalizeTenantPayload, validate(restaurantSchema), createBusiness);
router.post("/businesses", normalizeTenantPayload, validate(restaurantSchema), createBusiness);
router.post("/tenants", normalizeTenantPayload, validate(restaurantSchema), createBusiness);

async function getBusiness(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.params.restaurantId || req.params.businessId },
      include: tenantInclude
    });
    if (!restaurant) return res.status(404).json({ error: "Business not found" });
    res.json({ restaurant, business: restaurant });
  } catch (error) {
    next(error);
  }
}

router.get("/restaurants/:restaurantId", getBusiness);
router.get("/businesses/:businessId", getBusiness);
router.get("/tenants/:businessId", getBusiness);

async function getTenantUsers(req, res, next) {
  try {
    const restaurantId = req.params.tenantId || req.params.restaurantId || req.params.businessId;
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true, name: true, businessName: true, slug: true } });
    if (!restaurant) return res.status(404).json({ error: "Business not found" });
    const users = await prisma.user.findMany({
      where: { restaurantId },
      select: { id: true, email: true, name: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: true, lastLoginAt: true, createdAt: true, updatedAt: true },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }]
    });
    res.json({ restaurant, business: restaurant, users });
  } catch (error) {
    next(error);
  }
}

router.get("/tenants/:tenantId/users", getTenantUsers);
router.get("/restaurants/:restaurantId/users", getTenantUsers);
router.get("/businesses/:businessId/users", getTenantUsers);

async function getBusinessAudit(req, res, next) {
  try {
    const businessId = req.params.restaurantId || req.params.businessId;
    const [restaurant, auditLogs] = await Promise.all([
      prisma.restaurant.findUnique({ where: { id: businessId }, select: { id: true, name: true, businessName: true, slug: true } }),
      prisma.auditLog.findMany({
        where: { restaurantId: businessId },
        include: { actor: true, restaurant: true },
        orderBy: { createdAt: "desc" },
        take: 200
      })
    ]);
    if (!restaurant) return res.status(404).json({ error: "Business not found" });
    res.json({ restaurant, business: restaurant, auditLogs });
  } catch (error) {
    next(error);
  }
}

router.get("/restaurants/:restaurantId/audit", getBusinessAudit);
router.get("/businesses/:businessId/audit", getBusinessAudit);
router.get("/tenants/:businessId/audit", getBusinessAudit);

async function updateBusiness(req, res, next) {
  try {
    const restaurantId = req.params.restaurantId || req.params.businessId;
    const ownerEmail = req.body.ownerEmail ? normalizeEmail(req.body.ownerEmail) : req.body.ownerEmail;
    const data = {
      ...req.body,
      ...(req.body.publicBusinessName ? { businessName: req.body.publicBusinessName } : {}),
      ...(req.body.businessEmail ? { email: normalizeEmail(req.body.businessEmail) } : {}),
      ...(req.body.categoryLabel ? {} : {})
    };
    delete data.publicBusinessName;
    delete data.businessEmail;
    delete data.categoryLabel;
    delete data.plan;
    delete data.planCode;
    delete data.ownerEmail;
    delete data.websiteEnabled;
    delete data.cuisineType;
    delete data.customDomain;
    delete data.domainStatus;
    if (data.name && !data.businessName) data.businessName = data.name;
    const existingSlug = data.slug ? await prisma.restaurant.findFirst({ where: { slug: data.slug, NOT: { id: restaurantId } }, select: { id: true } }) : null;
    if (existingSlug) return res.status(409).json({ error: `Slug "${data.slug}" is already used by another tenant.` });

    const updatedRestaurant = await prisma.restaurant.update({ where: { id: restaurantId }, data });
    if (ownerEmail) {
      const currentOwner = await prisma.user.findFirst({ where: { restaurantId, role: { in: ["TENANT_OWNER", "RESTAURANT_OWNER"] } } });
      const emailOwner = await prisma.user.findFirst({ where: { email: { equals: ownerEmail, mode: "insensitive" } } });
      if (emailOwner && emailOwner.id !== currentOwner?.id) {
        return res.status(409).json({ error: `Owner email "${ownerEmail}" is already used by another account.` });
      }
      if (currentOwner) {
        await prisma.user.update({ where: { id: currentOwner.id }, data: { email: ownerEmail } });
      }
    }
    const restaurant = await prisma.restaurant.findUnique({ where: { id: updatedRestaurant.id }, include: tenantInclude });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "business.updated", entityType: "Business", entityId: restaurant.id });
    res.json({ restaurant, business: restaurant });
  } catch (error) {
    next(error);
  }
}

router.patch("/restaurants/:restaurantId", updateBusiness);
router.patch("/businesses/:businessId", updateBusiness);
router.patch("/tenants/:businessId", updateBusiness);

async function suspendBusiness(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.update({ where: { id: req.params.restaurantId || req.params.businessId }, data: { status: "SUSPENDED" } });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "business.suspended", entityType: "Business", entityId: restaurant.id });
    res.json({ restaurant, business: restaurant });
  } catch (error) {
    next(error);
  }
}

router.post("/restaurants/:restaurantId/suspend", suspendBusiness);
router.post("/businesses/:businessId/suspend", suspendBusiness);
router.post("/tenants/:businessId/suspend", suspendBusiness);

async function activateBusiness(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.update({ where: { id: req.params.restaurantId || req.params.businessId }, data: { status: "ACTIVE" } });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "business.activated", entityType: "Business", entityId: restaurant.id });
    res.json({ restaurant, business: restaurant });
  } catch (error) {
    next(error);
  }
}

async function updateBusinessStatus(req, res, next) {
  try {
    const status = req.body.status;
    if (!["ACTIVE", "SUSPENDED", "PENDING", "DELETED"].includes(status)) return res.status(400).json({ error: "Status must be ACTIVE, SUSPENDED, PENDING, or DELETED." });
    const restaurant = await prisma.restaurant.update({ where: { id: req.params.restaurantId || req.params.businessId }, data: { status }, include: tenantInclude });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "business.status.updated", entityType: "Business", entityId: restaurant.id, metadata: { status: req.body.status } });
    res.json({ restaurant, business: restaurant });
  } catch (error) {
    next(error);
  }
}

router.post("/restaurants/:restaurantId/activate", activateBusiness);
router.post("/businesses/:businessId/activate", activateBusiness);
router.post("/tenants/:businessId/activate", activateBusiness);
router.patch("/restaurants/:restaurantId/status", updateBusinessStatus);
router.patch("/businesses/:businessId/status", updateBusinessStatus);
router.patch("/tenants/:businessId/status", updateBusinessStatus);
router.delete("/restaurants/:restaurantId", async (req, res, next) => {
  req.body.status = "DELETED";
  return updateBusinessStatus(req, res, next);
});
router.delete("/businesses/:businessId", async (req, res, next) => {
  req.body.status = "DELETED";
  return updateBusinessStatus(req, res, next);
});
router.delete("/tenants/:businessId", async (req, res, next) => {
  req.body.status = "DELETED";
  return updateBusinessStatus(req, res, next);
});

router.post("/restaurants/:restaurantId/impersonate", async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: { restaurantId: req.params.restaurantId, role: { in: ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"] } },
      include: { restaurant: { select: { slug: true, name: true, businessName: true } } }
    });
    if (!user) return res.status(404).json({ error: "No restaurant admin found" });
    await recordAudit({ actorUserId: req.user.id, restaurantId: req.params.restaurantId, action: "impersonation.started", entityType: "User", entityId: user.id });
    res.json({
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user),
      impersonatedUser: sanitizeUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/users/:userId/reset-password", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      include: { restaurant: { select: { id: true, name: true, businessName: true, slug: true } } }
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role === "SUPER_ADMIN" && user.id !== req.user.id) return res.status(403).json({ error: "Use a dedicated super-admin recovery flow for platform owner accounts." });
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: "PASSWORD_RESET_REQUIRED",
        forcePasswordChange: true,
        temporaryPassword: true,
        passwordChangedAt: null,
        sessionVersion: { increment: 1 }
      },
      select: { id: true, email: true, name: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: true, lastLoginAt: true, sessionVersion: true }
    });
    await sendAccountSetupEmail({ user: updatedUser }).catch(() => {});
    await recordAudit({ actorUserId: req.user.id, restaurantId: user.restaurantId, action: "user.password_reset_by_admin", entityType: "User", entityId: user.id });
    res.json({ user: updatedUser, passwordReset: { status: "generated", delivery: "set_password_email" } });
  } catch (error) {
    next(error);
  }
});

router.patch("/users/:userId/status", async (req, res, next) => {
  try {
    const status = (req.body.status || "").toString().toUpperCase();
    if (!["ACTIVE", "DISABLED", "INVITED", "PASSWORD_RESET_REQUIRED", "SUSPENDED", "DELETED"].includes(status)) {
      return res.status(400).json({ error: "Status must be ACTIVE, DISABLED, INVITED, PASSWORD_RESET_REQUIRED, SUSPENDED, or DELETED." });
    }
    const existing = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (existing.role === "SUPER_ADMIN" && status !== "ACTIVE" && existing.id === req.user.id) {
      return res.status(400).json({ error: "You cannot disable your own Super Admin account." });
    }
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { status },
      select: { id: true, email: true, name: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: true, lastLoginAt: true }
    });
    const action = status === "ACTIVE" ? "user.enabled" : status === "DISABLED" || status === "SUSPENDED" ? "user.disabled" : "user.status.updated";
    await recordAudit({ actorUserId: req.user.id, restaurantId: existing.restaurantId, action, entityType: "User", entityId: existing.id, metadata: { status } });
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

router.get("/orders", async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      include: { restaurant: true, customer: true, delivery: { include: { driver: { include: { user: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json({ orders });
  } catch (error) {
    next(error);
  }
});

router.get("/analytics", async (req, res, next) => {
  try {
    const [restaurants, activeDrivers, activeCustomers, revenue] = await Promise.all([
      prisma.restaurant.count(),
      prisma.driver.count({ where: { available: true } }),
      prisma.customer.count(),
      prisma.payment.aggregate({ _sum: { amountCents: true, technologyFeeCents: true, driverTipCents: true } })
    ]);
    const byBusinessType = await prisma.restaurant.groupBy({ by: ["businessType"], _count: true });
    res.json({ restaurants, businesses: restaurants, byBusinessType, activeDrivers, activeCustomers, revenue: revenue._sum });
  } catch (error) {
    next(error);
  }
});

router.get("/subscriptions", async (req, res, next) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({ include: { subscriptions: { include: { restaurant: true } } } });
    res.json({ plans });
  } catch (error) {
    next(error);
  }
});

async function changePlan(req, res, next) {
  try {
    const businessId = req.params.businessId || req.params.restaurantId;
    const planCode = (req.body.planCode || req.body.plan || "").toString().toUpperCase();
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: planCode } });
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    await prisma.tenantSubscription.updateMany({ where: { restaurantId: businessId, active: true }, data: { active: false } });
    const subscription = await prisma.tenantSubscription.create({ data: { restaurantId: businessId, planId: plan.id } });
    const restaurant = await prisma.restaurant.findUnique({ where: { id: businessId }, include: tenantInclude });
    await recordAudit({ actorUserId: req.user.id, restaurantId: businessId, action: "plan.changed", entityType: "TenantSubscription", entityId: subscription.id, metadata: { planCode } });
    res.json({ subscription, restaurant, business: restaurant });
  } catch (error) {
    next(error);
  }
}

router.patch("/businesses/:businessId/subscription", changePlan);
router.patch("/tenants/:businessId/plan", changePlan);
router.patch("/restaurants/:restaurantId/plan", changePlan);
router.patch("/businesses/:businessId/plan", changePlan);

function normalizeWebsitePayload(body) {
  const { cuisineLabel, homepageHeadline, homepageSubtitle, storeHours, ...rest } = body;
  return {
    website: {
      ...rest,
      ...(cuisineLabel ? { cuisineType: cuisineLabel } : {}),
      ...(homepageHeadline ? { heroTitle: homepageHeadline } : {}),
      ...(homepageSubtitle ? { heroSubtitle: homepageSubtitle } : {})
    },
    storeHours
  };
}

async function getAdminWebsite(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.restaurantId || req.params.businessId } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const website = await ensureWebsiteSettings(restaurant);
    res.json({ website });
  } catch (error) {
    next(error);
  }
}

async function updateAdminWebsite(req, res, next) {
  try {
    const restaurantId = req.params.restaurantId || req.params.businessId;
    const payload = normalizeWebsitePayload(req.body);
    if (payload.storeHours) {
      await prisma.restaurant.update({ where: { id: restaurantId }, data: { storeHoursJson: payload.storeHours } });
    }
    const website = await prisma.restaurantWebsiteSettings.upsert({
      where: { restaurantId },
      update: payload.website,
      create: { ...payload.website, restaurantId }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "admin.website.updated", entityType: "RestaurantWebsiteSettings", entityId: website.id });
    res.json({ website });
  } catch (error) {
    next(error);
  }
}

async function getAdminDomain(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.restaurantId || req.params.businessId } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const domain = await ensureDomain(restaurant);
    res.json({ domain: domainInfoForRestaurant(restaurant, domain), instructions: `Create a CNAME record for www pointing to ${DNS_TARGET}` });
  } catch (error) {
    next(error);
  }
}

async function updateAdminDomain(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.restaurantId || req.params.businessId } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const existing = await ensureDomain(restaurant);
    const domain = await prisma.restaurantDomain.update({
      where: { id: existing.id },
      data: domainUpdateDataForRestaurant(restaurant, existing, req.body)
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "admin.domain.updated", entityType: "RestaurantDomain", entityId: domain.id });
    res.json({ domain: domainInfoForRestaurant(restaurant, domain), instructions: `Create a CNAME record for www pointing to ${DNS_TARGET}` });
  } catch (error) {
    next(error);
  }
}

async function verifyAdminDomain(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.restaurantId || req.params.businessId } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const existing = await ensureDomain(restaurant);
    if (!existing.customDomain) return res.status(400).json({ error: "Add a custom domain before verification." });
    const domain = await prisma.restaurantDomain.update({
      where: { id: existing.id },
      data: domainUpdateDataForRestaurant(restaurant, existing, { ...existing, domainStatus: "VERIFIED", sslStatus: "SSL_PENDING", canonicalDomain: req.body.canonicalDomain || existing.customDomain })
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "admin.domain.verified", entityType: "RestaurantDomain", entityId: domain.id });
    res.json({ domain: domainInfoForRestaurant(restaurant, domain), instructions: `Create a CNAME record for www pointing to ${DNS_TARGET}` });
  } catch (error) {
    next(error);
  }
}

router.get("/restaurants/:restaurantId/website", getAdminWebsite);
router.patch("/restaurants/:restaurantId/website", updateAdminWebsite);
router.get("/restaurants/:restaurantId/domain", getAdminDomain);
router.patch("/restaurants/:restaurantId/domain", updateAdminDomain);
router.post("/restaurants/:restaurantId/domain/verify", verifyAdminDomain);
router.get("/businesses/:businessId/website", getAdminWebsite);
router.patch("/businesses/:businessId/website", updateAdminWebsite);
router.get("/businesses/:businessId/domain", getAdminDomain);
router.patch("/businesses/:businessId/domain", updateAdminDomain);
router.post("/businesses/:businessId/domain/verify", verifyAdminDomain);
router.get("/tenants/:businessId/website", getAdminWebsite);
router.patch("/tenants/:businessId/website", updateAdminWebsite);
router.get("/tenants/:businessId/domain", getAdminDomain);
router.patch("/tenants/:businessId/domain", updateAdminDomain);
router.post("/tenants/:businessId/domain/verify", verifyAdminDomain);

router.get("/audit-logs", async (req, res, next) => {
  try {
    const auditLogs = await prisma.auditLog.findMany({ include: { actor: true, restaurant: true }, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ auditLogs });
  } catch (error) {
    next(error);
  }
});

export default router;

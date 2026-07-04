import bcrypt from "bcrypt";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { recordAudit } from "../services/auditService.js";
import { notifyWelcomeEmail } from "../services/notificationService.js";
import { DNS_TARGET, ensureDomain, ensureWebsiteSettings } from "../services/websiteService.js";
import { signAccessToken } from "../utils/tokens.js";

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN"));

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
    ownerPassword: z.string().min(8).default("ChangeMe123!"),
    planCode: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]).default("STARTER")
  })
});

function normalizeTenantPayload(req, res, next) {
  const body = { ...req.body };
  const businessName = body.businessName || body.name;
  req.body = {
    ...body,
    name: body.name || businessName,
    businessName: body.publicBusinessName || businessName,
    email: body.businessEmail || body.email,
    cuisineType: body.categoryLabel || body.cuisineType,
    planCode: (body.planCode || body.plan || "STARTER").toString().toUpperCase()
  };
  next();
}

async function listBusinesses(req, res, next) {
  try {
    const where = req.query.businessType ? { businessType: req.query.businessType } : {};
    const restaurants = await prisma.restaurant.findMany({
      where,
      include: {
        users: { select: { id: true, email: true, name: true, role: true } },
        websiteSettings: true,
        domains: true,
        subscriptions: { include: { plan: true } },
        _count: { select: { orders: true, drivers: true, customers: true } }
      },
      orderBy: { createdAt: "desc" }
    });
    res.json({ restaurants, businesses: restaurants });
  } catch (error) {
    next(error);
  }
}

router.get("/restaurants", listBusinesses);
router.get("/businesses", listBusinesses);
router.get("/tenants", listBusinesses);

async function createBusiness(req, res, next) {
  try {
    const { ownerEmail, ownerPassword, planCode, websiteEnabled, cuisineType, ...restaurantData } = req.body;
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: planCode } });
    const passwordHash = await bcrypt.hash(ownerPassword, 12);
    const restaurant = await prisma.$transaction(async (tx) => {
      const createdRestaurant = await tx.restaurant.create({
        data: {
          ...restaurantData,
          businessName: restaurantData.businessName || restaurantData.name,
          status: "ACTIVE",
          websiteSettings: { create: { websiteEnabled: websiteEnabled ?? true, cuisineType, tagline: cuisineType, heroTitle: restaurantData.name, heroSubtitle: restaurantData.description || `Order directly from ${restaurantData.name}.` } },
          domains: { create: { defaultSubdomain: restaurantData.slug, dnsTarget: DNS_TARGET, domainStatus: "NOT_CONFIGURED", sslStatus: "NOT_CONFIGURED" } },
          categories: {
            create: [
              { name: "Featured", sortOrder: 1 },
              { name: "Entrees", sortOrder: 2 },
              { name: "Drinks", sortOrder: 3 }
            ]
          },
          subscriptions: plan ? { create: { planId: plan.id } } : undefined
        }
      });
      const owner = await tx.user.create({
        data: {
          email: ownerEmail,
          name: `${restaurantData.name} Owner`,
          passwordHash,
          role: "RESTAURANT_OWNER",
          restaurantId: createdRestaurant.id
        }
      });
      await tx.restaurantStaff.create({
        data: { restaurantId: createdRestaurant.id, userId: owner.id, role: "RESTAURANT_OWNER" }
      });
      return tx.restaurant.findUnique({
        where: { id: createdRestaurant.id },
        include: { users: true, subscriptions: { include: { plan: true } } }
      });
    });
    const owner = restaurant.users?.find((user) => user.role === "RESTAURANT_OWNER");
    if (owner) await Promise.allSettled([notifyWelcomeEmail({ user: owner })]);
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "business.created", entityType: "Business", entityId: restaurant.id });
    res.status(201).json({ restaurant, business: restaurant });
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
      include: {
        users: { select: { id: true, email: true, name: true, role: true } },
        subscriptions: { include: { plan: true } },
        _count: { select: { orders: true, menuItems: true, drivers: true, customers: true } }
      }
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

async function updateBusiness(req, res, next) {
  try {
    const data = {
      ...req.body,
      ...(req.body.publicBusinessName ? { businessName: req.body.publicBusinessName } : {}),
      ...(req.body.businessEmail ? { email: req.body.businessEmail } : {}),
      ...(req.body.categoryLabel ? {} : {})
    };
    delete data.publicBusinessName;
    delete data.businessEmail;
    delete data.categoryLabel;
    delete data.plan;
    delete data.planCode;
    delete data.websiteEnabled;
    delete data.cuisineType;
    delete data.customDomain;
    delete data.domainStatus;
    if (data.name && !data.businessName) data.businessName = data.name;
    const restaurant = await prisma.restaurant.update({ where: { id: req.params.restaurantId || req.params.businessId }, data });
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
    const restaurant = await prisma.restaurant.update({ where: { id: req.params.restaurantId || req.params.businessId }, data: { status: req.body.status } });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "business.status.updated", entityType: "Business", entityId: restaurant.id, metadata: { status: req.body.status } });
    res.json({ restaurant, business: restaurant });
  } catch (error) {
    next(error);
  }
}

router.post("/restaurants/:restaurantId/activate", activateBusiness);
router.post("/businesses/:businessId/activate", activateBusiness);
router.post("/tenants/:businessId/activate", activateBusiness);
router.patch("/tenants/:businessId/status", updateBusinessStatus);

router.post("/restaurants/:restaurantId/impersonate", async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: { restaurantId: req.params.restaurantId, role: { in: ["RESTAURANT_OWNER", "RESTAURANT_MANAGER"] } }
    });
    if (!user) return res.status(404).json({ error: "No restaurant admin found" });
    await recordAudit({ actorUserId: req.user.id, restaurantId: req.params.restaurantId, action: "restaurant.impersonated", entityType: "User", entityId: user.id });
    res.json({
      accessToken: signAccessToken(user),
      impersonatedUser: { id: user.id, email: user.email, name: user.name, role: user.role, restaurantId: user.restaurantId }
    });
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

router.patch("/businesses/:businessId/subscription", async (req, res, next) => {
  try {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: req.body.planCode } });
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    await prisma.tenantSubscription.updateMany({ where: { restaurantId: req.params.businessId, active: true }, data: { active: false } });
    const subscription = await prisma.tenantSubscription.create({ data: { restaurantId: req.params.businessId, planId: plan.id } });
    await recordAudit({ actorUserId: req.user.id, restaurantId: req.params.businessId, action: "subscription.changed", entityType: "TenantSubscription", entityId: subscription.id, metadata: { planCode: req.body.planCode } });
    res.json({ subscription });
  } catch (error) {
    next(error);
  }
});

router.patch("/tenants/:businessId/plan", async (req, res, next) => {
  try {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: req.body.planCode } });
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    await prisma.tenantSubscription.updateMany({ where: { restaurantId: req.params.businessId, active: true }, data: { active: false } });
    const subscription = await prisma.tenantSubscription.create({ data: { restaurantId: req.params.businessId, planId: plan.id } });
    await recordAudit({ actorUserId: req.user.id, restaurantId: req.params.businessId, action: "plan.changed", entityType: "TenantSubscription", entityId: subscription.id, metadata: { planCode: req.body.planCode } });
    res.json({ subscription });
  } catch (error) {
    next(error);
  }
});

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
    const website = await prisma.restaurantWebsiteSettings.upsert({
      where: { restaurantId },
      update: req.body,
      create: { ...req.body, restaurantId }
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
    res.json({ domain, instructions: `Point your CNAME record to: ${DNS_TARGET}` });
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
      data: {
        customDomain: req.body.customDomain,
        domainStatus: req.body.domainStatus || "PENDING_VERIFICATION",
        dnsTarget: req.body.dnsTarget || DNS_TARGET,
        sslStatus: req.body.sslStatus || "PENDING"
      }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "admin.domain.updated", entityType: "RestaurantDomain", entityId: domain.id });
    res.json({ domain, instructions: `Point your CNAME record to: ${DNS_TARGET}` });
  } catch (error) {
    next(error);
  }
}

router.get("/restaurants/:restaurantId/website", getAdminWebsite);
router.patch("/restaurants/:restaurantId/website", updateAdminWebsite);
router.get("/restaurants/:restaurantId/domain", getAdminDomain);
router.patch("/restaurants/:restaurantId/domain", updateAdminDomain);
router.get("/businesses/:businessId/website", getAdminWebsite);
router.patch("/businesses/:businessId/website", updateAdminWebsite);
router.get("/businesses/:businessId/domain", getAdminDomain);
router.patch("/businesses/:businessId/domain", updateAdminDomain);
router.get("/tenants/:businessId/website", getAdminWebsite);
router.patch("/tenants/:businessId/website", updateAdminWebsite);
router.get("/tenants/:businessId/domain", getAdminDomain);
router.patch("/tenants/:businessId/domain", updateAdminDomain);

router.get("/audit-logs", async (req, res, next) => {
  try {
    const auditLogs = await prisma.auditLog.findMany({ include: { actor: true, restaurant: true }, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ auditLogs });
  } catch (error) {
    next(error);
  }
});

export default router;

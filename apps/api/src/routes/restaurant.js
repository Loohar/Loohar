import bcrypt from "bcrypt";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole, requireTenantAccess } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { recordAudit } from "../services/auditService.js";
import { notifyDriverAssignment, notifyOrderStatusUpdate, notifyWelcomeEmail } from "../services/notificationService.js";
import { emitDeliveryUpdate, emitOrderUpdate } from "../services/realtimeService.js";
import { createImageUploadPlaceholder } from "../services/uploadService.js";
import { DNS_TARGET, ensureDomain, ensureWebsiteSettings } from "../services/websiteService.js";

const router = Router();
const restaurantRoles = ["RESTAURANT_OWNER", "RESTAURANT_MANAGER", "KITCHEN_STAFF"];
router.use(requireAuth, requireRole(...restaurantRoles, "SUPER_ADMIN"), requireTenantAccess);

function restaurantIdFor(req) {
  if (req.resolvedRestaurantId) return req.resolvedRestaurantId;
  return req.user.role === "SUPER_ADMIN" ? req.params.restaurantId || req.body.restaurantId : req.tenantId;
}

router.param("restaurantId", async (req, res, next, value) => {
  try {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: value }, { slug: value }] },
      select: { id: true, slug: true, status: true }
    });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    if (req.user.role !== "SUPER_ADMIN" && req.tenantId !== restaurant.id) {
      return res.status(403).json({ error: "Tenant access denied" });
    }
    req.resolvedRestaurantId = restaurant.id;
    req.resolvedRestaurantSlug = restaurant.slug;
    next();
  } catch (error) {
    next(error);
  }
});

function centsTotal(orders = []) {
  return orders.reduce((sum, order) => sum + (order.totalCents || 0), 0);
}

function segmentForCustomer(customer) {
  const totalOrders = customer.orders?.length || 0;
  const lifetimeSpend = centsTotal(customer.orders);
  const lastOrder = customer.orders?.[0]?.createdAt ? new Date(customer.orders[0].createdAt) : null;
  const daysSinceLastOrder = lastOrder ? (Date.now() - lastOrder.getTime()) / 86_400_000 : Infinity;
  if (totalOrders === 0) return "NEW_CUSTOMER";
  if (lifetimeSpend >= 50000 || totalOrders >= 10) return "VIP_CUSTOMER";
  if (daysSinceLastOrder > 90) return "INACTIVE_CUSTOMER";
  if (daysSinceLastOrder > 45) return "AT_RISK_CUSTOMER";
  return "ACTIVE_CUSTOMER";
}

router.get("/me", async (req, res, next) => {
  try {
    if (!req.tenantId) return res.status(404).json({ error: "No restaurant assigned to this user" });
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.tenantId },
      include: { websiteSettings: true, domains: true, subscriptions: { include: { plan: true } } }
    });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    res.json({ restaurant });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/dashboard", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const [ordersToday, pendingOrders, drivers, sales] = await Promise.all([
      prisma.order.count({ where: { restaurantId, createdAt: { gte: new Date(new Date().toDateString()) } } }),
      prisma.order.count({ where: { restaurantId, status: { in: ["PENDING", "ACCEPTED", "PREPARING", "READY"] } } }),
      prisma.driver.count({ where: { restaurantId, available: true } }),
      prisma.payment.aggregate({ where: { order: { restaurantId } }, _sum: { amountCents: true, driverTipCents: true, restaurantNetCents: true } })
    ]);
    res.json({ ordersToday, pendingOrders, activeDrivers: drivers, sales: sales._sum });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/profile", async (req, res, next) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantIdFor(req) } });
    res.json({ restaurant });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/profile", async (req, res, next) => {
  try {
    const restaurant = await prisma.restaurant.update({ where: { id: restaurantIdFor(req) }, data: req.body });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "restaurant.profile.updated", entityType: "Restaurant", entityId: restaurant.id });
    res.json({ restaurant });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/branding", async (req, res, next) => {
  try {
    const restaurant = await prisma.restaurant.update({
      where: { id: restaurantIdFor(req) },
      data: {
        logoUrl: req.body.logoUrl,
        brandingJson: req.body.brandingJson,
        settingsJson: req.body.settingsJson,
        storeHoursJson: req.body.storeHoursJson,
        phone: req.body.phone,
        email: req.body.email,
        address: req.body.address
      }
    });
    res.json({ restaurant });
  } catch (error) {
    next(error);
  }
});

const categorySchema = z.object({ body: z.object({ name: z.string().min(2), sortOrder: z.number().int().optional(), active: z.boolean().optional() }) });

router.get("/:restaurantId/menu/categories", async (req, res, next) => {
  try {
    const categories = await prisma.menuCategory.findMany({ where: { restaurantId: restaurantIdFor(req) }, include: { items: true }, orderBy: { sortOrder: "asc" } });
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/menu/categories", validate(categorySchema), async (req, res, next) => {
  try {
    const category = await prisma.menuCategory.create({ data: { ...req.body, restaurantId: restaurantIdFor(req) } });
    res.status(201).json({ category });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/menu/categories/:categoryId", async (req, res, next) => {
  try {
    const category = await prisma.menuCategory.update({ where: { id_restaurantId: { id: req.params.categoryId, restaurantId: restaurantIdFor(req) } }, data: req.body });
    res.json({ category });
  } catch (error) {
    next(error);
  }
});

router.delete("/:restaurantId/menu/categories/:categoryId", async (req, res, next) => {
  try {
    await prisma.menuCategory.delete({ where: { id_restaurantId: { id: req.params.categoryId, restaurantId: restaurantIdFor(req) } } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

const menuItemSchema = z.object({
  body: z.object({
    categoryId: z.string(),
    name: z.string().min(2),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    priceCents: z.number().int().nonnegative(),
    preparationTimeMins: z.number().int().positive().default(15),
    available: z.boolean().default(true),
    featured: z.boolean().optional(),
    recommended: z.boolean().optional(),
    isGlutenFree: z.boolean().optional(),
    isVegetarian: z.boolean().optional(),
    isVegan: z.boolean().optional(),
    isSpicy: z.boolean().optional(),
    isDairyFree: z.boolean().optional(),
    isNutFree: z.boolean().optional(),
    options: z.array(z.object({ name: z.string(), priceCents: z.number().int().default(0), required: z.boolean().default(false) })).default([])
  })
});

router.get("/:restaurantId/menu/items", async (req, res, next) => {
  try {
    const items = await prisma.menuItem.findMany({ where: { restaurantId: restaurantIdFor(req) }, include: { category: true, options: true, optionGroups: { include: { options: true } } }, orderBy: { name: "asc" } });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/menu/items", validate(menuItemSchema), async (req, res, next) => {
  try {
    const { options, ...data } = req.body;
    const item = await prisma.menuItem.create({
      data: { ...data, restaurantId: restaurantIdFor(req), options: { create: options } },
      include: { options: true }
    });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/menu/items/:itemId", async (req, res, next) => {
  try {
    const item = await prisma.menuItem.update({ where: { id_restaurantId: { id: req.params.itemId, restaurantId: restaurantIdFor(req) } }, data: req.body });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/menu/items/:itemId/insights", async (req, res, next) => {
  try {
    const item = await prisma.menuItem.update({
      where: { id_restaurantId: { id: req.params.itemId, restaurantId: restaurantIdFor(req) } },
      data: { featured: Boolean(req.body.featured), recommended: Boolean(req.body.recommended) }
    });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.delete("/:restaurantId/menu/items/:itemId", async (req, res, next) => {
  try {
    await prisma.menuItem.delete({ where: { id_restaurantId: { id: req.params.itemId, restaurantId: restaurantIdFor(req) } } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

async function getItemOptionGroups(req, res, next) {
  try {
    const item = await prisma.menuItem.findUnique({ where: { id_restaurantId: { id: req.params.itemId, restaurantId: restaurantIdFor(req) } } });
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    const optionGroups = await prisma.menuItemOptionGroup.findMany({ where: { menuItemId: item.id }, include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } });
    res.json({ optionGroups });
  } catch (error) {
    next(error);
  }
}

async function createItemOptionGroup(req, res, next) {
  try {
    const item = await prisma.menuItem.findUnique({ where: { id_restaurantId: { id: req.params.itemId, restaurantId: restaurantIdFor(req) } } });
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    const { options = [], ...groupData } = req.body;
    const optionGroup = await prisma.menuItemOptionGroup.create({
      data: {
        ...groupData,
        menuItemId: item.id,
        options: { create: options.map((option, index) => ({ ...option, menuItemId: item.id, sortOrder: option.sortOrder ?? index })) }
      },
      include: { options: true }
    });
    res.status(201).json({ optionGroup });
  } catch (error) {
    next(error);
  }
}

async function updateItemOptionGroup(req, res, next) {
  try {
    const item = await prisma.menuItem.findUnique({ where: { id_restaurantId: { id: req.params.itemId, restaurantId: restaurantIdFor(req) } } });
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    const existing = await prisma.menuItemOptionGroup.findFirst({ where: { id: req.params.optionGroupId, menuItemId: item.id } });
    if (!existing) return res.status(404).json({ error: "Option group not found" });
    const { options, ...groupData } = req.body;
    if (options) await prisma.menuItemOption.deleteMany({ where: { optionGroupId: existing.id } });
    const optionGroup = await prisma.menuItemOptionGroup.update({
      where: { id: existing.id },
      data: {
        ...groupData,
        ...(options ? { options: { create: options.map((option, index) => ({ ...option, menuItemId: item.id, sortOrder: option.sortOrder ?? index })) } } : {})
      },
      include: { options: true }
    });
    res.json({ optionGroup });
  } catch (error) {
    next(error);
  }
}

async function deleteItemOptionGroup(req, res, next) {
  try {
    const item = await prisma.menuItem.findUnique({ where: { id_restaurantId: { id: req.params.itemId, restaurantId: restaurantIdFor(req) } } });
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    const existing = await prisma.menuItemOptionGroup.findFirst({ where: { id: req.params.optionGroupId, menuItemId: item.id } });
    if (!existing) return res.status(404).json({ error: "Option group not found" });
    await prisma.menuItemOption.deleteMany({ where: { optionGroupId: existing.id } });
    await prisma.menuItemOptionGroup.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

router.get("/:restaurantId/menu-items/:itemId/options", getItemOptionGroups);
router.post("/:restaurantId/menu-items/:itemId/options", createItemOptionGroup);
router.patch("/:restaurantId/menu-items/:itemId/options/:optionGroupId", updateItemOptionGroup);
router.delete("/:restaurantId/menu-items/:itemId/options/:optionGroupId", deleteItemOptionGroup);
router.get("/menu-items/:itemId/options", getItemOptionGroups);
router.post("/menu-items/:itemId/options", createItemOptionGroup);
router.patch("/menu-items/:itemId/options/:optionGroupId", updateItemOptionGroup);
router.delete("/menu-items/:itemId/options/:optionGroupId", deleteItemOptionGroup);

router.post("/:restaurantId/uploads/image-placeholder", async (req, res) => {
  res.json(await createImageUploadPlaceholder({ fileName: req.body.fileName || "food.jpg", restaurantId: restaurantIdFor(req) }));
});

router.get("/:restaurantId/orders", async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { restaurantId: restaurantIdFor(req) },
      include: { customer: true, items: true, delivery: { include: { driver: { include: { user: true } } } } },
      orderBy: { createdAt: "desc" }
    });
    res.json({ orders });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/orders/:orderId/status", async (req, res, next) => {
  try {
    const order = await prisma.order.update({
      where: { id_restaurantId: { id: req.params.orderId, restaurantId: restaurantIdFor(req) } },
      data: {
        status: req.body.status,
        statusHistory: { create: { status: req.body.status, note: req.body.note, changedBy: req.user.id } }
      },
      include: { statusHistory: true, delivery: true, customer: true, restaurant: true }
    });
    await Promise.allSettled([notifyOrderStatusUpdate({ order })]);
    emitOrderUpdate(order);
    res.json({ order });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/orders/:orderId/assign-driver", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const order = await prisma.order.findUnique({ where: { id_restaurantId: { id: req.params.orderId, restaurantId } }, include: { customer: true, restaurant: true } });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const delivery = await prisma.delivery.upsert({
      where: { orderId: order.id },
      create: {
        restaurantId,
        orderId: order.id,
        driverId: req.body.driverId,
        tipCents: order.tipCents,
        baseEarningsCents: req.body.baseEarningsCents || 500,
        pickupAddress: req.body.pickupAddress || order.restaurant.address || "Restaurant pickup",
        dropoffAddress: order.deliveryAddress || req.body.dropoffAddress || "Customer dropoff",
        statusHistory: { create: { status: "ASSIGNED", changedBy: req.user.id } }
      },
      update: { driverId: req.body.driverId, status: "ASSIGNED", statusHistory: { create: { status: "ASSIGNED", changedBy: req.user.id } } },
      include: { driver: { include: { user: true } }, order: true }
    });
    await Promise.allSettled([notifyDriverAssignment({ delivery })]);
    emitDeliveryUpdate(delivery);
    res.json({ delivery });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/drivers", async (req, res, next) => {
  try {
    const drivers = await prisma.driver.findMany({ where: { restaurantId: restaurantIdFor(req) }, include: { user: true, deliveries: true } });
    res.json({ drivers });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/drivers", async (req, res, next) => {
  try {
    const passwordHash = await bcrypt.hash(req.body.password || "Driver123!", 12);
    const user = await prisma.user.create({
      data: { email: req.body.email, name: req.body.name, phone: req.body.phone, passwordHash, role: "DRIVER", restaurantId: restaurantIdFor(req) }
    });
    const driver = await prisma.driver.create({ data: { restaurantId: restaurantIdFor(req), userId: user.id } });
    await Promise.allSettled([notifyWelcomeEmail({ user })]);
    res.status(201).json({ driver });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/staff", async (req, res, next) => {
  try {
    const staff = await prisma.restaurantStaff.findMany({ where: { restaurantId: restaurantIdFor(req) }, include: { user: true } });
    res.json({ staff });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/staff", async (req, res, next) => {
  try {
    const passwordHash = await bcrypt.hash(req.body.password || "Staff123!", 12);
    const user = await prisma.user.create({
      data: { email: req.body.email, name: req.body.name, passwordHash, role: req.body.role, restaurantId: restaurantIdFor(req) }
    });
    const staff = await prisma.restaurantStaff.create({ data: { restaurantId: restaurantIdFor(req), userId: user.id, role: req.body.role } });
    await Promise.allSettled([notifyWelcomeEmail({ user })]);
    res.status(201).json({ staff });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/customers", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const search = req.query.search?.toString();
    const customers = await prisma.customer.findMany({
      where: {
        restaurantId,
        ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }, { phone: { contains: search, mode: "insensitive" } }] } : {})
      },
      include: { orders: { include: { items: true }, orderBy: { createdAt: "desc" } }, loyaltyPoints: true },
      orderBy: { updatedAt: "desc" }
    });
    const enriched = customers.map((customer) => {
      const totalOrders = customer.orders.length;
      const lifetimeSpendCents = centsTotal(customer.orders);
      const itemCounts = new Map();
      customer.orders.forEach((order) => order.items.forEach((item) => itemCounts.set(item.name, (itemCounts.get(item.name) || 0) + item.quantity)));
      const favoriteMenuItems = [...itemCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, quantity]) => ({ name, quantity }));
      return {
        ...customer,
        segment: customer.segment || segmentForCustomer(customer),
        totalOrders,
        lifetimeSpendCents,
        averageOrderValueCents: totalOrders ? Math.round(lifetimeSpendCents / totalOrders) : 0,
        lastOrderDate: customer.orders[0]?.createdAt || null,
        favoriteMenuItems,
        loyaltyPointBalance: customer.loyaltyPoints.reduce((sum, point) => sum + point.points, 0)
      };
    });
    res.json({ customers: enriched });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/customers/summary", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [customers, repeatCustomers, vipCustomers] = await Promise.all([
      prisma.customer.count({ where: { restaurantId } }),
      prisma.customer.count({ where: { restaurantId, orders: { some: {} } } }),
      prisma.customer.count({ where: { restaurantId, segment: "VIP_CUSTOMER" } })
    ]);
    const newCustomersThisMonth = await prisma.customer.count({ where: { restaurantId, createdAt: { gte: monthStart } } });
    res.json({ totalCustomers: customers, newCustomersThisMonth, repeatCustomerPercentage: customers ? Math.round((repeatCustomers / customers) * 100) : 0, vipCustomerCount: vipCustomers });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/customers/:customerId", async (req, res, next) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.customerId, restaurantId: restaurantIdFor(req) },
      include: { orders: { include: { items: true }, orderBy: { createdAt: "desc" } }, loyaltyPoints: true }
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json({ customer });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/customers/:customerId/notes", async (req, res, next) => {
  try {
    const existing = await prisma.customer.findFirst({ where: { id: req.params.customerId, restaurantId: restaurantIdFor(req) } });
    if (!existing) return res.status(404).json({ error: "Customer not found" });
    const customer = await prisma.customer.update({ where: { id: req.params.customerId }, data: { notes: req.body.notes, segment: req.body.segment } });
    res.json({ customer });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/coupons", async (req, res, next) => {
  try {
    const coupons = await prisma.coupon.findMany({ where: { restaurantId: restaurantIdFor(req) } });
    res.json({ coupons });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/coupons", async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.create({ data: { ...req.body, restaurantId: restaurantIdFor(req) } });
    res.status(201).json({ coupon });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/promotions/analytics", async (req, res, next) => {
  try {
    const coupons = await prisma.coupon.findMany({ where: { restaurantId: restaurantIdFor(req) } });
    res.json({ activePromotions: coupons.filter((coupon) => coupon.active), redemptionStatistics: coupons.map((coupon) => ({ code: coupon.code, redeemedCount: coupon.redeemedCount, usageLimit: coupon.usageLimit })) });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/loyalty", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const [restaurant, rewards, points] = await Promise.all([
      prisma.restaurant.findUnique({ where: { id: restaurantId } }),
      prisma.loyaltyReward.findMany({ where: { restaurantId, active: true } }),
      prisma.loyaltyPoint.findMany({ where: { restaurantId }, include: { customer: true } })
    ]);
    const pointsIssued = points.filter((point) => point.points > 0).reduce((sum, point) => sum + point.points, 0);
    const pointsRedeemed = Math.abs(points.filter((point) => point.points < 0).reduce((sum, point) => sum + point.points, 0));
    const byCustomer = new Map();
    points.forEach((point) => byCustomer.set(point.customerId, { customer: point.customer, points: (byCustomer.get(point.customerId)?.points || 0) + point.points }));
    res.json({ settings: restaurant?.loyaltySettingsJson || { pointsPerDollar: 1, welcomeBonus: 100, birthdayRewardsPlaceholder: true, referralRewardPlaceholder: true }, rewards, analytics: { pointsIssued, pointsRedeemed, topCustomers: [...byCustomer.values()].sort((a, b) => b.points - a.points).slice(0, 5) } });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/loyalty/settings", async (req, res, next) => {
  try {
    const restaurant = await prisma.restaurant.update({ where: { id: restaurantIdFor(req) }, data: { loyaltySettingsJson: req.body } });
    res.json({ settings: restaurant.loyaltySettingsJson });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/loyalty/rewards", async (req, res, next) => {
  try {
    const reward = await prisma.loyaltyReward.create({ data: { ...req.body, restaurantId: restaurantIdFor(req) } });
    res.status(201).json({ reward });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/reports/sales", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const [orders, payments] = await Promise.all([
      prisma.order.groupBy({ by: ["status"], where: { restaurantId }, _count: true, _sum: { totalCents: true, tipCents: true } }),
      prisma.payment.aggregate({ where: { order: { restaurantId } }, _sum: { amountCents: true, restaurantNetCents: true, driverTipCents: true, technologyFeeCents: true } })
    ]);
    res.json({ orders, payments: payments._sum });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/analytics", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const orders = await prisma.order.findMany({ where: { restaurantId }, include: { items: true }, orderBy: { createdAt: "asc" } });
    const delivered = orders.filter((order) => order.status !== "CANCELLED");
    const totalRevenueCents = centsTotal(delivered);
    const byDay = new Map();
    const itemStats = new Map();
    delivered.forEach((order) => {
      const day = order.createdAt.toISOString().slice(0, 10);
      byDay.set(day, { date: day, salesCents: (byDay.get(day)?.salesCents || 0) + order.totalCents, orders: (byDay.get(day)?.orders || 0) + 1 });
      order.items.forEach((item) => {
        const current = itemStats.get(item.menuItemId) || { name: item.name, quantity: 0, revenueCents: 0 };
        current.quantity += item.quantity;
        current.revenueCents += item.quantity * item.unitPriceCents;
        itemStats.set(item.menuItemId, current);
      });
    });
    res.json({
      metrics: {
        totalOrders: delivered.length,
        totalRevenueCents,
        averageOrderValueCents: delivered.length ? Math.round(totalRevenueCents / delivered.length) : 0,
        deliveryOrders: delivered.filter((order) => order.type === "DELIVERY").length,
        pickupOrders: delivered.filter((order) => order.type === "PICKUP").length,
        driverTipsCents: delivered.reduce((sum, order) => sum + order.tipCents, 0)
      },
      charts: { salesTrend: [...byDay.values()], ordersTrend: [...byDay.values()], customerGrowth: [], loyaltyGrowth: [] },
      popularItems: [...itemStats.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/menu/insights", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const items = await prisma.orderItem.findMany({ where: { order: { restaurantId } }, include: { menuItem: { include: { category: true } } } });
    const byItem = new Map();
    const byCategory = new Map();
    items.forEach((item) => {
      const current = byItem.get(item.menuItemId) || { id: item.menuItemId, name: item.name, quantity: 0, revenueCents: 0, featured: item.menuItem.featured, recommended: item.menuItem.recommended };
      current.quantity += item.quantity;
      current.revenueCents += item.quantity * item.unitPriceCents;
      byItem.set(item.menuItemId, current);
      const categoryName = item.menuItem.category.name;
      byCategory.set(categoryName, (byCategory.get(categoryName) || 0) + item.quantity * item.unitPriceCents);
    });
    const itemRows = [...byItem.values()].map((item) => ({ ...item, averageQuantitySold: item.quantity }));
    res.json({ bestSellingItems: [...itemRows].sort((a, b) => b.quantity - a.quantity).slice(0, 10), worstSellingItems: [...itemRows].sort((a, b) => a.quantity - b.quantity).slice(0, 10), revenuePerItem: itemRows, mostProfitableCategories: [...byCategory.entries()].map(([name, revenueCents]) => ({ name, revenueCents })).sort((a, b) => b.revenueCents - a.revenueCents) });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/locations", async (req, res, next) => {
  try {
    const locations = await prisma.restaurantLocation.findMany({ where: { restaurantId: restaurantIdFor(req) } });
    res.json({ locations });
  } catch (error) {
    next(error);
  }
});

async function getWebsite(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantIdFor(req) } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const website = await ensureWebsiteSettings(restaurant);
    res.json({ website });
  } catch (error) {
    next(error);
  }
}

async function updateWebsite(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const website = await prisma.restaurantWebsiteSettings.upsert({
      where: { restaurantId },
      update: req.body,
      create: { ...req.body, restaurantId }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "website.updated", entityType: "RestaurantWebsiteSettings", entityId: website.id });
    res.json({ website });
  } catch (error) {
    next(error);
  }
}

async function getDomain(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantIdFor(req) } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const domain = await ensureDomain(restaurant);
    res.json({ domain, instructions: `Point your CNAME record to: ${DNS_TARGET}` });
  } catch (error) {
    next(error);
  }
}

async function updateDomain(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantIdFor(req) } });
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
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "domain.updated", entityType: "RestaurantDomain", entityId: domain.id });
    res.json({ domain, instructions: `Point your CNAME record to: ${DNS_TARGET}` });
  } catch (error) {
    next(error);
  }
}

async function getGallery(req, res, next) {
  try {
    const gallery = await prisma.restaurantGalleryImage.findMany({ where: { restaurantId: restaurantIdFor(req) }, orderBy: { sortOrder: "asc" } });
    res.json({ gallery });
  } catch (error) {
    next(error);
  }
}

async function addGalleryImage(req, res, next) {
  try {
    const image = await prisma.restaurantGalleryImage.create({ data: { ...req.body, category: req.body.category || "food", restaurantId: restaurantIdFor(req) } });
    res.status(201).json({ image });
  } catch (error) {
    next(error);
  }
}

async function deleteGalleryImage(req, res, next) {
  try {
    const existing = await prisma.restaurantGalleryImage.findFirst({ where: { id: req.params.id, restaurantId: restaurantIdFor(req) } });
    if (!existing) return res.status(404).json({ error: "Gallery image not found" });
    await prisma.restaurantGalleryImage.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

async function getSocialLinks(req, res, next) {
  try {
    const socialLinks = await prisma.restaurantSocialLink.findMany({ where: { restaurantId: restaurantIdFor(req) }, orderBy: { createdAt: "asc" } });
    res.json({ socialLinks });
  } catch (error) {
    next(error);
  }
}

async function addSocialLink(req, res, next) {
  try {
    const socialLink = await prisma.restaurantSocialLink.create({ data: { ...req.body, restaurantId: restaurantIdFor(req) } });
    res.status(201).json({ socialLink });
  } catch (error) {
    next(error);
  }
}

async function deleteSocialLink(req, res, next) {
  try {
    const existing = await prisma.restaurantSocialLink.findFirst({ where: { id: req.params.id, restaurantId: restaurantIdFor(req) } });
    if (!existing) return res.status(404).json({ error: "Social link not found" });
    await prisma.restaurantSocialLink.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

router.get("/website", getWebsite);
router.patch("/website", updateWebsite);
router.get("/domain", getDomain);
router.patch("/domain", updateDomain);
router.get("/gallery", getGallery);
router.post("/gallery", addGalleryImage);
router.delete("/gallery/:id", deleteGalleryImage);
router.get("/social-links", getSocialLinks);
router.post("/social-links", addSocialLink);
router.delete("/social-links/:id", deleteSocialLink);
router.get("/:restaurantId/website", getWebsite);
router.patch("/:restaurantId/website", updateWebsite);
router.get("/:restaurantId/domain", getDomain);
router.patch("/:restaurantId/domain", updateDomain);
router.get("/:restaurantId/gallery", getGallery);
router.post("/:restaurantId/gallery", addGalleryImage);
router.delete("/:restaurantId/gallery/:id", deleteGalleryImage);
router.get("/:restaurantId/social-links", getSocialLinks);
router.post("/:restaurantId/social-links", addSocialLink);
router.delete("/:restaurantId/social-links/:id", deleteSocialLink);

export default router;

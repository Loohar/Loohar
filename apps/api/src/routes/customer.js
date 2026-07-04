import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createCheckoutSession } from "../services/paymentService.js";

const router = Router();

router.get("/restaurants/:slug", async (req, res, next) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug: req.params.slug },
      include: {
        categories: {
          where: { active: true },
          include: { items: { where: { available: true }, include: { options: true } } },
          orderBy: { sortOrder: "asc" }
        }
      }
    });
    if (!restaurant || restaurant.status !== "ACTIVE") return res.status(404).json({ error: "Business not found" });
    const orderingEnabled = ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK"].includes(restaurant.businessType);
    const placeholder = orderingEnabled
      ? null
      : { module: "FOOD_CATALOG", message: "Food retail catalog ordering is planned for this tenant type. Restaurant ordering remains the complete workflow now." };
    res.json({ restaurant: orderingEnabled ? restaurant : { ...restaurant, categories: [] }, orderingEnabled, placeholder });
  } catch (error) {
    next(error);
  }
});

router.get("/sites/:slug", async (req, res, next) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug: req.params.slug },
      include: {
        categories: {
          where: { active: true },
          include: { items: { where: { available: true }, include: { options: true } } },
          orderBy: { sortOrder: "asc" }
        }
      }
    });
    if (!restaurant || restaurant.status !== "ACTIVE") return res.status(404).json({ error: "Business not found" });
    const orderingEnabled = ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK"].includes(restaurant.businessType);
    const placeholder = orderingEnabled
      ? null
      : { module: "FOOD_CATALOG", message: "Food retail catalog ordering is planned for this tenant type. Restaurant ordering remains the complete workflow now." };
    res.json({ restaurant: orderingEnabled ? restaurant : { ...restaurant, categories: [] }, orderingEnabled, placeholder });
  } catch (error) {
    next(error);
  }
});

export const createOrderSchema = z.object({
  body: z.object({
    restaurantId: z.string(),
    customer: z.object({
      name: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional()
    }),
    type: z.enum(["PICKUP", "DELIVERY"]),
    deliveryAddress: z.string().optional(),
    tipCents: z.number().int().nonnegative().default(0),
    couponCode: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(z.object({
      menuItemId: z.string(),
      quantity: z.number().int().positive(),
      options: z.array(z.object({ name: z.string(), priceCents: z.number().int() })).default([])
    })).min(1)
  })
});

export async function attachRestaurantIdBySlug(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { slug: req.params.slug }, select: { id: true, status: true } });
    if (!restaurant || restaurant.status !== "ACTIVE") return res.status(404).json({ error: "Restaurant unavailable" });
    req.body.restaurantId = restaurant.id;
    next();
  } catch (error) {
    next(error);
  }
}

export async function createOrder(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.body.restaurantId } });
    if (!restaurant || restaurant.status !== "ACTIVE") return res.status(404).json({ error: "Restaurant unavailable" });
    if (!["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK"].includes(restaurant.businessType)) {
      return res.status(400).json({ error: "Online ordering is not enabled for this business type yet" });
    }

    const menuItems = await prisma.menuItem.findMany({
      where: { restaurantId: restaurant.id, id: { in: req.body.items.map((item) => item.menuItemId) }, available: true }
    });
    const menuById = new Map(menuItems.map((item) => [item.id, item]));
    const missingItems = req.body.items.filter((item) => !menuById.has(item.menuItemId));
    if (missingItems.length > 0) return res.status(400).json({ error: "One or more menu items are unavailable" });
    const subtotalCents = req.body.items.reduce((total, item) => {
      const menuItem = menuById.get(item.menuItemId);
      if (!menuItem) return total;
      const optionsTotal = item.options.reduce((sum, option) => sum + option.priceCents, 0);
      return total + (menuItem.priceCents + optionsTotal) * item.quantity;
    }, 0);

    let discountCents = 0;
    let coupon = null;
    if (req.body.couponCode) {
      const now = new Date();
      coupon = await prisma.coupon.findFirst({
        where: {
          restaurantId: restaurant.id,
          code: req.body.couponCode.trim().toUpperCase(),
          active: true,
          OR: [{ startsAt: null }, { startsAt: { lte: now } }],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }]
        }
      });
      if (!coupon) return res.status(400).json({ error: "Coupon is not valid" });
      if (coupon.usageLimit && coupon.redeemedCount >= coupon.usageLimit) return res.status(400).json({ error: "Coupon usage limit reached" });
      if (coupon.minimumOrderAmountCents && subtotalCents < coupon.minimumOrderAmountCents) return res.status(400).json({ error: "Order does not meet coupon minimum" });
      if (coupon.percentOff) discountCents += Math.round(subtotalCents * (coupon.percentOff / 100));
      if (coupon.amountOffCents) discountCents += coupon.amountOffCents;
    }
    const deliveryFeeCents = req.body.type === "DELIVERY" ? restaurant.deliveryFeeCents : 0;
    const freeDelivery = Boolean(coupon?.freeDelivery || coupon?.type === "FREE_DELIVERY");
    const effectiveDeliveryFeeCents = freeDelivery ? 0 : deliveryFeeCents;
    const taxCents = Math.round(subtotalCents * 0.0825);
    const totalCents = Math.max(0, subtotalCents - discountCents) + effectiveDeliveryFeeCents + taxCents + req.body.tipCents;
    const orderNumber = `${Date.now().toString().slice(-6)}`;

    const order = await prisma.order.create({
      data: {
        restaurantId: restaurant.id,
        orderNumber,
        type: req.body.type,
        deliveryAddress: req.body.deliveryAddress,
        notes: req.body.notes,
        subtotalCents,
        discountCents,
        couponCode: coupon?.code || null,
        deliveryFeeCents: effectiveDeliveryFeeCents,
        taxCents,
        tipCents: req.body.tipCents,
        totalCents,
        customer: {
          connectOrCreate: {
            where: { restaurantId_email: { restaurantId: restaurant.id, email: req.body.customer.email } },
            create: { ...req.body.customer, restaurantId: restaurant.id, defaultAddress: req.body.deliveryAddress }
          }
        },
        items: {
          create: req.body.items.map((item) => {
            const menuItem = menuById.get(item.menuItemId);
            return {
              menuItemId: item.menuItemId,
              name: menuItem.name,
              quantity: item.quantity,
              unitPriceCents: menuItem.priceCents,
              optionsJson: item.options
            };
          })
        },
        statusHistory: { create: { status: "PENDING", note: "Order placed by customer" } }
      },
      include: { items: true, customer: true, statusHistory: true }
    });

    const checkout = await createCheckoutSession({ order });
    const { checkoutUrl, publishableKey, ...paymentData } = checkout;
    const payment = await prisma.payment.create({ data: { orderId: order.id, ...paymentData } });
    res.status(201).json({ order, payment, checkoutUrl, publishableKey });
  } catch (error) {
    next(error);
  }
}

router.post("/orders", validate(createOrderSchema), createOrder);
router.post("/sites/:slug/orders", attachRestaurantIdBySlug, validate(createOrderSchema), createOrder);

export async function getOrderStatus(req, res, next) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: { restaurant: true, customer: true, items: true, statusHistory: true, delivery: { include: { statusHistory: true, driver: { include: { user: true } } } } }
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (req.params.slug && order.restaurant.slug !== req.params.slug) return res.status(404).json({ error: "Order not found" });
    res.json({ order });
  } catch (error) {
    next(error);
  }
}

router.get("/orders/:orderId/status", getOrderStatus);
router.get("/sites/:slug/orders/:orderId/status", getOrderStatus);

router.use(requireAuth, requireRole("CUSTOMER"));

router.get("/me/orders", async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { customer: { userId: req.user.id } },
      include: { restaurant: true, items: true, delivery: true },
      orderBy: { createdAt: "desc" }
    });
    res.json({ orders });
  } catch (error) {
    next(error);
  }
});

router.get("/me/loyalty", async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { userId: req.user.id },
      include: { restaurant: { include: { loyaltyRewards: true } }, loyaltyPoints: { orderBy: { createdAt: "desc" } } }
    });
    const programs = customers.map((customer) => ({
      restaurant: customer.restaurant,
      currentPoints: customer.loyaltyPoints.reduce((sum, point) => sum + point.points, 0),
      availableRewards: customer.restaurant.loyaltyRewards,
      rewardHistory: customer.loyaltyPoints
    }));
    res.json({ programs });
  } catch (error) {
    next(error);
  }
});

router.patch("/me/favorites", async (req, res, next) => {
  try {
    const customer = await prisma.customer.findFirst({ where: { userId: req.user.id, restaurantId: req.body.restaurantId } });
    if (!customer) return res.status(404).json({ error: "Customer profile not found" });
    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: { favoriteOrdersJson: req.body.favoriteOrdersJson, favoriteItemsJson: req.body.favoriteItemsJson }
    });
    res.json({ customer: updated });
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:orderId/reorder", async (req, res, next) => {
  try {
    const previous = await prisma.order.findFirst({
      where: { id: req.params.orderId, customer: { userId: req.user.id } },
      include: { items: true, customer: true }
    });
    if (!previous) return res.status(404).json({ error: "Order not found" });
    res.json({ reorderDraft: { restaurantId: previous.restaurantId, type: previous.type, items: previous.items } });
  } catch (error) {
    next(error);
  }
});

export default router;

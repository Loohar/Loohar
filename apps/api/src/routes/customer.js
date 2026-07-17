import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { findOrderForTracking, limitedTrackingOrder } from "../services/orderWorkflowService.js";
import { createOrderPayment } from "../modules/orderPayments/orderPaymentService.js";

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
    const moduleNotice = orderingEnabled
      ? null
      : { module: "FOOD_CATALOG", message: "Food retail catalog ordering is planned for this tenant type. Restaurant ordering remains the complete workflow now." };
    res.json({ restaurant: orderingEnabled ? restaurant : { ...restaurant, categories: [] }, orderingEnabled, moduleNotice });
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
    const moduleNotice = orderingEnabled
      ? null
      : { module: "FOOD_CATALOG", message: "Food retail catalog ordering is planned for this tenant type. Restaurant ordering remains the complete workflow now." };
    res.json({ restaurant: orderingEnabled ? restaurant : { ...restaurant, categories: [] }, orderingEnabled, moduleNotice });
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
    restaurantTipCents: z.number().int().nonnegative().optional(),
    driverTipCents: z.number().int().nonnegative().optional(),
    customTipCents: z.number().int().nonnegative().optional(),
    tipPercentage: z.number().int().min(0).max(100).optional(),
    tipType: z.string().optional(),
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
    res.status(201).json(await createOrderPayment({ body: req.body }));
  } catch (error) {
    next(error);
  }
}

router.post("/orders", validate(createOrderSchema), createOrder);
router.post("/sites/:slug/orders", attachRestaurantIdBySlug, validate(createOrderSchema), createOrder);

export async function getOrderStatus(req, res, next) {
  try {
    const token = req.query.token?.toString();
    if (token) {
      const tracked = await findOrderForTracking(req.params.orderId, token);
      if (!tracked) return res.status(403).json({ error: "Invalid or expired tracking token" });
      if (req.params.slug && tracked.restaurant.slug !== req.params.slug) return res.status(404).json({ error: "Order not found" });
      return res.json({ order: limitedTrackingOrder(tracked) });
    }
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: { restaurant: true, customer: true, items: true, statusHistory: true, delivery: { include: { statusHistory: true, driver: { include: { user: true } } } } }
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (req.params.slug && order.restaurant.slug !== req.params.slug) return res.status(404).json({ error: "Order not found" });
    res.json({ order: limitedTrackingOrder(order) });
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

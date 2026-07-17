import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createMerchantOnboardingLink, createOrderPayment, getMerchantAccount, receiptForOrder, refundOrderPayment, statusForOrder } from "../modules/orderPayments/orderPaymentService.js";
import { calculateOrderQuote } from "../modules/orderPayments/quoteService.js";

const router = Router();

const orderItemSchema = z.object({
  menuItemId: z.string(),
  quantity: z.number().int().positive(),
  options: z.array(z.object({ name: z.string(), priceCents: z.number().int() })).default([])
});

const quoteSchema = z.object({
  body: z.object({
    restaurantId: z.string(),
    type: z.enum(["PICKUP", "DELIVERY"]),
    couponCode: z.string().optional(),
    tipCents: z.number().int().nonnegative().default(0),
    restaurantTipCents: z.number().int().nonnegative().optional(),
    driverTipCents: z.number().int().nonnegative().optional(),
    customTipCents: z.number().int().nonnegative().optional(),
    tipPercentage: z.number().int().min(0).max(100).optional(),
    tipType: z.string().optional(),
    serviceFeeCents: z.number().int().nonnegative().optional(),
    items: z.array(orderItemSchema).min(1)
  })
});

const createSchema = z.object({
  body: quoteSchema.shape.body.extend({
    customer: z.object({
      name: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional()
    }),
    deliveryAddress: z.string().optional(),
    notes: z.string().optional()
  })
});

const refundSchema = z.object({
  body: z.object({
    orderId: z.string(),
    amountCents: z.number().int().positive().optional(),
    reason: z.string().optional()
  })
});

router.post("/quote", validate(quoteSchema), async (req, res, next) => {
  try {
    const quote = await calculateOrderQuote({ restaurantId: req.body.restaurantId, body: req.body });
    const { restaurant, coupon, ...safeQuote } = quote;
    res.json({ quote: safeQuote });
  } catch (error) {
    next(error);
  }
});

router.post("/create", validate(createSchema), async (req, res, next) => {
  try {
    const result = await createOrderPayment({ body: req.body });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/confirm", async (req, res) => {
  res.status(202).json({ status: "provider_confirmed", message: "Client-side provider confirmation is handled by Stripe.js or Authorize.Net Accept.js; server confirmation is completed by signed webhooks." });
});

router.get("/merchant-account", requireAuth, requireRole("TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"), async (req, res, next) => {
  try {
    res.json(await getMerchantAccount({ user: req.user }));
  } catch (error) {
    next(error);
  }
});

router.post("/merchant-account/onboarding-link", requireAuth, requireRole("TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"), async (req, res, next) => {
  try {
    res.status(201).json(await createMerchantOnboardingLink({ user: req.user }));
  } catch (error) {
    next(error);
  }
});

router.post("/refund", requireAuth, requireRole("SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"), validate(refundSchema), async (req, res, next) => {
  try {
    const refund = await refundOrderPayment({ orderId: req.body.orderId, amountCents: req.body.amountCents, reason: req.body.reason, user: req.user });
    res.status(201).json({ refund });
  } catch (error) {
    next(error);
  }
});

router.get("/:orderId/status", async (req, res, next) => {
  try {
    res.json(await statusForOrder({ orderId: req.params.orderId }));
  } catch (error) {
    next(error);
  }
});

router.get("/:orderId/receipt", async (req, res, next) => {
  try {
    res.json(await receiptForOrder({ orderId: req.params.orderId }));
  } catch (error) {
    next(error);
  }
});

export default router;

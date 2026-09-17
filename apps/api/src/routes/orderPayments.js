import { Router } from "express";
import { z } from "zod";
import { FEATURE } from "../config/entitlements.js";
import { authenticateAccessToken, requireAuth, requireRole } from "../middleware/auth.js";
import { assertFeatureForRestaurant, featureGuard } from "../middleware/entitlements.js";
import { validate } from "../middleware/validate.js";
import { createMerchantOnboardingLink, createOrderPayment, getMerchantAccount, publicReceiptForOrder, publicStatusForOrder, receiptForOrder, refundOrderPayment, statusForOrder } from "../modules/orderPayments/orderPaymentService.js";
import { CHECKOUT_IDEMPOTENCY_HEADER } from "../modules/orderPayments/checkoutIdempotency.js";
import { calculateOrderQuote } from "../modules/orderPayments/quoteService.js";

const router = Router();

const modifierSelectionSchema = z.object({
  modifierGroupId: z.string().optional(),
  groupId: z.string().optional(),
  optionGroupId: z.string().optional(),
  modifierOptionId: z.string().optional(),
  optionId: z.string().optional(),
  id: z.string().optional(),
  optionIds: z.array(z.string()).optional(),
  name: z.string().optional(),
  group: z.string().optional(),
  priceCents: z.number().int().optional()
});

const orderItemSchema = z.object({
  menuItemId: z.string().max(64),
  quantity: z.number().int().positive().max(99),
  modifierSelections: z.array(modifierSelectionSchema).optional(),
  selectedModifiers: z.array(modifierSelectionSchema).optional(),
  modifierOptionIds: z.array(z.string()).optional(),
  optionIds: z.array(z.string()).optional(),
  options: z.array(modifierSelectionSchema).default([])
});

const quoteSchema = z.object({
  body: z.object({
    restaurantId: z.string(),
    locationId: z.string().optional(),
    type: z.enum(["PICKUP", "DELIVERY"]),
    couponCode: z.string().max(40).optional(),
    tipCents: z.number().int().nonnegative().default(0),
    restaurantTipCents: z.number().int().nonnegative().optional(),
    driverTipCents: z.number().int().nonnegative().optional(),
    customTipCents: z.number().int().nonnegative().optional(),
    tipPercentage: z.number().int().min(0).max(100).optional(),
    tipType: z.string().optional(),
    items: z.array(orderItemSchema).min(1).max(100)
  })
});

const createSchema = z.object({
  body: quoteSchema.shape.body.extend({
    customer: z.object({
      name: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional()
    }),
    deliveryAddress: z.string().max(300).optional(),
    notes: z.string().max(500).optional()
  })
});

const refundSchema = z.object({
  body: z.object({
    orderId: z.string(),
    amountCents: z.number().int().positive().optional(),
    reason: z.string().max(200).optional()
  })
});

async function assertOrderPaymentEntitlements(req) {
  await assertFeatureForRestaurant({ restaurantId: req.body.restaurantId, feature: FEATURE.ORDER_PAYMENTS, method: req.method });
  await assertFeatureForRestaurant({ restaurantId: req.body.restaurantId, feature: req.body.type === "DELIVERY" ? FEATURE.DELIVERY : FEATURE.PICKUP, method: req.method });
  if (req.body.couponCode) {
    await assertFeatureForRestaurant({ restaurantId: req.body.restaurantId, feature: FEATURE.COUPONS, method: req.method });
  }
}

function bearerTokenFor(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function trackingTokenFor(req) {
  const headerToken = req.headers["x-loohar-order-token"] || req.headers["x-loohar-tracking-token"] || "";
  return req.query.token?.toString() || (Array.isArray(headerToken) ? headerToken[0] : headerToken);
}

async function orderPaymentAccessFor(req) {
  const trackingToken = trackingTokenFor(req);
  if (trackingToken) return { user: null, trackingToken };
  const bearerToken = bearerTokenFor(req);
  if (!bearerToken) return { user: null, trackingToken };
  return { user: await authenticateAccessToken(bearerToken), trackingToken };
}

router.post("/quote", validate(quoteSchema), async (req, res, next) => {
  try {
    await assertOrderPaymentEntitlements(req);
    const quote = await calculateOrderQuote({ restaurantId: req.body.restaurantId, body: req.body });
    const { restaurant, coupon, taxConfiguration, ...safeQuote } = quote;
    res.json({ quote: {
      ...safeQuote,
      taxConfiguration: {
        provider: taxConfiguration.provider,
        source: taxConfiguration.source,
        jurisdictionCode: taxConfiguration.jurisdictionCode,
        taxInclusive: taxConfiguration.taxInclusive,
        configurationVersion: taxConfiguration.configurationVersion,
        effectiveAt: taxConfiguration.effectiveAt,
        verifiedAt: taxConfiguration.verifiedAt
      }
    } });
  } catch (error) {
    next(error);
  }
});

router.post("/create", validate(createSchema), async (req, res, next) => {
  try {
    await assertOrderPaymentEntitlements(req);
    const result = await createOrderPayment({ body: req.body, idempotencyKey: req.get(CHECKOUT_IDEMPOTENCY_HEADER) });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/confirm", async (req, res) => {
  res.status(202).json({ status: "provider_confirmed", message: "Client-side provider confirmation is handled by Stripe.js or Authorize.Net Accept.js; server confirmation is completed by signed webhooks." });
});

router.get("/merchant-account", requireAuth, requireRole("TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"), featureGuard(FEATURE.ORDER_PAYMENTS), async (req, res, next) => {
  try {
    res.json(await getMerchantAccount({ user: req.user }));
  } catch (error) {
    next(error);
  }
});

router.post("/merchant-account/onboarding-link", requireAuth, requireRole("TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"), featureGuard(FEATURE.ORDER_PAYMENTS), async (req, res, next) => {
  try {
    res.status(201).json(await createMerchantOnboardingLink({ user: req.user }));
  } catch (error) {
    next(error);
  }
});

router.post("/refund", requireAuth, requireRole("SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"), featureGuard(FEATURE.ORDER_PAYMENTS), validate(refundSchema), async (req, res, next) => {
  try {
    const refund = await refundOrderPayment({ orderId: req.body.orderId, amountCents: req.body.amountCents, reason: req.body.reason, user: req.user, idempotencyKey: req.get(CHECKOUT_IDEMPOTENCY_HEADER) });
    res.status(201).json({ refund });
  } catch (error) {
    next(error);
  }
});

router.get("/:orderId/status", async (req, res, next) => {
  try {
    const access = await orderPaymentAccessFor(req);
    const payload = access.user
      ? await statusForOrder({ orderId: req.params.orderId, user: access.user })
      : await publicStatusForOrder({ orderId: req.params.orderId, token: access.trackingToken });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get("/:orderId/receipt", async (req, res, next) => {
  try {
    const access = await orderPaymentAccessFor(req);
    const payload = access.user
      ? await receiptForOrder({ orderId: req.params.orderId, user: access.user })
      : await publicReceiptForOrder({ orderId: req.params.orderId, token: access.trackingToken });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

export default router;

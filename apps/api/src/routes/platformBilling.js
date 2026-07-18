import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { cancelPlatformSubscription, createPlatformCheckout, createPlatformPortal, getPlatformSubscription } from "../modules/platformBilling/platformBillingService.js";

const router = Router();

const checkoutSchema = z.object({
  body: z.object({
    registrationId: z.string().optional(),
    ownerEmail: z.string().email().optional(),
    ownerName: z.string().optional(),
    businessName: z.string().min(2).optional(),
    publicBusinessName: z.string().optional(),
    slug: z.string().optional(),
    businessType: z.string().default("RESTAURANT"),
    planCode: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]).optional(),
    plan: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]).optional(),
    billingInterval: z.enum(["MONTHLY", "ANNUAL"]).optional()
  }).passthrough().refine((body) => body.registrationId || (body.ownerEmail && body.businessName), {
    message: "registrationId or ownerEmail and businessName are required."
  })
});

const changePlanSchema = z.object({
  body: z.object({
    planCode: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"])
  })
});

router.post("/checkout", validate(checkoutSchema), async (req, res, next) => {
  try {
    const result = await createPlatformCheckout({ body: req.body, user: req.user });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth);

router.post("/portal", requireRole("TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "SUPER_ADMIN"), async (req, res, next) => {
  try {
    res.json(await createPlatformPortal({ user: req.user }));
  } catch (error) {
    next(error);
  }
});

router.post("/change-plan", requireRole("TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "SUPER_ADMIN"), validate(changePlanSchema), async (req, res, next) => {
  try {
    res.status(501).json({ error: "Plan changes are provider-hosted in the billing portal for this phase.", requestedPlan: req.body.planCode });
  } catch (error) {
    next(error);
  }
});

router.post("/cancel", requireRole("TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "SUPER_ADMIN"), async (req, res, next) => {
  try {
    res.json(await cancelPlatformSubscription({ user: req.user }));
  } catch (error) {
    next(error);
  }
});

router.get("/subscription", requireRole("TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "SUPER_ADMIN"), async (req, res, next) => {
  try {
    res.json(await getPlatformSubscription({ user: req.user }));
  } catch (error) {
    next(error);
  }
});

router.get("/invoices", requireRole("TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "SUPER_ADMIN"), async (req, res, next) => {
  try {
    const { subscription } = await getPlatformSubscription({ user: req.user });
    res.json({ invoices: subscription?.invoices || [] });
  } catch (error) {
    next(error);
  }
});

export default router;

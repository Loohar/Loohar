import rateLimit from "express-rate-limit";
import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { strongPasswordSchema } from "../utils/authSecurity.js";
import { cancelRegistration, checkRegistrationSlug, createRegistrationCheckout, getRegistrationStatus, listRegistrationPlans, startRegistration } from "../modules/registration/registrationService.js";

const router = Router();

const registrationLimiter = rateLimit({ windowMs: 60_000, limit: 20 });
const checkoutLimiter = rateLimit({ windowMs: 60_000, limit: 10 });

const registrationSchema = z.object({
  body: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(7),
    password: strongPasswordSchema,
    confirmPassword: z.string().min(1),
    termsAccepted: z.literal(true),
    privacyAccepted: z.literal(true),
    businessName: z.string().min(2),
    publicBusinessName: z.string().min(2),
    businessType: z.enum(["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"]).default("RESTAURANT"),
    cuisine: z.string().min(2),
    businessEmail: z.string().email(),
    businessPhone: z.string().min(7),
    address: z.string().min(2),
    city: z.string().min(2),
    state: z.string().min(2),
    zip: z.string().min(3),
    country: z.string().default("US"),
    timezone: z.string().min(2),
    preferredSlug: z.string().min(2),
    planCode: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]),
    billingInterval: z.enum(["MONTHLY", "ANNUAL"]).default("MONTHLY"),
    website: z.string().optional()
  }).refine((body) => body.password === body.confirmPassword, {
    message: "Passwords must match.",
    path: ["confirmPassword"]
  })
});

const checkoutSchema = z.object({
  body: z.object({
    registrationId: z.string().min(6),
    planCode: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]),
    billingInterval: z.enum(["MONTHLY", "ANNUAL"]).default("MONTHLY")
  })
});

const cancelSchema = z.object({
  params: z.object({
    registrationId: z.string().min(6)
  })
});

router.get("/plans", async (req, res, next) => {
  try {
    res.json(await listRegistrationPlans());
  } catch (error) {
    next(error);
  }
});

router.get("/slug/:slug", async (req, res, next) => {
  try {
    res.json(await checkRegistrationSlug({ slug: req.params.slug, ownerEmail: req.query.email }));
  } catch (error) {
    next(error);
  }
});

router.post("/start", registrationLimiter, validate(registrationSchema), async (req, res, next) => {
  try {
    res.status(201).json(await startRegistration({ body: req.body }));
  } catch (error) {
    next(error);
  }
});

router.post("/checkout", checkoutLimiter, validate(checkoutSchema), async (req, res, next) => {
  try {
    res.status(201).json(await createRegistrationCheckout(req.body));
  } catch (error) {
    next(error);
  }
});

router.get("/status", async (req, res, next) => {
  try {
    res.json(await getRegistrationStatus({ registrationId: req.query.registrationId, sessionId: req.query.session_id }));
  } catch (error) {
    next(error);
  }
});

router.get("/:registrationId/status", async (req, res, next) => {
  try {
    res.json(await getRegistrationStatus({ registrationId: req.params.registrationId, sessionId: req.query.session_id }));
  } catch (error) {
    next(error);
  }
});

router.post("/:registrationId/cancel", registrationLimiter, validate(cancelSchema), async (req, res, next) => {
  try {
    res.json(await cancelRegistration({ registrationId: req.params.registrationId }));
  } catch (error) {
    next(error);
  }
});

export default router;

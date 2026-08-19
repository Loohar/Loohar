import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole, requireTenantAccess } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  acknowledgeAndActivateTaxProfile,
  createManualVerifiedTaxProfile,
  getTaxWorkspace,
  refreshLocationTaxProfile,
  resolveLocationTaxProfile,
  taxProfileHistory
} from "../services/taxProfileService.js";

const router = Router();
const readRoles = ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "SUPER_ADMIN"];
const manageRoles = ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "SUPER_ADMIN"];
const manualVerificationRoles = ["RESTAURANT_ADMIN", "SUPER_ADMIN"];

router.use(requireAuth);

router.param("restaurantId", async (req, res, next, value) => {
  try {
    const identifier = String(value || "").trim();
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: identifier }, { slug: identifier }] },
      select: { id: true, slug: true, status: true }
    });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found", code: "TAX_RESTAURANT_NOT_FOUND" });
    req.resolvedRestaurantId = restaurant.id;
    next();
  } catch (error) {
    next(error);
  }
});

router.use(requireRole(...readRoles), requireTenantAccess);

const locationParams = z.object({
  restaurantId: z.string().min(1),
  locationId: z.string().min(1)
});

const resolveSchema = z.object({
  params: locationParams,
  body: z.object({
    providerId: z.string().min(1).max(80).optional(),
    productServiceId: z.number().int().positive().optional()
  }).default({})
});

const manualSchema = z.object({
  params: locationParams,
  body: z.object({
    taxRateBps: z.number().int().min(0).max(100000),
    taxRateMicros: z.number().int().min(0).max(10000000).optional(),
    taxInclusive: z.boolean().default(false),
    jurisdictionCode: z.string().min(2).max(160),
    county: z.string().max(120).default(""),
    municipality: z.string().min(1).max(120),
    sourceReference: z.string().min(3).max(240),
    verificationMethod: z.string().min(2).max(120).default("manual-review"),
    verifiedAt: z.string().datetime(),
    effectiveAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable().optional(),
    nextVerificationAt: z.string().datetime().nullable().optional(),
    specialDistricts: z.array(z.object({
      name: z.string().min(1).max(120),
      jurisdictionCode: z.string().min(1).max(160)
    })).default([]),
    taxComponents: z.array(z.object({
      type: z.string().min(1).max(40),
      name: z.string().min(1).max(120),
      jurisdictionCode: z.string().min(1).max(160),
      rateBps: z.number().int().min(0).max(100000),
      rateMicros: z.number().int().min(0).max(10000000).optional()
    })).default([]),
    exemption: z.record(z.unknown()).optional()
  })
});

const acknowledgeSchema = z.object({
  params: locationParams,
  body: z.object({
    profileId: z.string().min(1),
    configurationVersion: z.string().min(1).max(160),
    confirmed: z.literal(true)
  })
});

router.get("/:restaurantId/tax-profiles", async (req, res, next) => {
  try {
    res.json(await getTaxWorkspace({ restaurantId: req.resolvedRestaurantId }));
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/locations/:locationId/tax-profile", validate(z.object({ params: locationParams })), async (req, res, next) => {
  try {
    const workspace = await getTaxWorkspace({ restaurantId: req.resolvedRestaurantId });
    const location = workspace.locations.find((item) => item.id === req.params.locationId);
    if (!location) return res.status(404).json({ error: "Location not found", code: "TAX_LOCATION_NOT_FOUND" });
    res.json({ location });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/locations/:locationId/tax-profile/history", validate(z.object({ params: locationParams })), async (req, res, next) => {
  try {
    res.json({
      profiles: await taxProfileHistory({
        restaurantId: req.resolvedRestaurantId,
        locationId: req.params.locationId
      })
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/locations/:locationId/tax-profile/resolve", requireRole(...manageRoles), validate(resolveSchema), async (req, res, next) => {
  try {
    const profile = await resolveLocationTaxProfile({
      restaurantId: req.resolvedRestaurantId,
      locationId: req.params.locationId,
      actorUserId: req.user.id,
      providerId: req.body.providerId,
      productServiceId: req.body.productServiceId
    });
    res.status(201).json({ profile });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/locations/:locationId/tax-profile/manual", requireRole(...manualVerificationRoles), validate(manualSchema), async (req, res, next) => {
  try {
    const profile = await createManualVerifiedTaxProfile({
      restaurantId: req.resolvedRestaurantId,
      locationId: req.params.locationId,
      actorUserId: req.user.id,
      configuration: { ...req.body, verifiedBy: req.user.id }
    });
    res.status(201).json({ profile });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/locations/:locationId/tax-profile/acknowledge", requireRole(...manageRoles), validate(acknowledgeSchema), async (req, res, next) => {
  try {
    const profile = await acknowledgeAndActivateTaxProfile({
      restaurantId: req.resolvedRestaurantId,
      locationId: req.params.locationId,
      profileId: req.body.profileId,
      configurationVersion: req.body.configurationVersion,
      confirmed: req.body.confirmed,
      actorUserId: req.user.id
    });
    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/locations/:locationId/tax-profile/refresh", requireRole(...manageRoles), validate(z.object({ params: locationParams, body: z.object({}).default({}) })), async (req, res, next) => {
  try {
    const profile = await refreshLocationTaxProfile({
      restaurantId: req.resolvedRestaurantId,
      locationId: req.params.locationId,
      actorUserId: req.user.id
    });
    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

export default router;

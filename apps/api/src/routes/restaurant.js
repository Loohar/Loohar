import bcrypt from "bcrypt";
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole, requireTenantAccess } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { recordAudit } from "../services/auditService.js";
import { sendAccountSetupEmail } from "../services/accountAccessService.js";
import { notifyDriverAssignment, notifyOrderStatusUpdate } from "../services/notificationService.js";
import { buildReceiptPayload, issueOrderTrackingToken, receiptOrderInclude } from "../services/orderWorkflowService.js";
import { emitDeliveryUpdate, emitKitchenUpdate, emitOrderUpdate } from "../services/realtimeService.js";
import { DNS_TARGET, ensureDomain, ensureWebsiteSettings } from "../services/websiteService.js";
import { domainInfoForRestaurant, domainUpdateDataForRestaurant } from "../services/domainService.js";
import { normalizeEmail } from "../utils/authSecurity.js";

const router = Router();
const restaurantRoles = ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"];
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

function permissionsForRole(role) {
  const permissions = {
    TENANT_OWNER: ["all"],
    RESTAURANT_ADMIN: ["all"],
    RESTAURANT_OWNER: ["all"],
    RESTAURANT_MANAGER: ["orders", "kitchen", "employees", "drivers", "inventory", "reports", "settings"],
    CASHIER: ["orders", "receipts", "customers"],
    KITCHEN_STAFF: ["kitchen", "orders"],
    DRIVER: ["deliveries"]
  };
  return permissions[role] || ["orders"];
}

function sanitizeEmployeeRole(role = "KITCHEN_STAFF") {
  const allowed = ["RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "DRIVER"];
  return allowed.includes(role) ? role : "KITCHEN_STAFF";
}

function generateTemporaryPassword() {
  return `Temp-${crypto.randomBytes(9).toString("base64url")}1!`;
}

function kitchenTicketText(order) {
  const lines = [
    `KITCHEN TICKET #${order.orderNumber}`,
    `${order.type} - ${order.customer?.name || "Customer"}`,
    order.deliveryAddress ? `Delivery: ${order.deliveryAddress}` : "Pickup",
    ""
  ];
  order.items.forEach((item) => {
    lines.push(`${item.quantity}x ${item.name}`);
    const modifiers = Array.isArray(item.optionsJson) ? item.optionsJson : [];
    modifiers.forEach((modifier) => lines.push(`  + ${modifier.group ? `${modifier.group}: ` : ""}${modifier.name}`));
  });
  if (order.notes) lines.push("", `Instructions: ${order.notes}`);
  return lines.join("\n");
}

function customerReceiptText(order) {
  const lines = [
    `RECEIPT #${order.orderNumber}`,
    `${order.customer?.name || "Customer"} - ${order.type}`,
    ""
  ];
  order.items.forEach((item) => lines.push(`${item.quantity}x ${item.name} ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((item.quantity * item.unitPriceCents) / 100)}`));
  lines.push(
    "",
    `Subtotal: ${(order.subtotalCents / 100).toFixed(2)}`,
    `Tax: ${(order.taxCents / 100).toFixed(2)}`,
    `Restaurant Tip: ${((order.restaurantTipCents || 0) / 100).toFixed(2)}`,
    `Driver Tip: ${((order.driverTipCents ?? order.tipCents ?? 0) / 100).toFixed(2)}`,
    `Delivery: ${(order.deliveryFeeCents / 100).toFixed(2)}`,
    `Total: ${(order.totalCents / 100).toFixed(2)}`
  );
  return lines.join("\n");
}

const websiteEditableFields = [
  "websiteEnabled",
  "heroTitle",
  "heroSubtitle",
  "tagline",
  "cuisineType",
  "heroImageUrl",
  "mobileHeroImageUrl",
  "logoUrl",
  "faviconUrl",
  "brandColor",
  "accentColor",
  "buttonColor",
  "headingFont",
  "bodyFont",
  "sectionSettingsJson",
  "storeHoursJson",
  "aboutTitle",
  "aboutStory",
  "missionStatement",
  "ownerStory",
  "specialOfferText",
  "ctaText",
  "contactMessage",
  "cateringMessage",
  "publicEmail",
  "seoTitle",
  "seoDescription",
  "seoKeywords",
  "canonicalUrl",
  "ogImageUrl",
  "indexingEnabled"
];

function websiteUpdateData(body = {}) {
  return Object.fromEntries(websiteEditableFields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
}

function pickEditable(body = {}, fields = []) {
  return Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
}

const menuCategoryEditableFields = ["name", "sortOrder", "active"];
const menuItemEditableFields = [
  "categoryId",
  "name",
  "description",
  "imageUrl",
  "priceCents",
  "preparationTimeMins",
  "calories",
  "spiceLevel",
  "available",
  "featured",
  "recommended",
  "isGlutenFree",
  "isVegetarian",
  "isVegan",
  "isSpicy",
  "isDairyFree",
  "isNutFree"
];

function menuCategoryUpdateData(body = {}) {
  const data = pickEditable(body, menuCategoryEditableFields);
  if (data.name !== undefined) data.name = String(data.name || "").trim();
  if (data.sortOrder !== undefined) data.sortOrder = Number(data.sortOrder);
  return data;
}

function menuItemUpdateData(body = {}) {
  const data = pickEditable(body, menuItemEditableFields);
  if (data.name !== undefined) data.name = String(data.name || "").trim();
  if (data.description !== undefined) data.description = data.description ? String(data.description).trim() : null;
  if (data.imageUrl !== undefined) data.imageUrl = data.imageUrl ? String(data.imageUrl).trim() : null;
  if (data.priceCents !== undefined) data.priceCents = Number(data.priceCents);
  if (data.preparationTimeMins !== undefined) data.preparationTimeMins = Number(data.preparationTimeMins);
  if (data.calories !== undefined) data.calories = data.calories === null || data.calories === "" ? null : Number(data.calories);
  if (data.spiceLevel !== undefined) data.spiceLevel = data.spiceLevel ? String(data.spiceLevel).trim() : null;
  return data;
}

function isValidHttpUrl(value = "") {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isValidHttpsUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function toBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return fallback;
}

const allowedSocialPlatforms = new Set(["facebook", "instagram", "tiktok", "x", "youtube", "linkedin", "yelp", "google", "google_business"]);

const printerEditableFields = [
  "kitchenPrinterName",
  "kitchenPrinterEnabled",
  "frontCounterPrinterName",
  "frontCounterPrinterEnabled",
  "autoPrintKitchenTickets",
  "autoPrintCustomerReceipts",
  "provider",
  "settingsJson"
];

const notificationEditableFields = [
  "smsEnabled",
  "emailEnabled",
  "orderConfirmedSms",
  "orderReadySms",
  "outForDeliverySms",
  "deliveredSms",
  "orderConfirmationEmail",
  "receiptEmail",
  "passwordResetEmail",
  "welcomeEmail",
  "providerSettingsJson"
];

const onboardingSteps = [
  "business",
  "owner",
  "branding",
  "content",
  "hours",
  "fulfillment",
  "menu",
  "gallery",
  "domain",
  "payments",
  "review"
];
const onboardingStepSet = new Set(onboardingSteps);
const onboardingWebsiteSections = { hero: true, featuredMenu: true, story: true, gallery: true, loyalty: true, catering: true, contact: true };
const ownerRoles = new Set(["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN"]);
const allowedBusinessTypes = new Set(["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"]);
const allowedModules = new Set(["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"]);

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function compactString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : null;
}

function hasText(value) {
  return Boolean(compactString(value));
}

function requestedStep(req, fallback = "business") {
  const step = String(req.params.step || req.body.step || fallback || "business").trim();
  return onboardingStepSet.has(step) ? step : "business";
}

function mergeSettingsJson(current, patch) {
  return { ...asObject(current), ...asObject(patch) };
}

function normalizeStoreHours(input) {
  const source = asObject(input);
  return Object.fromEntries(Object.entries(source).map(([day, value]) => {
    const label = compactString(typeof value === "object" ? value.label || `${value.open || ""} - ${value.close || ""}` : value);
    return [day, label || "Closed"];
  }));
}

function hasUsableHours(hours) {
  return Object.values(asObject(hours)).some((value) => {
    const label = String(value || "").trim().toLowerCase();
    return label && label !== "closed";
  });
}

function activeSectionCount(sectionSettings) {
  const sections = { ...onboardingWebsiteSections, ...asObject(sectionSettings) };
  return Object.values(sections).filter((value) => value !== false).length;
}

function publicRestaurantShape(restaurant) {
  return {
    id: restaurant.id,
    name: restaurant.name,
    businessName: restaurant.businessName,
    businessType: restaurant.businessType,
    enabledModules: restaurant.enabledModules,
    slug: restaurant.slug,
    status: restaurant.status,
    description: restaurant.description,
    logoUrl: restaurant.logoUrl,
    phone: restaurant.phone,
    email: restaurant.email,
    address: restaurant.address,
    city: restaurant.city,
    state: restaurant.state,
    zip: restaurant.zip,
    timezone: restaurant.timezone,
    latitude: restaurant.latitude,
    longitude: restaurant.longitude,
    deliveryRadiusMiles: restaurant.deliveryRadiusMiles,
    deliveryEnabled: restaurant.deliveryEnabled,
    pickupEnabled: restaurant.pickupEnabled,
    deliveryFeeCents: restaurant.deliveryFeeCents,
    storeHoursJson: restaurant.storeHoursJson,
    settingsJson: restaurant.settingsJson,
    onboardingStatus: restaurant.onboardingStatus,
    onboardingCurrentStep: restaurant.onboardingCurrentStep,
    onboardingStartedAt: restaurant.onboardingStartedAt,
    onboardingUpdatedAt: restaurant.onboardingUpdatedAt,
    onboardingCompletedAt: restaurant.onboardingCompletedAt,
    onboardingSkippedSteps: restaurant.onboardingSkippedSteps,
    websitePublishedAt: restaurant.websitePublishedAt
  };
}

function onboardingReadiness(restaurant) {
  const website = restaurant.websiteSettings || {};
  const domain = restaurant.domains?.[0] || {};
  const settings = asObject(restaurant.settingsJson);
  const categories = restaurant.categories || [];
  const activeCategories = categories.filter((category) => category.active !== false);
  const availableItems = activeCategories.flatMap((category) => category.items || []).filter((item) => item.available !== false);
  const activeZones = (restaurant.deliveryZones || []).filter((zone) => zone.active !== false);
  const hours = website.storeHoursJson || restaurant.storeHoursJson;
  const hasDeliveryCoverage = !restaurant.deliveryEnabled || activeZones.length > 0 || Number(restaurant.deliveryRadiusMiles || 0) > 0 || Boolean(restaurant.deliveryZoneJson);
  const payment = asObject(settings.paymentSetup || settings.payments);
  const paymentReady = Boolean(payment.stripeConnectAccountId || payment.providerAccountId || payment.status === "CONNECTED" || payment.connected === true);

  const sections = {
    business: hasText(restaurant.name) && hasText(restaurant.slug) && hasText(restaurant.phone) && hasText(restaurant.email) && hasText(restaurant.address) && hasText(restaurant.city) && hasText(restaurant.state) && hasText(restaurant.zip) && hasText(restaurant.timezone),
    owner: (restaurant.users || []).some((user) => ownerRoles.has(user.role) && user.status === "ACTIVE"),
    branding: hasText(website.logoUrl || restaurant.logoUrl) && hasText(website.heroImageUrl),
    content: hasText(website.heroTitle) && hasText(website.heroSubtitle) && hasText(website.aboutStory) && activeSectionCount(website.sectionSettingsJson) > 0,
    hours: hasUsableHours(hours),
    fulfillment: (restaurant.pickupEnabled || restaurant.deliveryEnabled) && hasDeliveryCoverage,
    menu: activeCategories.length > 0 && availableItems.length > 0,
    gallery: (restaurant.galleryImages || []).length > 0,
    domain: hasText(domain.defaultSubdomain || restaurant.slug),
    payments: paymentReady
  };

  const blockers = [];
  const warnings = [];
  if (!sections.business) blockers.push({ step: "business", message: "Complete restaurant name, slug, contact, address, and timezone." });
  if (!sections.owner) blockers.push({ step: "owner", message: "Assign an active restaurant owner or admin account." });
  if (!sections.branding) blockers.push({ step: "branding", message: "Upload a logo and hero image before publishing the public website." });
  if (!sections.content) blockers.push({ step: "content", message: "Add hero copy, about story, and at least one visible website section." });
  if (!sections.hours) blockers.push({ step: "hours", message: "Add operating hours for at least one open day." });
  if (!sections.fulfillment) warnings.push({ step: "fulfillment", message: "Online ordering stays disabled until pickup or delivery is configured. Delivery requires a zone, radius, or map coverage." });
  if (!sections.menu) warnings.push({ step: "menu", message: "Online ordering stays disabled until at least one active menu category and one available menu item exist." });
  if (!sections.gallery) warnings.push({ step: "gallery", message: "Add gallery photos to make the public website feel complete." });
  if (domain.customDomain && !["VERIFIED", "SSL_PENDING", "ACTIVE"].includes(domain.domainStatus)) warnings.push({ step: "domain", message: "Custom domain is not verified yet. The Loohar subdomain can still be used." });
  if (!paymentReady) warnings.push({ step: "payments", message: "Paid online ordering is blocked until payments are connected. Website publishing can still continue." });

  const websiteRequired = ["business", "owner", "branding", "content", "hours", "domain"];
  const websiteReady = websiteRequired.every((section) => sections[section]);
  const completedCount = Object.values(sections).filter(Boolean).length;
  return {
    sections,
    blockers,
    warnings,
    websiteReady,
    orderingReady: websiteReady && sections.fulfillment && sections.menu && paymentReady,
    paymentReady,
    paymentStatus: paymentReady ? "CONNECTED" : "NOT_CONNECTED",
    completionPercentage: Math.round((completedCount / Object.keys(sections).length) * 100),
    counts: {
      activeCategories: activeCategories.length,
      availableItems: availableItems.length,
      galleryImages: (restaurant.galleryImages || []).length,
      socialLinks: (restaurant.socialLinks || []).length,
      activeDeliveryZones: activeZones.length
    }
  };
}

async function ensureOnboardingRestaurant(req) {
  const restaurantId = restaurantIdFor(req);
  const existing = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      websiteSettings: true,
      domains: true,
      galleryImages: { orderBy: { sortOrder: "asc" } },
      socialLinks: true,
      categories: { orderBy: { sortOrder: "asc" }, include: { items: { orderBy: { name: "asc" } } } },
      deliveryZones: { orderBy: { createdAt: "asc" } },
      users: { select: { id: true, email: true, name: true, phone: true, role: true, status: true } }
    }
  });
  if (!existing) return null;
  await Promise.all([ensureWebsiteSettings(existing), ensureDomain(existing)]);
  return prisma.restaurant.findUnique({
    where: { id: existing.id },
    include: {
      websiteSettings: true,
      domains: true,
      galleryImages: { orderBy: { sortOrder: "asc" } },
      socialLinks: true,
      categories: { orderBy: { sortOrder: "asc" }, include: { items: { orderBy: { name: "asc" } } } },
      deliveryZones: { orderBy: { createdAt: "asc" } },
      users: { select: { id: true, email: true, name: true, phone: true, role: true, status: true } }
    }
  });
}

function onboardingPayload(restaurant) {
  const readiness = onboardingReadiness(restaurant);
  const owner = (restaurant.users || []).find((user) => ownerRoles.has(user.role)) || null;
  const domainRecord = restaurant.domains?.[0] || null;
  return {
    restaurant: publicRestaurantShape(restaurant),
    owner,
    website: restaurant.websiteSettings,
    domain: domainRecord ? domainInfoForRestaurant(restaurant, domainRecord) : null,
    gallery: restaurant.galleryImages || [],
    socialLinks: restaurant.socialLinks || [],
    categories: restaurant.categories || [],
    deliveryZones: restaurant.deliveryZones || [],
    progress: {
      steps: onboardingSteps,
      status: restaurant.onboardingStatus,
      currentStep: restaurant.onboardingCurrentStep,
      startedAt: restaurant.onboardingStartedAt,
      updatedAt: restaurant.onboardingUpdatedAt,
      completedAt: restaurant.onboardingCompletedAt,
      skippedSteps: restaurant.onboardingSkippedSteps || {}
    },
    readiness
  };
}

async function markOnboardingProgress({ req, restaurantId, step, status = "IN_PROGRESS", skippedSteps }) {
  const current = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { onboardingStartedAt: true, onboardingStatus: true, onboardingSkippedSteps: true } });
  const data = {
    onboardingStatus: current?.onboardingStatus === "COMPLETED" ? "COMPLETED" : status,
    onboardingCurrentStep: step,
    onboardingStartedAt: current?.onboardingStartedAt || new Date(),
    onboardingUpdatedAt: new Date()
  };
  if (skippedSteps) data.onboardingSkippedSteps = skippedSteps;
  const restaurant = await prisma.restaurant.update({ where: { id: restaurantId }, data, select: { id: true } });
  await recordAudit({ actorUserId: req.user.id, restaurantId, action: "onboarding.progress.updated", entityType: "Restaurant", entityId: restaurant.id, metadata: { step, status } }).catch(() => {});
}

async function getOnboarding(req, res, next) {
  try {
    const restaurant = await ensureOnboardingRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    if (restaurant.onboardingStatus === "NOT_STARTED") {
      await markOnboardingProgress({ req, restaurantId: restaurant.id, step: "business" });
      const started = await ensureOnboardingRestaurant(req);
      return res.json(onboardingPayload(started));
    }
    res.json(onboardingPayload(restaurant));
  } catch (error) {
    next(error);
  }
}

async function getOnboardingReadiness(req, res, next) {
  try {
    const restaurant = await ensureOnboardingRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    res.json({ readiness: onboardingReadiness(restaurant) });
  } catch (error) {
    next(error);
  }
}

async function saveOnboardingStep(req, res, next) {
  try {
    const restaurant = await ensureOnboardingRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const restaurantId = restaurant.id;
    const step = requestedStep(req);

    if (step === "business") {
      const settingsPatch = {};
      if (req.body.categoryLabel !== undefined) settingsPatch.categoryLabel = compactString(req.body.categoryLabel);
      if (req.body.addressLine2 !== undefined) settingsPatch.addressLine2 = compactString(req.body.addressLine2);
      if (req.body.enabledModules !== undefined && Array.isArray(req.body.enabledModules)) {
        const modules = req.body.enabledModules.filter((module) => allowedModules.has(module));
        if (modules.length) settingsPatch.enabledModulesSnapshot = modules;
      }
      const data = {};
      if (req.body.businessName !== undefined) data.businessName = compactString(req.body.businessName);
      if (req.body.publicBusinessName !== undefined || req.body.name !== undefined) data.name = compactString(req.body.publicBusinessName ?? req.body.name);
      if (req.body.businessType !== undefined && allowedBusinessTypes.has(req.body.businessType)) data.businessType = req.body.businessType;
      if (req.body.description !== undefined) data.description = compactString(req.body.description);
      if (req.body.businessEmail !== undefined || req.body.email !== undefined) data.email = compactString(req.body.businessEmail ?? req.body.email);
      if (req.body.phone !== undefined) data.phone = compactString(req.body.phone);
      if (req.body.address !== undefined) data.address = compactString(req.body.address);
      if (req.body.city !== undefined) data.city = compactString(req.body.city);
      if (req.body.state !== undefined) data.state = compactString(req.body.state);
      if (req.body.zip !== undefined) data.zip = compactString(req.body.zip);
      if (req.body.timezone !== undefined) data.timezone = compactString(req.body.timezone) || "America/Denver";
      if (req.body.pickupEnabled !== undefined) data.pickupEnabled = Boolean(req.body.pickupEnabled);
      if (req.body.deliveryEnabled !== undefined) data.deliveryEnabled = Boolean(req.body.deliveryEnabled);
      if (req.body.enabledModules !== undefined && Array.isArray(req.body.enabledModules)) data.enabledModules = req.body.enabledModules.filter((module) => allowedModules.has(module));
      if (Object.keys(settingsPatch).length) data.settingsJson = mergeSettingsJson(restaurant.settingsJson, settingsPatch);
      await prisma.restaurant.update({ where: { id: restaurantId }, data });
    }

    if (step === "owner") {
      const ownerId = req.body.ownerUserId || restaurant.users.find((candidate) => ownerRoles.has(candidate.role))?.id || req.user.id;
      const data = {};
      if (req.body.ownerName !== undefined || req.body.name !== undefined) data.name = compactString(req.body.ownerName ?? req.body.name) || undefined;
      if (req.body.ownerPhone !== undefined || req.body.phone !== undefined) data.phone = compactString(req.body.ownerPhone ?? req.body.phone);
      if (req.body.ownerEmail !== undefined || req.body.email !== undefined) {
        const email = normalizeEmail(req.body.ownerEmail ?? req.body.email);
        const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, NOT: { id: ownerId } }, select: { id: true } });
        if (existing) return res.status(409).json({ error: "That owner email is already used by another account." });
        data.email = email;
      }
      if (Object.keys(data).length) {
        await prisma.user.update({ where: { id: ownerId }, data });
      }
    }

    if (step === "branding") {
      const brandingJson = mergeSettingsJson(restaurant.brandingJson, {
        primaryColor: req.body.brandColor ?? req.body.primaryColor,
        accentColor: req.body.accentColor,
        buttonColor: req.body.buttonColor,
        logoUrl: req.body.logoUrl,
        heroImageUrl: req.body.heroImageUrl,
        mobileHeroImageUrl: req.body.mobileHeroImageUrl,
        faviconUrl: req.body.faviconUrl
      });
      const restaurantData = {};
      if (req.body.logoUrl !== undefined) restaurantData.logoUrl = compactString(req.body.logoUrl);
      if (Object.keys(brandingJson).length) restaurantData.brandingJson = brandingJson;
      if (Object.keys(restaurantData).length) await prisma.restaurant.update({ where: { id: restaurantId }, data: restaurantData });
      await prisma.restaurantWebsiteSettings.upsert({
        where: { restaurantId },
        update: websiteUpdateData(req.body),
        create: { restaurantId, ...websiteUpdateData(req.body) }
      });
    }

    if (["content", "domain"].includes(step)) {
      await prisma.restaurantWebsiteSettings.upsert({
        where: { restaurantId },
        update: websiteUpdateData(req.body),
        create: { restaurantId, ...websiteUpdateData(req.body) }
      });
    }

    if (step === "domain" && (req.body.customDomain !== undefined || req.body.defaultSubdomain !== undefined || req.body.canonicalDomain !== undefined)) {
      const existing = await ensureDomain(restaurant);
      await prisma.restaurantDomain.update({
        where: { id: existing.id },
        data: domainUpdateDataForRestaurant(restaurant, existing, req.body)
      });
    }

    if (step === "hours") {
      const storeHoursJson = normalizeStoreHours(req.body.storeHoursJson || req.body.hours || {});
      await prisma.$transaction([
        prisma.restaurant.update({ where: { id: restaurantId }, data: { storeHoursJson } }),
        prisma.restaurantWebsiteSettings.upsert({ where: { restaurantId }, update: { storeHoursJson }, create: { restaurantId, storeHoursJson } })
      ]);
    }

    if (step === "fulfillment") {
      const settingsPatch = {};
      ["minimumOrderCents", "averagePrepMinutes", "tipsEnabled", "deliveryNotes", "pickupInstructions"].forEach((field) => {
        if (req.body[field] !== undefined) settingsPatch[field] = req.body[field];
      });
      const data = {};
      if (req.body.pickupEnabled !== undefined) data.pickupEnabled = Boolean(req.body.pickupEnabled);
      if (req.body.deliveryEnabled !== undefined) data.deliveryEnabled = Boolean(req.body.deliveryEnabled);
      if (req.body.deliveryFeeCents !== undefined) data.deliveryFeeCents = Number(req.body.deliveryFeeCents || 0);
      if (req.body.deliveryRadiusMiles !== undefined) data.deliveryRadiusMiles = Number(req.body.deliveryRadiusMiles || 0);
      if (Object.keys(settingsPatch).length) data.settingsJson = mergeSettingsJson(restaurant.settingsJson, settingsPatch);
      if (Object.keys(data).length) await prisma.restaurant.update({ where: { id: restaurantId }, data });
      if (req.body.deliveryZone?.name) {
        await prisma.deliveryZone.upsert({
          where: { restaurantId_name: { restaurantId, name: req.body.deliveryZone.name } },
          update: {
            radiusMiles: Number(req.body.deliveryZone.radiusMiles || req.body.deliveryRadiusMiles || 0),
            deliveryFeeCents: Number(req.body.deliveryZone.deliveryFeeCents ?? req.body.deliveryFeeCents ?? 0),
            minimumOrderCents: Number(req.body.deliveryZone.minimumOrderCents ?? req.body.minimumOrderCents ?? 0),
            active: req.body.deliveryZone.active !== false
          },
          create: {
            restaurantId,
            name: req.body.deliveryZone.name,
            radiusMiles: Number(req.body.deliveryZone.radiusMiles || req.body.deliveryRadiusMiles || 0),
            deliveryFeeCents: Number(req.body.deliveryZone.deliveryFeeCents ?? req.body.deliveryFeeCents ?? 0),
            minimumOrderCents: Number(req.body.deliveryZone.minimumOrderCents ?? req.body.minimumOrderCents ?? 0),
            active: req.body.deliveryZone.active !== false,
            mapSettingsJson: req.body.deliveryZone.mapSettingsJson || { provider: "map_placeholder" }
          }
        });
      }
    }

    if (step === "payments") {
      await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { settingsJson: mergeSettingsJson(restaurant.settingsJson, { paymentSetup: asObject(req.body.paymentSetup || req.body) }) }
      });
    }

    await markOnboardingProgress({ req, restaurantId, step });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "onboarding.step.saved", entityType: "Restaurant", entityId: restaurantId, metadata: { step } }).catch(() => {});
    const updated = await ensureOnboardingRestaurant(req);
    res.json(onboardingPayload(updated));
  } catch (error) {
    next(error);
  }
}

async function skipOnboardingStep(req, res, next) {
  try {
    const restaurant = await ensureOnboardingRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const step = requestedStep(req);
    const skippedSteps = { ...asObject(restaurant.onboardingSkippedSteps), [step]: { skippedAt: new Date().toISOString(), reason: compactString(req.body.reason) || "Skipped during setup" } };
    await markOnboardingProgress({ req, restaurantId: restaurant.id, step, skippedSteps });
    const updated = await ensureOnboardingRestaurant(req);
    res.json(onboardingPayload(updated));
  } catch (error) {
    next(error);
  }
}

async function publishOnboarding(req, res, next) {
  try {
    const restaurant = await ensureOnboardingRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const readiness = onboardingReadiness(restaurant);
    if (!readiness.websiteReady) {
      return res.status(400).json({ error: "Complete required onboarding steps before publishing.", readiness });
    }
    const nextSettings = mergeSettingsJson(restaurant.settingsJson, {
      onlineOrderingEnabled: readiness.orderingReady,
      websitePublished: true,
      publishedAt: new Date().toISOString()
    });
    await prisma.$transaction([
      prisma.restaurant.update({
        where: { id: restaurant.id },
        data: {
          status: restaurant.status === "PENDING" ? "ACTIVE" : restaurant.status,
          settingsJson: nextSettings,
          onboardingStatus: "COMPLETED",
          onboardingCurrentStep: "review",
          onboardingCompletedAt: new Date(),
          onboardingUpdatedAt: new Date(),
          websitePublishedAt: new Date()
        }
      }),
      prisma.restaurantWebsiteSettings.upsert({
        where: { restaurantId: restaurant.id },
        update: { websiteEnabled: true },
        create: { restaurantId: restaurant.id, websiteEnabled: true }
      })
    ]);
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "onboarding.completed", entityType: "Restaurant", entityId: restaurant.id, metadata: { orderingReady: readiness.orderingReady } });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "website.published", entityType: "Restaurant", entityId: restaurant.id, metadata: { orderingReady: readiness.orderingReady } }).catch(() => {});
    const updated = await ensureOnboardingRestaurant(req);
    res.json({ ...onboardingPayload(updated), published: true });
  } catch (error) {
    next(error);
  }
}

router.get("/onboarding", getOnboarding);
router.get("/onboarding/readiness", getOnboardingReadiness);
router.patch("/onboarding/:step", saveOnboardingStep);
router.post("/onboarding/:step/skip", skipOnboardingStep);
router.post("/onboarding/publish", publishOnboarding);
router.get("/:restaurantId/onboarding", getOnboarding);
router.get("/:restaurantId/onboarding/readiness", getOnboardingReadiness);
router.patch("/:restaurantId/onboarding/:step", saveOnboardingStep);
router.post("/:restaurantId/onboarding/:step/skip", skipOnboardingStep);
router.post("/:restaurantId/onboarding/publish", publishOnboarding);

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

const categorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    sortOrder: z.coerce.number().int().optional(),
    active: z.boolean().optional()
  })
});

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
    const restaurantId = restaurantIdFor(req);
    const category = await prisma.menuCategory.create({ data: { ...menuCategoryUpdateData(req.body), restaurantId } });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.category.created", entityType: "MenuCategory", entityId: category.id });
    res.status(201).json({ category });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/menu/categories/:categoryId", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const data = menuCategoryUpdateData(req.body);
    if (data.name !== undefined && data.name.length < 2) return res.status(400).json({ error: "Category name must be at least 2 characters." });
    const category = await prisma.menuCategory.update({ where: { id_restaurantId: { id: req.params.categoryId, restaurantId } }, data });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.category.updated", entityType: "MenuCategory", entityId: category.id, metadata: data });
    res.json({ category });
  } catch (error) {
    next(error);
  }
});

router.delete("/:restaurantId/menu/categories/:categoryId", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const itemCount = await prisma.menuItem.count({ where: { restaurantId, categoryId: req.params.categoryId } });
    if (itemCount > 0) {
      const category = await prisma.menuCategory.update({ where: { id_restaurantId: { id: req.params.categoryId, restaurantId } }, data: { active: false } });
      await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.category.archived", entityType: "MenuCategory", entityId: category.id, metadata: { itemCount } });
      return res.json({ category, archived: true, message: "Category has menu items, so it was hidden instead of permanently deleted." });
    }
    await prisma.menuCategory.delete({ where: { id_restaurantId: { id: req.params.categoryId, restaurantId } } });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.category.deleted", entityType: "MenuCategory", entityId: req.params.categoryId });
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
    imageUrl: z.string().nullable().optional(),
    priceCents: z.coerce.number().int().nonnegative(),
    preparationTimeMins: z.coerce.number().int().positive().default(15),
    calories: z.coerce.number().int().nonnegative().nullable().optional(),
    spiceLevel: z.string().optional().nullable(),
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
    const restaurantId = restaurantIdFor(req);
    const category = await prisma.menuCategory.findUnique({ where: { id_restaurantId: { id: data.categoryId, restaurantId } }, select: { id: true } });
    if (!category) return res.status(400).json({ error: "Select a valid menu category for this restaurant." });
    const item = await prisma.menuItem.create({
      data: { ...menuItemUpdateData(data), restaurantId, options: { create: options } },
      include: { category: true, options: true, optionGroups: { include: { options: true } } }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.item.created", entityType: "MenuItem", entityId: item.id });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/menu/items/:itemId", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const data = menuItemUpdateData(req.body);
    if (data.categoryId) {
      const category = await prisma.menuCategory.findUnique({ where: { id_restaurantId: { id: data.categoryId, restaurantId } }, select: { id: true } });
      if (!category) return res.status(400).json({ error: "Select a valid menu category for this restaurant." });
    }
    if (data.name !== undefined && data.name.length < 2) return res.status(400).json({ error: "Item name must be at least 2 characters." });
    if (data.priceCents !== undefined && (!Number.isFinite(data.priceCents) || data.priceCents < 0)) return res.status(400).json({ error: "Price must be zero or greater." });
    const item = await prisma.menuItem.update({
      where: { id_restaurantId: { id: req.params.itemId, restaurantId } },
      data,
      include: { category: true, options: true, optionGroups: { include: { options: true } } }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.item.updated", entityType: "MenuItem", entityId: item.id, metadata: data });
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
    const restaurantId = restaurantIdFor(req);
    const orderItemCount = await prisma.orderItem.count({ where: { menuItemId: req.params.itemId, order: { restaurantId } } });
    if (orderItemCount > 0) {
      const item = await prisma.menuItem.update({
        where: { id_restaurantId: { id: req.params.itemId, restaurantId } },
        data: { available: false },
        include: { category: true, options: true, optionGroups: { include: { options: true } } }
      });
      await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.item.archived", entityType: "MenuItem", entityId: item.id, metadata: { orderItemCount } });
      return res.json({ item, archived: true, message: "Item has order history, so it was marked unavailable instead of permanently deleted." });
    }
    await prisma.$transaction([
      prisma.menuItemOption.deleteMany({ where: { menuItemId: req.params.itemId } }),
      prisma.menuItemOptionGroup.deleteMany({ where: { menuItemId: req.params.itemId } }),
      prisma.menuItem.delete({ where: { id_restaurantId: { id: req.params.itemId, restaurantId } } })
    ]);
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.item.deleted", entityType: "MenuItem", entityId: req.params.itemId });
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
    emitKitchenUpdate(order);
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
        tipCents: order.driverTipCents ?? order.tipCents,
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

router.get("/:restaurantId/dispatch", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const [drivers, deliveries] = await Promise.all([
      prisma.driver.findMany({ where: { restaurantId }, include: { user: true, deliveries: { where: { status: { not: "DELIVERED" } }, include: { order: { include: { customer: true } } } } }, orderBy: { updatedAt: "desc" } }),
      prisma.delivery.findMany({ where: { restaurantId, status: { not: "DELIVERED" } }, include: { driver: { include: { user: true } }, order: { include: { customer: true, items: true } } }, orderBy: { createdAt: "desc" } })
    ]);
    const availableDrivers = drivers.filter((driver) => driver.user.status === "ACTIVE" && driver.available && driver.deliveries.length === 0);
    const busyDrivers = drivers.filter((driver) => driver.user.status === "ACTIVE" && driver.deliveries.length > 0);
    const offlineDrivers = drivers.filter((driver) => driver.user.status !== "ACTIVE" || (!driver.available && driver.deliveries.length === 0));
    res.json({ availableDrivers, busyDrivers, offlineDrivers, deliveries });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/deliveries/:deliveryId/assign-driver", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const driver = await prisma.driver.findUnique({ where: { id_restaurantId: { id: req.body.driverId, restaurantId } }, include: { user: true } });
    if (!driver || driver.user.status !== "ACTIVE") return res.status(404).json({ error: "Available driver not found" });
    const existing = await prisma.delivery.findFirst({ where: { id: req.params.deliveryId, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Delivery not found" });
    const delivery = await prisma.delivery.update({
      where: { id: existing.id },
      data: { driverId: driver.id, status: "ASSIGNED", statusHistory: { create: { status: "ASSIGNED", note: "Delivery assigned from dispatch center", changedBy: req.user.id } } },
      include: { driver: { include: { user: true } }, order: { include: { customer: true, restaurant: true, items: true } }, statusHistory: true }
    });
    await Promise.allSettled([notifyDriverAssignment({ delivery })]);
    emitDeliveryUpdate(delivery);
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "delivery.assigned", entityType: "Delivery", entityId: delivery.id, metadata: { driverId: driver.id } });
    res.json({ delivery });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/deliveries/:deliveryId/cancel-assignment", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.delivery.findFirst({ where: { id: req.params.deliveryId, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Delivery not found" });
    const delivery = await prisma.delivery.update({
      where: { id: existing.id },
      data: { driverId: null, status: "ASSIGNED", statusHistory: { create: { status: "ASSIGNED", note: "Driver assignment cancelled", changedBy: req.user.id } } },
      include: { order: { include: { customer: true, restaurant: true, items: true } }, statusHistory: true }
    });
    emitDeliveryUpdate(delivery);
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "delivery.assignment_cancelled", entityType: "Delivery", entityId: delivery.id });
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
    const passwordHash = await bcrypt.hash(generateTemporaryPassword(), 12);
    const email = normalizeEmail(req.body.email);
    const user = await prisma.user.create({
      data: { email, name: req.body.name, phone: req.body.phone, passwordHash, role: "DRIVER", restaurantId: restaurantIdFor(req), forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: null }
    });
    const driver = await prisma.driver.create({ data: { restaurantId: restaurantIdFor(req), userId: user.id } });
    await Promise.allSettled([sendAccountSetupEmail({ user })]);
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
    const passwordHash = await bcrypt.hash(generateTemporaryPassword(), 12);
    const email = normalizeEmail(req.body.email);
    const user = await prisma.user.create({
      data: { email, name: req.body.name, passwordHash, role: req.body.role, restaurantId: restaurantIdFor(req), phone: req.body.phone, forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: null }
    });
    const staff = await prisma.restaurantStaff.create({ data: { restaurantId: restaurantIdFor(req), userId: user.id, role: req.body.role, permissionsJson: req.body.permissionsJson || permissionsForRole(req.body.role) } });
    await Promise.allSettled([sendAccountSetupEmail({ user })]);
    res.status(201).json({ staff });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/employees", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const [staff, drivers] = await Promise.all([
      prisma.restaurantStaff.findMany({ where: { restaurantId }, include: { user: true }, orderBy: { createdAt: "desc" } }),
      prisma.driver.findMany({ where: { restaurantId }, include: { user: true, deliveries: { where: { status: { not: "DELIVERED" } } } }, orderBy: { createdAt: "desc" } })
    ]);
    const staffEmployees = staff.map((employee) => ({
      id: employee.userId,
      profileId: employee.id,
      profileType: "STAFF",
      name: employee.user.name,
      email: employee.user.email,
      phone: employee.user.phone,
      role: employee.role,
      status: employee.user.status,
      active: employee.active,
      permissions: employee.permissionsJson || permissionsForRole(employee.role)
    }));
    const driverEmployees = drivers.map((driver) => ({
      id: driver.userId,
      profileId: driver.id,
      profileType: "DRIVER",
      name: driver.user.name,
      email: driver.user.email,
      phone: driver.user.phone,
      role: "DRIVER",
      status: driver.user.status,
      active: driver.user.status === "ACTIVE",
      available: driver.available,
      busy: driver.deliveries.length > 0,
      permissions: permissionsForRole("DRIVER")
    }));
    res.json({ employees: [...staffEmployees, ...driverEmployees] });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/employees", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const role = sanitizeEmployeeRole(req.body.role);
    const passwordHash = await bcrypt.hash(generateTemporaryPassword(), 12);
    const email = normalizeEmail(req.body.email);
    const user = await prisma.user.create({
      data: { email, name: req.body.name || email, phone: req.body.phone, passwordHash, role, restaurantId, status: req.body.status || "ACTIVE", forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: null }
    });
    if (role === "DRIVER") {
      await prisma.driver.create({ data: { restaurantId, userId: user.id, available: Boolean(req.body.available) } });
    } else {
      await prisma.restaurantStaff.create({ data: { restaurantId, userId: user.id, role, active: req.body.status !== "SUSPENDED", permissionsJson: req.body.permissionsJson || permissionsForRole(role) } });
    }
    await Promise.allSettled([sendAccountSetupEmail({ user })]);
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "employee.created", entityType: "User", entityId: user.id, metadata: { role } });
    res.status(201).json({ employee: { id: user.id, name: user.name, email: user.email, phone: user.phone, role, status: user.status } });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/employees/:employeeId", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.user.findFirst({ where: { id: req.params.employeeId, restaurantId }, include: { staffProfile: true, driverProfile: true } });
    if (!existing) return res.status(404).json({ error: "Employee not found" });
    const role = req.body.role ? sanitizeEmployeeRole(req.body.role) : existing.role;
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(req.body.name ? { name: req.body.name } : {}),
        ...(req.body.email ? { email: normalizeEmail(req.body.email) } : {}),
        ...(req.body.phone !== undefined ? { phone: req.body.phone } : {}),
        ...(req.body.status ? { status: req.body.status } : {}),
        role
      }
    });
    if (role === "DRIVER") {
      if (existing.staffProfile) await prisma.restaurantStaff.delete({ where: { id: existing.staffProfile.id } });
      await prisma.driver.upsert({
        where: { userId: user.id },
        update: { available: Boolean(req.body.available) },
        create: { restaurantId, userId: user.id, available: Boolean(req.body.available) }
      });
    } else {
      if (existing.driverProfile) await prisma.driver.delete({ where: { id: existing.driverProfile.id } });
      await prisma.restaurantStaff.upsert({
        where: { userId: user.id },
        update: { role, active: user.status === "ACTIVE", permissionsJson: req.body.permissionsJson || permissionsForRole(role) },
        create: { restaurantId, userId: user.id, role, active: user.status === "ACTIVE", permissionsJson: req.body.permissionsJson || permissionsForRole(role) }
      });
    }
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "employee.updated", entityType: "User", entityId: user.id, metadata: { role, status: user.status } });
    res.json({ employee: { id: user.id, name: user.name, email: user.email, phone: user.phone, role, status: user.status } });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/employees/:employeeId/disable", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.user.findFirst({ where: { id: req.params.employeeId, restaurantId }, include: { staffProfile: true, driverProfile: true } });
    if (!existing) return res.status(404).json({ error: "Employee not found" });
    const user = await prisma.user.update({ where: { id: existing.id }, data: { status: "SUSPENDED" }, include: { staffProfile: true, driverProfile: true } });
    if (user.staffProfile) await prisma.restaurantStaff.update({ where: { id: user.staffProfile.id }, data: { active: false } });
    if (user.driverProfile) await prisma.driver.update({ where: { id: user.driverProfile.id }, data: { available: false } });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "employee.disabled", entityType: "User", entityId: user.id });
    res.json({ employee: { id: user.id, status: "SUSPENDED" } });
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

router.get("/:restaurantId/printing", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const settings = await prisma.restaurantPrinterSettings.upsert({
      where: { restaurantId },
      update: {},
      create: { restaurantId }
    });
    res.json({ settings, printerTargets: ["browser_print", "star_micronics_future", "epson_future", "thermal_printer_future"] });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/printing", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const data = pickEditable(req.body, printerEditableFields);
    const settings = await prisma.restaurantPrinterSettings.upsert({
      where: { restaurantId },
      update: data,
      create: { ...data, restaurantId }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "printing.updated", entityType: "RestaurantPrinterSettings", entityId: settings.id });
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

async function printOrder(req, res, next, kind) {
  try {
    const restaurantId = restaurantIdFor(req);
    const order = await prisma.order.findUnique({
      where: { id_restaurantId: { id: req.params.orderId, restaurantId } },
      include: receiptOrderInclude()
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const ticket = kind === "kitchen" ? kitchenTicketText(order) : customerReceiptText(order);
    const issued = await issueOrderTrackingToken(order.id);
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: kind === "kitchen" ? "print.kitchen_ticket" : "print.customer_receipt", entityType: "Order", entityId: order.id });
    res.json({ printJob: { kind, provider: "browser_print", orderId: order.id, orderNumber: order.orderNumber, ticket }, receipt: buildReceiptPayload(issued.order, { kind, trackingToken: issued.trackingToken }) });
  } catch (error) {
    next(error);
  }
}

router.get("/:restaurantId/orders/:orderId/receipt", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const order = await prisma.order.findUnique({
      where: { id_restaurantId: { id: req.params.orderId, restaurantId } },
      include: receiptOrderInclude()
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const issued = await issueOrderTrackingToken(order.id);
    res.json({ receipt: buildReceiptPayload(issued.order, { kind: req.query.kind?.toString() || "customer", trackingToken: issued.trackingToken }) });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/orders/:orderId/print-kitchen-ticket", (req, res, next) => printOrder(req, res, next, "kitchen"));
router.post("/:restaurantId/orders/:orderId/print-customer-receipt", (req, res, next) => printOrder(req, res, next, "receipt"));
router.post("/:restaurantId/orders/:orderId/print-driver-slip", (req, res, next) => printOrder(req, res, next, "driver"));

router.get("/:restaurantId/notification-settings", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const settings = await prisma.restaurantNotificationSettings.upsert({
      where: { restaurantId },
      update: {},
      create: { restaurantId }
    });
    res.json({ settings, providers: { sms: process.env.SMS_PROVIDER || "console", email: process.env.EMAIL_PROVIDER || "console" } });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/notification-settings", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const data = pickEditable(req.body, notificationEditableFields);
    const settings = await prisma.restaurantNotificationSettings.upsert({
      where: { restaurantId },
      update: data,
      create: { ...data, restaurantId }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "notifications.updated", entityType: "RestaurantNotificationSettings", entityId: settings.id });
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/delivery-zones", async (req, res, next) => {
  try {
    const zones = await prisma.deliveryZone.findMany({ where: { restaurantId: restaurantIdFor(req), active: true }, orderBy: { createdAt: "asc" } });
    res.json({ zones });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/delivery-zones", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const zone = await prisma.deliveryZone.create({
      data: {
        restaurantId,
        name: req.body.name,
        radiusMiles: Number(req.body.radiusMiles || 0),
        deliveryFeeCents: Number(req.body.deliveryFeeCents || 0),
        minimumOrderCents: Number(req.body.minimumOrderCents || 0),
        active: req.body.active !== false,
        mapSettingsJson: req.body.mapSettingsJson || { provider: "map_placeholder" }
      }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "delivery_zone.created", entityType: "DeliveryZone", entityId: zone.id });
    res.status(201).json({ zone });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/delivery-zones/:zoneId", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.deliveryZone.findFirst({ where: { id: req.params.zoneId, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Delivery zone not found" });
    const zone = await prisma.deliveryZone.update({
      where: { id: existing.id },
      data: {
        ...(req.body.name ? { name: req.body.name } : {}),
        ...(req.body.radiusMiles !== undefined ? { radiusMiles: Number(req.body.radiusMiles) } : {}),
        ...(req.body.deliveryFeeCents !== undefined ? { deliveryFeeCents: Number(req.body.deliveryFeeCents) } : {}),
        ...(req.body.minimumOrderCents !== undefined ? { minimumOrderCents: Number(req.body.minimumOrderCents) } : {}),
        ...(req.body.active !== undefined ? { active: Boolean(req.body.active) } : {}),
        ...(req.body.mapSettingsJson !== undefined ? { mapSettingsJson: req.body.mapSettingsJson } : {})
      }
    });
    res.json({ zone });
  } catch (error) {
    next(error);
  }
});

router.delete("/:restaurantId/delivery-zones/:zoneId", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.deliveryZone.findFirst({ where: { id: req.params.zoneId, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Delivery zone not found" });
    const zone = await prisma.deliveryZone.update({ where: { id: existing.id }, data: { active: false } });
    res.json({ zone });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/inventory", async (req, res, next) => {
  try {
    const items = await prisma.inventoryItem.findMany({ where: { restaurantId: restaurantIdFor(req), active: true }, orderBy: { name: "asc" } });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/inventory", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const item = await prisma.inventoryItem.create({
      data: {
        restaurantId,
        name: req.body.name,
        quantity: Number(req.body.quantity || 0),
        unit: req.body.unit || "unit",
        costCents: Number(req.body.costCents || 0),
        lowStockAt: req.body.lowStockAt !== undefined ? Number(req.body.lowStockAt) : null,
        notes: req.body.notes
      }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "inventory.created", entityType: "InventoryItem", entityId: item.id });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/inventory/:itemId", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.inventoryItem.findFirst({ where: { id: req.params.itemId, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Inventory item not found" });
    const item = await prisma.inventoryItem.update({
      where: { id: existing.id },
      data: {
        ...(req.body.name ? { name: req.body.name } : {}),
        ...(req.body.quantity !== undefined ? { quantity: Number(req.body.quantity) } : {}),
        ...(req.body.unit ? { unit: req.body.unit } : {}),
        ...(req.body.costCents !== undefined ? { costCents: Number(req.body.costCents) } : {}),
        ...(req.body.lowStockAt !== undefined ? { lowStockAt: Number(req.body.lowStockAt) } : {}),
        ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
        ...(req.body.active !== undefined ? { active: Boolean(req.body.active) } : {})
      }
    });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.delete("/:restaurantId/inventory/:itemId", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.inventoryItem.findFirst({ where: { id: req.params.itemId, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Inventory item not found" });
    const item = await prisma.inventoryItem.update({ where: { id: existing.id }, data: { active: false } });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/reports/sales", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const [orders, payments] = await Promise.all([
      prisma.order.groupBy({ by: ["status"], where: { restaurantId }, _count: true, _sum: { totalCents: true, tipCents: true, restaurantTipCents: true, driverTipCents: true } }),
      prisma.payment.aggregate({ where: { order: { restaurantId } }, _sum: { amountCents: true, restaurantNetCents: true, driverTipCents: true, technologyFeeCents: true } })
    ]);
    res.json({ orders, payments: payments._sum });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/reports/operations", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [orders, customers, deliveries] = await Promise.all([
      prisma.order.findMany({ where: { restaurantId }, include: { items: true }, orderBy: { createdAt: "desc" } }),
      prisma.customer.findMany({ where: { restaurantId }, include: { orders: true } }),
      prisma.delivery.findMany({ where: { restaurantId }, include: { driver: { include: { user: true } } } })
    ]);
    const nonCancelled = orders.filter((order) => order.status !== "CANCELLED");
    const salesSince = (date) => nonCancelled.filter((order) => order.createdAt >= date).reduce((sum, order) => sum + order.totalCents, 0);
    const itemStats = new Map();
    nonCancelled.forEach((order) => order.items.forEach((item) => {
      const current = itemStats.get(item.menuItemId) || { id: item.menuItemId, name: item.name, quantity: 0, revenueCents: 0 };
      current.quantity += item.quantity;
      current.revenueCents += item.quantity * item.unitPriceCents;
      itemStats.set(item.menuItemId, current);
    }));
    const itemRows = [...itemStats.values()];
    const driverRows = deliveries.reduce((rows, delivery) => {
      const key = delivery.driverId || "unassigned";
      const current = rows.get(key) || { driverId: delivery.driverId, name: delivery.driver?.user?.name || "Unassigned", deliveries: 0, tipsCents: 0, earningsCents: 0 };
      if (delivery.status === "DELIVERED") current.deliveries += 1;
      current.tipsCents += delivery.tipCents || 0;
      current.earningsCents += (delivery.baseEarningsCents || 0) + (delivery.tipCents || 0);
      rows.set(key, current);
      return rows;
    }, new Map());
    res.json({
      sales: {
        dailySalesCents: salesSince(startOfDay),
        weeklySalesCents: salesSince(startOfWeek),
        monthlySalesCents: salesSince(startOfMonth),
        totalTipsCents: nonCancelled.reduce((sum, order) => sum + (order.tipCents || 0), 0),
        restaurantTipsCents: nonCancelled.reduce((sum, order) => sum + (order.restaurantTipCents || 0), 0),
        driverTipsCents: nonCancelled.reduce((sum, order) => sum + (order.driverTipCents ?? order.tipCents ?? 0), 0)
      },
      items: {
        topSellingItems: [...itemRows].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
        leastSellingItems: [...itemRows].sort((a, b) => a.quantity - b.quantity).slice(0, 10)
      },
      customers: {
        newCustomers: customers.filter((customer) => customer.orders.length === 0).length,
        returningCustomers: customers.filter((customer) => customer.orders.length > 1).length,
        vipCustomers: customers.filter((customer) => customer.segment === "VIP_CUSTOMER").length
      },
      drivers: [...driverRows.values()]
    });
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
        totalTipsCents: delivered.reduce((sum, order) => sum + (order.tipCents || 0), 0),
        restaurantTipsCents: delivered.reduce((sum, order) => sum + (order.restaurantTipCents || 0), 0),
        driverTipsCents: delivered.reduce((sum, order) => sum + (order.driverTipCents ?? order.tipCents ?? 0), 0)
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
    const data = websiteUpdateData(req.body);
    const website = await prisma.restaurantWebsiteSettings.upsert({
      where: { restaurantId },
      update: data,
      create: { ...data, restaurantId }
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
    res.json({ domain: domainInfoForRestaurant(restaurant, domain), instructions: `Create a CNAME record for www pointing to ${DNS_TARGET}` });
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
      data: domainUpdateDataForRestaurant(restaurant, existing, req.body)
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "domain.updated", entityType: "RestaurantDomain", entityId: domain.id });
    res.json({ domain: domainInfoForRestaurant(restaurant, domain), instructions: `Create a CNAME record for www pointing to ${DNS_TARGET}` });
  } catch (error) {
    next(error);
  }
}

async function verifyDomain(req, res, next) {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantIdFor(req) } });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const existing = await ensureDomain(restaurant);
    if (!existing.customDomain) return res.status(400).json({ error: "Add a custom domain before verification." });
    const domain = await prisma.restaurantDomain.update({
      where: { id: existing.id },
      data: domainUpdateDataForRestaurant(restaurant, existing, { ...existing, domainStatus: "VERIFIED", sslStatus: "SSL_PENDING", canonicalDomain: req.body.canonicalDomain || existing.customDomain })
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId: restaurant.id, action: "domain.verified", entityType: "RestaurantDomain", entityId: domain.id });
    res.json({ domain: domainInfoForRestaurant(restaurant, domain), instructions: `Create a CNAME record for www pointing to ${DNS_TARGET}` });
  } catch (error) {
    next(error);
  }
}

async function getGallery(req, res, next) {
  try {
    const gallery = await prisma.restaurantGalleryImage.findMany({ where: { restaurantId: restaurantIdFor(req) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    res.json({ gallery });
  } catch (error) {
    next(error);
  }
}

async function addGalleryImage(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    if (!req.body.imageUrl || !isValidHttpUrl(req.body.imageUrl)) return res.status(400).json({ error: "A valid uploaded image URL is required." });
    const image = await prisma.restaurantGalleryImage.create({
      data: {
        imageUrl: req.body.imageUrl,
        title: req.body.title ? String(req.body.title).trim() : null,
        altText: req.body.altText || req.body.title || "Restaurant photo",
        caption: req.body.caption ? String(req.body.caption).trim() : null,
        category: req.body.category || "food",
        published: toBoolean(req.body.published, true),
        sortOrder: Number(req.body.sortOrder || 0),
        restaurantId
      }
    });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "gallery.image.created", entityType: "RestaurantGalleryImage", entityId: image.id });
    res.status(201).json({ image });
  } catch (error) {
    next(error);
  }
}

async function updateGalleryImage(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.restaurantGalleryImage.findFirst({ where: { id: req.params.id, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Gallery image not found" });
    const data = pickEditable(req.body, ["title", "altText", "caption", "category", "sortOrder", "published"]);
    if (data.title !== undefined) data.title = data.title ? String(data.title).trim() : null;
    if (data.altText !== undefined) data.altText = data.altText ? String(data.altText).trim() : null;
    if (data.caption !== undefined) data.caption = data.caption ? String(data.caption).trim() : null;
    if (data.category !== undefined) data.category = data.category ? String(data.category).trim() : "food";
    if (data.sortOrder !== undefined) data.sortOrder = Number(data.sortOrder);
    if (data.published !== undefined) data.published = toBoolean(data.published, existing.published);
    const image = await prisma.restaurantGalleryImage.update({ where: { id: existing.id }, data });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "gallery.image.updated", entityType: "RestaurantGalleryImage", entityId: image.id, metadata: data });
    res.json({ image });
  } catch (error) {
    next(error);
  }
}

async function deleteGalleryImage(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.restaurantGalleryImage.findFirst({ where: { id: req.params.id, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Gallery image not found" });
    await prisma.restaurantGalleryImage.delete({ where: { id: existing.id } });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "gallery.image.deleted", entityType: "RestaurantGalleryImage", entityId: existing.id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

async function getSocialLinks(req, res, next) {
  try {
    const socialLinks = await prisma.restaurantSocialLink.findMany({ where: { restaurantId: restaurantIdFor(req) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    res.json({ socialLinks });
  } catch (error) {
    next(error);
  }
}

async function addSocialLink(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const platform = String(req.body.platform || "").trim().toLowerCase();
    if (!allowedSocialPlatforms.has(platform)) return res.status(400).json({ error: "Choose a supported social platform." });
    if (!isValidHttpsUrl(req.body.url)) return res.status(400).json({ error: "Enter a valid https URL." });
    const data = {
      url: req.body.url.trim(),
      enabled: toBoolean(req.body.enabled, true),
      sortOrder: Number(req.body.sortOrder || 0)
    };
    const existing = await prisma.restaurantSocialLink.findFirst({ where: { restaurantId, platform } });
    const socialLink = existing
      ? await prisma.restaurantSocialLink.update({ where: { id: existing.id }, data })
      : await prisma.restaurantSocialLink.create({ data: { ...data, platform, restaurantId } });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: existing ? "website.social.updated" : "website.social.created", entityType: "RestaurantSocialLink", entityId: socialLink.id, metadata: { platform } });
    res.status(existing ? 200 : 201).json({ socialLink });
  } catch (error) {
    next(error);
  }
}

async function updateSocialLink(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.restaurantSocialLink.findFirst({ where: { id: req.params.id, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Social link not found" });
    const data = pickEditable(req.body, ["url", "enabled", "sortOrder"]);
    if (data.url !== undefined) {
      if (!isValidHttpsUrl(data.url)) return res.status(400).json({ error: "Enter a valid https URL." });
      data.url = data.url.trim();
    }
    if (data.enabled !== undefined) data.enabled = toBoolean(data.enabled, existing.enabled);
    if (data.sortOrder !== undefined) data.sortOrder = Number(data.sortOrder);
    const socialLink = await prisma.restaurantSocialLink.update({ where: { id: existing.id }, data });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "website.social.updated", entityType: "RestaurantSocialLink", entityId: socialLink.id, metadata: data });
    res.json({ socialLink });
  } catch (error) {
    next(error);
  }
}

async function deleteSocialLink(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.restaurantSocialLink.findFirst({ where: { id: req.params.id, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Social link not found" });
    await prisma.restaurantSocialLink.delete({ where: { id: existing.id } });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "website.social.deleted", entityType: "RestaurantSocialLink", entityId: existing.id, metadata: { platform: existing.platform } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

router.get("/website", getWebsite);
router.patch("/website", updateWebsite);
router.get("/domain", getDomain);
router.patch("/domain", updateDomain);
router.post("/domain/verify", verifyDomain);
router.get("/gallery", getGallery);
router.post("/gallery", addGalleryImage);
router.patch("/gallery/:id", updateGalleryImage);
router.delete("/gallery/:id", deleteGalleryImage);
router.get("/social-links", getSocialLinks);
router.post("/social-links", addSocialLink);
router.patch("/social-links/:id", updateSocialLink);
router.delete("/social-links/:id", deleteSocialLink);
router.get("/:restaurantId/website", getWebsite);
router.patch("/:restaurantId/website", updateWebsite);
router.get("/:restaurantId/domain", getDomain);
router.patch("/:restaurantId/domain", updateDomain);
router.post("/:restaurantId/domain/verify", verifyDomain);
router.get("/:restaurantId/gallery", getGallery);
router.post("/:restaurantId/gallery", addGalleryImage);
router.patch("/:restaurantId/gallery/:id", updateGalleryImage);
router.delete("/:restaurantId/gallery/:id", deleteGalleryImage);
router.get("/:restaurantId/social-links", getSocialLinks);
router.post("/:restaurantId/social-links", addSocialLink);
router.patch("/:restaurantId/social-links/:id", updateSocialLink);
router.delete("/:restaurantId/social-links/:id", deleteSocialLink);

export default router;

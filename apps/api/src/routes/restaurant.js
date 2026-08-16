import bcrypt from "bcrypt";
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { entitlementDecision, FEATURE, FEATURE_LABELS, requiredPlanForFeature, USAGE_LIMIT } from "../config/entitlements.js";
import { requireAuth, requireRole, requireTenantAccess } from "../middleware/auth.js";
import { assertUsageLimitForRestaurant, featureGuard, loadRestaurantEntitlements } from "../middleware/entitlements.js";
import { validate } from "../middleware/validate.js";
import { recordAudit } from "../services/auditService.js";
import { sendAccountSetupEmail } from "../services/accountAccessService.js";
import { revokeAllUserSessions } from "../services/authSessionService.js";
import { notifyDriverAssignment, notifyOrderStatusUpdate } from "../services/notificationService.js";
import { buildReceiptPayload, issueOrderTrackingToken, receiptOrderInclude } from "../services/orderWorkflowService.js";
import {
  MENU_ITEM_CUSTOMIZATION_MODES,
  normalizeMenuItemCustomizationMode,
  removeMenuItemCustomizationSetting,
  updateMenuItemCustomizationSettings,
  updateMenuItemKitchenSettings,
  withMenuItemCustomizationMode
} from "../services/menuCustomizationService.js";
import { emitDeliveryUpdate, emitKitchenUpdate, emitOrderUpdate } from "../services/realtimeService.js";
import { deleteImageFromSupabaseStorage } from "../services/uploadService.js";
import { DNS_TARGET, ensureDomain, ensureWebsiteSettings } from "../services/websiteService.js";
import { domainInfoForRestaurant, domainUpdateDataForRestaurant } from "../services/domainService.js";
import {
  buildCustomerDetail,
  buildCustomerInsights,
  buildCustomerSummary,
  buildDriverInsights,
  buildOperationsReport,
  enrichCustomer,
  ensureRestaurantLocations,
  updateRestaurantLocation
} from "../services/restaurantMetricsService.js";
import { normalizeEmail } from "../utils/authSecurity.js";
import { isActiveTaxProfile } from "../services/taxDomain.js";

const router = Router();
const restaurantRoles = ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"];
router.use(requireAuth, requireRole(...restaurantRoles, "SUPER_ADMIN"), requireTenantAccess);

function restaurantIdFor(req) {
  if (req.resolvedRestaurantId) return req.resolvedRestaurantId;
  return req.user.role === "SUPER_ADMIN" ? req.params.restaurantId || req.body.restaurantId : req.tenantId;
}

function ceilDaysUntil(date) {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function buildIntroductoryProgramSummary(restaurant, entitlements) {
  const trial = restaurant.trialEnrollments?.[0] || null;
  const startedAt = restaurant.trialStartedAt || trial?.startedAt || null;
  const endsAt = restaurant.trialEndsAt || trial?.endsAt || null;
  const graceEndsAt = restaurant.trialGraceEndsAt || trial?.graceEndsAt || null;
  const enabled = restaurant.billingMode === "INTRO_TRIAL" || Boolean(trial);
  if (!enabled) {
    return {
      enabled: false,
      tenantLifecycleStatus: restaurant.tenantLifecycleStatus,
      paymentLifecycleStatus: restaurant.paymentLifecycleStatus,
      billingMode: restaurant.billingMode
    };
  }
  const totalDays = startedAt && endsAt ? Math.max(1, Math.ceil((new Date(endsAt).getTime() - new Date(startedAt).getTime()) / 86400000)) : null;
  const elapsedDays = startedAt ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 86400000)) : 0;
  return {
    enabled: true,
    name: restaurant.introductoryProgramName || trial?.programName || "Introductory Program",
    planCode: trial?.planCode || restaurant.platformSubscriptions?.[0]?.plan?.code || restaurant.subscriptions?.[0]?.plan?.code || null,
    tenantLifecycleStatus: restaurant.tenantLifecycleStatus,
    paymentLifecycleStatus: restaurant.paymentLifecycleStatus,
    billingMode: restaurant.billingMode,
    startedAt,
    endsAt,
    graceEndsAt,
    totalDays,
    daysRemaining: ceilDaysUntil(endsAt),
    dayNumber: totalDays ? Math.min(totalDays, elapsedDays + 1) : null,
    percentElapsed: totalDays ? Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100))) : 0,
    entitlements: entitlements?.features || entitlements?.enabledFeatures || [],
    paymentMethodRequired: restaurant.paymentLifecycleStatus === "PAYMENT_METHOD_REQUIRED",
    noAutomaticCharge: true,
    upcomingReminders: restaurant.notificationSchedules || [],
    savingsBaseline: restaurant.savingsBaseline || null
  };
}

async function assertMenuItemLimit(restaurantId) {
  const used = await prisma.menuItem.count({ where: { restaurantId } });
  return assertUsageLimitForRestaurant({ restaurantId, limitCode: USAGE_LIMIT.MENU_ITEMS, used, requestedIncrement: 1 });
}

async function assertStaffLimit(restaurantId) {
  const used = await prisma.user.count({
    where: {
      restaurantId,
      role: { in: ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "DRIVER"] },
      status: { not: "DELETED" }
    }
  });
  return assertUsageLimitForRestaurant({ restaurantId, limitCode: USAGE_LIMIT.STAFF_MEMBERS, used, requestedIncrement: 1 });
}

async function assertDeliveryZoneLimit(restaurantId) {
  const used = await prisma.deliveryZone.count({ where: { restaurantId, active: true } });
  return assertUsageLimitForRestaurant({ restaurantId, limitCode: USAGE_LIMIT.DELIVERY_ZONES, used, requestedIncrement: 1 });
}

async function assertGalleryImageLimit(restaurantId) {
  const used = await prisma.restaurantGalleryImage.count({ where: { restaurantId } });
  return assertUsageLimitForRestaurant({ restaurantId, limitCode: USAGE_LIMIT.GALLERY_IMAGES, used, requestedIncrement: 1 });
}

async function resolveRestaurantIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!identifier) return null;
  const byId = await prisma.restaurant.findUnique({
    where: { id: identifier },
    select: { id: true, slug: true, status: true }
  }).catch(() => null);
  if (byId) return byId;
  return prisma.restaurant.findUnique({
    where: { slug: identifier },
    select: { id: true, slug: true, status: true }
  }).catch(() => null);
}

router.param("restaurantId", async (req, res, next, value) => {
  try {
    const restaurant = await resolveRestaurantIdentifier(value);
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

router.use(["/onboarding", "/:restaurantId/onboarding"], featureGuard(FEATURE.ONBOARDING));
router.use("/:restaurantId/settings", featureGuard(FEATURE.BASIC_SETTINGS));
router.use("/:restaurantId/dashboard", featureGuard(FEATURE.BASIC_DASHBOARD));
router.use(["/:restaurantId/profile", "/:restaurantId/branding"], featureGuard(FEATURE.BASIC_SETTINGS));
router.use(["/website", "/:restaurantId/website", "/gallery", "/:restaurantId/gallery", "/social-links", "/:restaurantId/social-links"], featureGuard(FEATURE.BASIC_WEBSITE));
router.use(["/domain", "/:restaurantId/domain"], featureGuard(FEATURE.CUSTOM_DOMAIN));
router.use(["/:restaurantId/menu/items/:itemId/insights", "/:restaurantId/menu/insights"], featureGuard(FEATURE.MENU_INSIGHTS));
router.use(["/:restaurantId/menu", "/:restaurantId/menu-items", "/menu-items"], featureGuard(FEATURE.MENU_MANAGEMENT));
router.use([
  "/:restaurantId/orders/:orderId/assign-driver",
  "/:restaurantId/deliveries",
  "/:restaurantId/dispatch",
  "/:restaurantId/drivers"
], featureGuard(FEATURE.DRIVER_MANAGEMENT));
router.use([
  "/:restaurantId/orders/:orderId/print-kitchen-ticket",
  "/:restaurantId/orders/:orderId/print-customer-receipt",
  "/:restaurantId/orders/:orderId/print-guest-check",
  "/:restaurantId/orders/:orderId/print-driver-slip",
  "/:restaurantId/printing"
], featureGuard(FEATURE.PRINTING));
router.use("/:restaurantId/orders", featureGuard(FEATURE.ORDER_TRACKING));
router.use(["/:restaurantId/staff", "/:restaurantId/employees"], featureGuard(FEATURE.EMPLOYEE_MANAGEMENT));
router.use("/:restaurantId/customers", featureGuard(FEATURE.CUSTOMER_CRM));
router.use(["/:restaurantId/coupons", "/:restaurantId/promotions"], featureGuard(FEATURE.COUPONS));
router.use("/:restaurantId/loyalty", featureGuard(FEATURE.LOYALTY));
router.use("/:restaurantId/notification-settings", featureGuard(FEATURE.NOTIFICATIONS));
router.use("/:restaurantId/delivery-zones", featureGuard(FEATURE.DELIVERY_ZONES));
router.use("/:restaurantId/inventory", featureGuard(FEATURE.INVENTORY));
router.use("/:restaurantId/reports", featureGuard(FEATURE.REPORTS));
router.use("/:restaurantId/analytics", featureGuard(FEATURE.ANALYTICS));
router.use("/:restaurantId/locations", featureGuard(FEATURE.BASIC_SETTINGS));

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

function ticketModifiers(item) {
  if (Array.isArray(item.optionsJson)) return item.optionsJson;
  if (Array.isArray(item.optionsJson?.modifiers)) return item.optionsJson.modifiers;
  if (Array.isArray(item.optionsJson?.options)) return item.optionsJson.options;
  return [];
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
    const modifiers = ticketModifiers(item);
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

function guestCheckText(order) {
  return [
    "GUEST CHECK - UNPAID",
    "NOT A PAYMENT RECEIPT",
    "",
    customerReceiptText(order).replace(/^RECEIPT/, "ORDER")
  ].join("\n");
}

function driverSlipText(order) {
  return [
    `DRIVER SLIP #${order.orderNumber}`,
    `${order.restaurant?.businessName || order.restaurant?.name || "Restaurant"}`,
    `Pickup: ${[order.restaurant?.address, order.restaurant?.city, order.restaurant?.state, order.restaurant?.zip].filter(Boolean).join(", ") || "Restaurant location"}`,
    `Dropoff: ${order.deliveryAddress || "Customer delivery address"}`,
    `Customer: ${order.customer?.name || "Customer"}`,
    order.customer?.phone ? `Phone: ${order.customer.phone}` : null,
    `Status: ${order.status}`,
    "",
    "Items:",
    ...order.items.map((item) => `${item.quantity}x ${item.name}`),
    order.notes ? `Instructions: ${order.notes}` : null
  ].filter(Boolean).join("\n");
}

function receiptFormatFor(req) {
  const requested = req.body?.format || req.query?.format || "80mm";
  return requested === "58mm" ? "58mm" : "80mm";
}

function receiptKindFor(req, fallback = "customer") {
  const requested = String(req.body?.kind || req.query?.kind || fallback).toLowerCase();
  if (["kitchen", "kitchen_ticket"].includes(requested)) return "kitchen";
  if (["driver", "driver_slip"].includes(requested)) return "driver";
  if (["guest", "guest_check"].includes(requested)) return "guest";
  if (["test"].includes(requested)) return "test";
  return fallback === "receipt" ? "receipt" : "customer";
}

function receiptReprintFor(req) {
  return req.body?.reprint === true || req.query?.reprint === "1" || req.query?.reprint === "true";
}

function ticketTextForKind(order, kind) {
  if (kind === "kitchen") return kitchenTicketText(order);
  if (kind === "driver") return driverSlipText(order);
  if (kind === "guest") return guestCheckText(order);
  return customerReceiptText(order);
}

function auditActionForReceipt(kind, isReprint = false) {
  if (isReprint) return "receipt.reprinted";
  if (kind === "kitchen") return "print.kitchen_ticket";
  if (kind === "driver") return "print.driver_slip";
  if (kind === "guest") return "print.guest_check";
  return "print.customer_receipt";
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

async function persistMenuItemPosSettings(restaurantId, itemId, { customizationMode, sendToKitchen } = {}) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { settingsJson: true } });
  if (!restaurant) throw new Error("Restaurant not found");
  let nextSettings = restaurant.settingsJson;
  if (customizationMode !== undefined) {
    nextSettings = updateMenuItemCustomizationSettings(nextSettings, itemId, customizationMode);
  }
  if (sendToKitchen !== undefined) {
    nextSettings = updateMenuItemKitchenSettings(nextSettings, itemId, sendToKitchen);
  }
  if (nextSettings !== restaurant.settingsJson) {
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { settingsJson: nextSettings } });
  }
  return nextSettings;
}

async function removePersistedMenuItemCustomizationMode(restaurantId, itemId) {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { settingsJson: true } });
  if (!restaurant) return;
  const nextSettings = removeMenuItemCustomizationSetting(restaurant.settingsJson, itemId);
  if (nextSettings !== restaurant.settingsJson) {
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { settingsJson: nextSettings } });
  }
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
  "tax",
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

const businessHourDays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function normalizeTimeValue(value = "") {
  const raw = String(value || "").trim();
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const period = match[3].toUpperCase();
  if (period === "PM" && hour < 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function normalizeHourWindow(value = {}) {
  const source = asObject(value, null);
  if (!source) return null;
  const open = normalizeTimeValue(source.open || source.start || source.from);
  const close = normalizeTimeValue(source.close || source.end || source.to);
  if (!open || !close) return null;
  return { open, close, overnight: Boolean(source.overnight) };
}

function legacyHoursToConfig(value) {
  const label = compactString(value);
  if (!label || label.toLowerCase() === "closed") return { closed: true, windows: [], note: null };
  const parts = label.split(/\s+-\s+/);
  const open = normalizeTimeValue(parts[0]);
  const close = normalizeTimeValue(parts[1]);
  if (!open || !close) return { closed: false, windows: [], note: label };
  return { closed: false, windows: [{ open, close, overnight: close <= open }], note: null };
}

function normalizeStoreHours(input) {
  const source = asObject(input);
  return Object.fromEntries(businessHourDays.map((day) => {
    const value = source[day];
    if (typeof value === "string") return [day, legacyHoursToConfig(value)];
    const dayConfig = asObject(value, null);
    if (!dayConfig) return [day, { closed: true, windows: [], note: null }];
    const windows = (Array.isArray(dayConfig.windows) ? dayConfig.windows : [dayConfig])
      .map(normalizeHourWindow)
      .filter(Boolean);
    const closed = dayConfig.closed === true || (!windows.length && String(dayConfig.label || "").trim().toLowerCase() === "closed");
    return [day, {
      closed,
      windows: closed ? [] : windows,
      note: compactString(dayConfig.note || dayConfig.label)
    }];
  }));
}

function hasUsableHours(hours) {
  return Object.values(asObject(hours)).some((value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value.closed !== true && Array.isArray(value.windows) && value.windows.length > 0;
    }
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
  const activeLocations = (restaurant.locations || []).filter((location) => location.active !== false);
  const taxReady = activeLocations.length > 0 && activeLocations.every((location) =>
    (location.taxProfiles || []).some((profile) => isActiveTaxProfile(profile))
  );

  const sections = {
    business: hasText(restaurant.name) && hasText(restaurant.slug) && hasText(restaurant.phone) && hasText(restaurant.email) && hasText(restaurant.address) && hasText(restaurant.city) && hasText(restaurant.state) && hasText(restaurant.zip) && hasText(restaurant.timezone),
    owner: (restaurant.users || []).some((user) => ownerRoles.has(user.role) && user.status === "ACTIVE"),
    branding: hasText(website.logoUrl || restaurant.logoUrl) && hasText(website.heroImageUrl),
    content: hasText(website.heroTitle) && hasText(website.heroSubtitle) && hasText(website.aboutStory) && activeSectionCount(website.sectionSettingsJson) > 0,
    hours: hasUsableHours(hours),
    fulfillment: (restaurant.pickupEnabled || restaurant.deliveryEnabled) && hasDeliveryCoverage,
    tax: taxReady,
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
  if (!sections.tax) warnings.push({ step: "tax", message: "Financial checkout stays unavailable until every active location has an acknowledged, active tax profile." });
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
    orderingReady: websiteReady && sections.fulfillment && sections.menu && sections.tax && paymentReady,
    taxReady,
    taxStatus: taxReady ? "ACTIVE" : activeLocations[0]?.taxStatus || "UNCONFIGURED",
    paymentReady,
    paymentStatus: paymentReady ? "CONNECTED" : "NOT_CONNECTED",
    completionPercentage: Math.round((completedCount / Object.keys(sections).length) * 100),
    counts: {
      activeCategories: activeCategories.length,
      availableItems: availableItems.length,
      galleryImages: (restaurant.galleryImages || []).length,
      socialLinks: (restaurant.socialLinks || []).length,
      activeDeliveryZones: activeZones.length,
      activeLocations: activeLocations.length,
      taxReadyLocations: activeLocations.filter((location) => (location.taxProfiles || []).some((profile) => isActiveTaxProfile(profile))).length
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
      locations: { where: { active: true }, include: { taxProfiles: { orderBy: { effectiveAt: "desc" } } } },
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
      locations: { where: { active: true }, include: { taxProfiles: { orderBy: { effectiveAt: "desc" } } } },
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

const SETTINGS_SECTION_STATUS = {
  IMPLEMENTED: "IMPLEMENTED",
  READ_ONLY: "READ_ONLY",
  COMING_SOON: "COMING_SOON",
  PLAN_RESTRICTED: "PLAN_RESTRICTED",
  PERMISSION_RESTRICTED: "PERMISSION_RESTRICTED"
};

const restaurantSettingsRegistry = [
  { id: "account", label: "Account", category: "Account", detail: "Owner identity, session, password recovery, and account access.", status: SETTINGS_SECTION_STATUS.READ_ONLY, feature: FEATURE.BASIC_SETTINGS },
  { id: "restaurant-profile", label: "Restaurant Profile", category: "Restaurant", detail: "Business name, public name, contact information, address, timezone, and public identity.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.BASIC_SETTINGS, endpoint: "PATCH /api/restaurants/:restaurantId/profile" },
  { id: "locations", label: "Locations", category: "Restaurant", detail: "Primary location details, address, contact information, timezone, and multi-location foundation.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.BASIC_SETTINGS, endpoint: "PATCH /api/restaurants/:restaurantId/locations/:locationId" },
  { id: "business-hours", label: "Business Hours", category: "Restaurant", detail: "Store hours used by the public website and ordering surfaces.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.BASIC_WEBSITE, endpoint: "PATCH /api/restaurants/:restaurantId/website" },
  { id: "ordering", label: "Ordering", category: "Operations", detail: "Pickup, delivery, order readiness, and kitchen workflow configuration.", status: SETTINGS_SECTION_STATUS.READ_ONLY, feature: FEATURE.RESTAURANT_ORDERING },
  { id: "menu-catalog", label: "Menu/Catalog", category: "Operations", detail: "Menu categories, food items, photos, modifiers, availability, and food catalog controls.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.MENU_MANAGEMENT, endpoint: "POST/PATCH /api/restaurants/:restaurantId/menu" },
  { id: "payments", label: "Payments", category: "Operations", detail: "Customer checkout, Stripe Connect, and payout readiness.", status: SETTINGS_SECTION_STATUS.READ_ONLY, feature: FEATURE.ORDER_PAYMENTS },
  { id: "receipts-printing", label: "Receipts & Printing", category: "Operations", detail: "Kitchen tickets, customer receipts, printer targets, and future thermal printer integrations.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.PRINTING, endpoint: "PATCH /api/restaurants/:restaurantId/printing" },
  { id: "website-branding", label: "Website & Branding", category: "Website", detail: "Logo, hero image, brand colors, homepage content, and section visibility.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.BASIC_WEBSITE, endpoint: "PATCH /api/restaurants/:restaurantId/website" },
  { id: "gallery-social", label: "Gallery & Social", category: "Website", detail: "Public gallery photos, captions, visibility, and restaurant social links.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.BASIC_WEBSITE, endpoint: "POST/PATCH /api/restaurants/:restaurantId/gallery" },
  { id: "domains-seo", label: "Domains & SEO", category: "Website", detail: "Loohar subdomain, custom domain, SSL state, canonical URL, and search metadata.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.CUSTOM_DOMAIN, endpoint: "PATCH /api/restaurants/:restaurantId/domain" },
  { id: "staff-roles", label: "Staff & Roles", category: "Access", detail: "Owner, manager, cashier, kitchen, and driver account foundation.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.EMPLOYEE_MANAGEMENT, endpoint: "POST/PATCH /api/restaurants/:restaurantId/employees" },
  { id: "notifications", label: "Notifications", category: "Messaging", detail: "SMS and email event settings for orders, receipts, password resets, and welcome emails.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.NOTIFICATIONS, endpoint: "PATCH /api/restaurants/:restaurantId/notification-settings" },
  { id: "loyalty", label: "Loyalty", category: "Growth", detail: "Points, rewards, top loyalty customers, issued points, and redeemed points.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.LOYALTY, endpoint: "PATCH /api/restaurants/:restaurantId/loyalty/settings" },
  { id: "coupons", label: "Coupons", category: "Growth", detail: "Active promotions, redemption statistics, and campaign performance.", status: SETTINGS_SECTION_STATUS.READ_ONLY, feature: FEATURE.COUPONS },
  { id: "delivery-zones", label: "Delivery Zones", category: "Delivery", detail: "Delivery radius, fees, minimum order amounts, and future map boundaries.", status: SETTINGS_SECTION_STATUS.IMPLEMENTED, feature: FEATURE.DELIVERY_ZONES, endpoint: "POST/PATCH /api/restaurants/:restaurantId/delivery-zones" },
  { id: "pos-kiosk", label: "POS & Kiosk", category: "POS", detail: "Register configuration, devices, shifts, cash controls, card payments, and kiosk mode.", status: SETTINGS_SECTION_STATUS.READ_ONLY, feature: FEATURE.POS_REGISTER },
  { id: "security-audit", label: "Security & Audit Logs", category: "Security", detail: "Recent restaurant audit history, account events, and security trail.", status: SETTINGS_SECTION_STATUS.READ_ONLY, feature: FEATURE.BASIC_SETTINGS },
  { id: "billing-subscription", label: "Billing & Subscription", category: "Billing", detail: "Current plan, subscription status, Stripe ids, and entitlement source.", status: SETTINGS_SECTION_STATUS.READ_ONLY, feature: FEATURE.BASIC_SETTINGS },
  { id: "integrations", label: "Integrations", category: "Developer", detail: "Future partner integrations for delivery, accounting, marketing, and POS ecosystems.", status: SETTINGS_SECTION_STATUS.COMING_SOON, feature: FEATURE.BASIC_SETTINGS },
  { id: "developer-api", label: "Developer/API", category: "Developer", detail: "Future API keys, webhook delivery logs, and developer docs.", status: SETTINGS_SECTION_STATUS.COMING_SOON, feature: FEATURE.BASIC_SETTINGS }
];

function settingState(entry, entitlements) {
  if (entry.status === SETTINGS_SECTION_STATUS.COMING_SOON) return entry.status;
  const decision = entitlementDecision(entitlements, entry.feature || FEATURE.BASIC_SETTINGS, "GET");
  if (!decision.allowed) {
    return decision.code === "FEATURE_NOT_INCLUDED" ? SETTINGS_SECTION_STATUS.PLAN_RESTRICTED : SETTINGS_SECTION_STATUS.PERMISSION_RESTRICTED;
  }
  return entry.status || SETTINGS_SECTION_STATUS.READ_ONLY;
}

function settingsRegistryPayload(entitlements) {
  return restaurantSettingsRegistry.map((entry) => ({
    ...entry,
    state: settingState(entry, entitlements),
    featureLabel: FEATURE_LABELS[entry.feature] || entry.feature || "Restaurant settings",
    requiredPlan: entry.feature ? requiredPlanForFeature(entry.feature) : null
  }));
}

async function settingsSectionSnapshot(req, sectionId) {
  const restaurantId = restaurantIdFor(req);
  if (sectionId === "account") {
    return { user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, status: req.user.status } };
  }
  if (sectionId === "restaurant-profile" || sectionId === "ordering" || sectionId === "payments" || sectionId === "billing-subscription") {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        platformSubscriptions: { include: { plan: true }, orderBy: { updatedAt: "desc" }, take: 1 },
        subscriptions: { include: { plan: true }, orderBy: { currentPeriodStart: "desc" }, take: 1 }
      }
    });
    return { restaurant };
  }
  if (sectionId === "locations") {
    const locations = await prisma.restaurantLocation.findMany({ where: { restaurantId }, orderBy: { createdAt: "asc" } });
    return { locations };
  }
  if (sectionId === "menu-catalog") {
    const [categories, items] = await Promise.all([
      prisma.menuCategory.findMany({ where: { restaurantId }, orderBy: { sortOrder: "asc" } }),
      prisma.menuItem.findMany({ where: { restaurantId }, include: { category: true, optionGroups: { include: { options: true } } }, orderBy: { createdAt: "desc" } })
    ]);
    return { categories, items };
  }
  if (["business-hours", "website-branding"].includes(sectionId)) {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    const website = restaurant ? await ensureWebsiteSettings(restaurant) : null;
    return { restaurant, website };
  }
  if (sectionId === "gallery-social") {
    const [gallery, socialLinks] = await Promise.all([
      prisma.restaurantGalleryImage.findMany({ where: { restaurantId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }),
      prisma.restaurantSocialLink.findMany({ where: { restaurantId }, orderBy: { createdAt: "desc" } })
    ]);
    return { gallery, socialLinks };
  }
  if (sectionId === "domains-seo") {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    const domain = restaurant ? await ensureDomain(restaurant) : null;
    return { domain: restaurant && domain ? domainInfoForRestaurant(restaurant, domain) : null };
  }
  if (sectionId === "receipts-printing") {
    const settings = await prisma.restaurantPrinterSettings.upsert({ where: { restaurantId }, update: {}, create: { restaurantId } });
    return { settings, printerTargets: ["browser_print", "star_micronics_future", "epson_future", "thermal_printer_future"] };
  }
  if (sectionId === "staff-roles") {
    const employees = await prisma.user.findMany({
      where: { restaurantId, role: { in: ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "DRIVER"] }, status: { not: "DELETED" } },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" }
    });
    return { employees };
  }
  if (sectionId === "notifications") {
    const settings = await prisma.restaurantNotificationSettings.upsert({ where: { restaurantId }, update: {}, create: { restaurantId } });
    return { settings, providers: { sms: process.env.SMS_PROVIDER || "console", email: process.env.EMAIL_PROVIDER || "console" } };
  }
  if (sectionId === "loyalty") {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { loyaltySettingsJson: true } });
    const rewards = await prisma.loyaltyReward.findMany({ where: { restaurantId }, orderBy: { createdAt: "desc" }, take: 20 });
    return { settings: restaurant?.loyaltySettingsJson || {}, rewards };
  }
  if (sectionId === "coupons") {
    const coupons = await prisma.coupon.findMany({ where: { restaurantId }, orderBy: { createdAt: "desc" }, take: 20 });
    return { coupons };
  }
  if (sectionId === "delivery-zones") {
    const zones = await prisma.deliveryZone.findMany({ where: { restaurantId }, orderBy: { createdAt: "asc" } });
    return { zones };
  }
  if (sectionId === "pos-kiosk") {
    const [devices, currentShift] = await Promise.all([
      prisma.posDevice?.findMany ? prisma.posDevice.findMany({ where: { restaurantId }, orderBy: { createdAt: "desc" }, take: 20 }).catch(() => []) : [],
      prisma.employeeShift?.findFirst ? prisma.employeeShift.findFirst({ where: { restaurantId, closedAt: null }, orderBy: { openedAt: "desc" } }).catch(() => null) : null
    ]);
    return { devices, currentShift };
  }
  if (sectionId === "security-audit") {
    const events = await prisma.auditLog.findMany({ where: { restaurantId }, orderBy: { createdAt: "desc" }, take: 25 });
    return { events };
  }
  return {};
}

async function getSettingsRegistry(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const entitlements = await loadRestaurantEntitlements(restaurantId, req);
    res.json({ settings: settingsRegistryPayload(entitlements), entitlements });
  } catch (error) {
    next(error);
  }
}

async function searchSettings(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const query = String(req.query.q || "").trim().toLowerCase();
    const entitlements = await loadRestaurantEntitlements(restaurantId, req);
    const settings = settingsRegistryPayload(entitlements).filter((entry) => {
      if (!query) return true;
      return [entry.label, entry.category, entry.detail, entry.featureLabel].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    });
    res.json({ settings, query });
  } catch (error) {
    next(error);
  }
}

async function getSettingsAudit(req, res, next) {
  try {
    const events = await prisma.auditLog.findMany({ where: { restaurantId: restaurantIdFor(req) }, orderBy: { createdAt: "desc" }, take: 50 });
    res.json({ events });
  } catch (error) {
    next(error);
  }
}

async function getSettingsSection(req, res, next) {
  try {
    const sectionId = String(req.params.section || "").trim();
    const entry = restaurantSettingsRegistry.find((item) => item.id === sectionId);
    if (!entry) return res.status(404).json({ error: "Settings section not found" });
    const entitlements = await loadRestaurantEntitlements(restaurantIdFor(req), req);
    const section = {
      ...entry,
      state: settingState(entry, entitlements),
      featureLabel: FEATURE_LABELS[entry.feature] || entry.feature || "Restaurant settings",
      requiredPlan: entry.feature ? requiredPlanForFeature(entry.feature) : null
    };
    const data = await settingsSectionSnapshot(req, sectionId);
    res.json({ section, data, entitlements });
  } catch (error) {
    next(error);
  }
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

router.get("/:restaurantId/settings", getSettingsRegistry);
router.get("/:restaurantId/settings/search", searchSettings);
router.get("/:restaurantId/settings/audit", getSettingsAudit);
router.get("/:restaurantId/settings/:section", getSettingsSection);

router.get("/me", async (req, res, next) => {
  try {
    if (!req.tenantId) return res.status(404).json({ error: "No restaurant assigned to this user" });
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.tenantId },
      include: {
        websiteSettings: true,
        domains: true,
        subscriptions: { include: { plan: true } },
        platformSubscriptions: { include: { plan: true }, orderBy: { updatedAt: "desc" }, take: 1 },
        locations: true,
        trialEnrollments: { orderBy: { createdAt: "desc" }, take: 1 },
        notificationSchedules: { where: { status: "SCHEDULED" }, orderBy: { scheduledFor: "asc" }, take: 6 },
        savingsBaseline: true
      }
    });
    if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
    const entitlements = await loadRestaurantEntitlements(req.tenantId, req);
    const introductoryProgram = buildIntroductoryProgramSummary(restaurant, entitlements);
    res.json({ restaurant: { ...restaurant, entitlements, introductoryProgram }, entitlements, introductoryProgram });
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
    customizationMode: z.enum(MENU_ITEM_CUSTOMIZATION_MODES).default("AUTO"),
    sendToKitchen: z.boolean().default(true),
    options: z.array(z.object({ name: z.string(), priceCents: z.number().int().default(0), required: z.boolean().default(false) })).default([])
  })
});

router.get("/:restaurantId/menu/items", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const [items, restaurant] = await Promise.all([
      prisma.menuItem.findMany({ where: { restaurantId }, include: { category: true, options: true, optionGroups: { include: { options: true } } }, orderBy: { name: "asc" } }),
      prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { settingsJson: true } })
    ]);
    res.json({ items: items.map((item) => withMenuItemCustomizationMode(item, restaurant?.settingsJson)) });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/menu/items", validate(menuItemSchema), async (req, res, next) => {
  try {
    const { options, customizationMode, sendToKitchen, ...data } = req.body;
    const restaurantId = restaurantIdFor(req);
    const category = await prisma.menuCategory.findUnique({ where: { id_restaurantId: { id: data.categoryId, restaurantId } }, select: { id: true } });
    if (!category) return res.status(400).json({ error: "Select a valid menu category for this restaurant." });
    await assertMenuItemLimit(restaurantId);
    const item = await prisma.menuItem.create({
      data: { ...menuItemUpdateData(data), restaurantId, options: { create: options } },
      include: { category: true, options: true, optionGroups: { include: { options: true } } }
    });
    const settingsJson = await persistMenuItemPosSettings(restaurantId, item.id, { customizationMode, sendToKitchen });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.item.created", entityType: "MenuItem", entityId: item.id, metadata: { customizationMode: normalizeMenuItemCustomizationMode(customizationMode), sendToKitchen } });
    res.status(201).json({ item: withMenuItemCustomizationMode(item, settingsJson) });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/menu/items/:itemId", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const data = menuItemUpdateData(req.body);
    const requestedCustomizationMode = req.body.customizationMode === undefined
      ? undefined
      : String(req.body.customizationMode || "").trim().toUpperCase();
    if (requestedCustomizationMode !== undefined && !MENU_ITEM_CUSTOMIZATION_MODES.includes(requestedCustomizationMode)) {
      return res.status(400).json({ error: "Select a valid customization prompt." });
    }
    const customizationMode = req.body.customizationMode === undefined
      ? undefined
      : normalizeMenuItemCustomizationMode(requestedCustomizationMode);
    const sendToKitchen = req.body.sendToKitchen;
    if (sendToKitchen !== undefined && typeof sendToKitchen !== "boolean") {
      return res.status(400).json({ error: "Kitchen preparation must be enabled or disabled." });
    }
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
    const settingsJson = customizationMode === undefined && sendToKitchen === undefined
      ? (await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { settingsJson: true } }))?.settingsJson
      : await persistMenuItemPosSettings(restaurantId, item.id, { customizationMode, sendToKitchen });
    await recordAudit({ actorUserId: req.user.id, restaurantId, action: "menu.item.updated", entityType: "MenuItem", entityId: item.id, metadata: { ...data, ...(customizationMode === undefined ? {} : { customizationMode }), ...(sendToKitchen === undefined ? {} : { sendToKitchen }) } });
    res.json({ item: withMenuItemCustomizationMode(item, settingsJson) });
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
    await removePersistedMenuItemCustomizationMode(restaurantId, req.params.itemId);
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

function intInRange(value, fallback, min = 0, max = 999999) {
  const parsed = Number.parseInt(value, 10);
  const next = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, next));
}

function modifierHttpError(message, code = "MENU_MODIFIER_INVALID") {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function sanitizeModifierOptions(options = []) {
  if (!Array.isArray(options)) throw modifierHttpError("Modifier options must be an array.");
  return options
    .map((option, index) => ({
      name: String(option?.name || "").trim().slice(0, 120),
      priceCents: intInRange(option?.priceCents, 0, 0, 999999),
      required: Boolean(option?.required),
      isDefault: Boolean(option?.isDefault),
      sortOrder: intInRange(option?.sortOrder, index, 0, 999)
    }))
    .filter((option) => option.name);
}

function sanitizeModifierGroupPayload(body = {}, { partial = false } = {}) {
  const name = String(body?.name || "").trim().slice(0, 120);
  if (!partial && !name) throw modifierHttpError("Modifier group name is required.");
  const minSelect = intInRange(body?.minSelect, 0, 0, 99);
  const maxSelect = intInRange(body?.maxSelect, 1, 1, 99);
  if (minSelect > maxSelect) throw modifierHttpError("Minimum selections cannot be greater than maximum selections.", "MENU_MODIFIER_RANGE_INVALID");
  const groupData = {
    ...(name ? { name } : {}),
    ...(body.required === undefined ? {} : { required: Boolean(body.required) }),
    ...(!partial || body.minSelect !== undefined ? { minSelect } : {}),
    ...(!partial || body.maxSelect !== undefined ? { maxSelect } : {}),
    ...(!partial || body.sortOrder !== undefined ? { sortOrder: intInRange(body?.sortOrder, 0, 0, 999) } : {})
  };
  return {
    groupData,
    ...(body.options === undefined ? {} : { options: sanitizeModifierOptions(body.options) })
  };
}

async function createItemOptionGroup(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const item = await prisma.menuItem.findUnique({ where: { id_restaurantId: { id: req.params.itemId, restaurantId } } });
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    const { groupData, options = [] } = sanitizeModifierGroupPayload(req.body);
    if (!options.length) throw modifierHttpError("At least one modifier option is required.", "MENU_MODIFIER_OPTION_REQUIRED");
    const optionGroup = await prisma.menuItemOptionGroup.create({
      data: {
        ...groupData,
        menuItemId: item.id,
        options: { create: options.map((option, index) => ({ ...option, menuItemId: item.id, sortOrder: option.sortOrder ?? index })) }
      },
      include: { options: { orderBy: { sortOrder: "asc" } } }
    });
    await recordAudit({
      actorUserId: req.user.id,
      restaurantId,
      action: "menu.item.modifiers.created",
      entityType: "MenuItemOptionGroup",
      entityId: optionGroup.id,
      metadata: { itemId: item.id, optionCount: optionGroup.options.length }
    });
    res.status(201).json({ optionGroup });
  } catch (error) {
    next(error);
  }
}

async function updateItemOptionGroup(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const item = await prisma.menuItem.findUnique({ where: { id_restaurantId: { id: req.params.itemId, restaurantId } } });
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    const existing = await prisma.menuItemOptionGroup.findFirst({ where: { id: req.params.optionGroupId, menuItemId: item.id } });
    if (!existing) return res.status(404).json({ error: "Option group not found" });
    const { groupData, options } = sanitizeModifierGroupPayload(req.body, { partial: true });
    if (options) await prisma.menuItemOption.deleteMany({ where: { optionGroupId: existing.id } });
    const optionGroup = await prisma.menuItemOptionGroup.update({
      where: { id: existing.id },
      data: {
        ...groupData,
        ...(options ? { options: { create: options.map((option, index) => ({ ...option, menuItemId: item.id, sortOrder: option.sortOrder ?? index })) } } : {})
      },
      include: { options: { orderBy: { sortOrder: "asc" } } }
    });
    await recordAudit({
      actorUserId: req.user.id,
      restaurantId,
      action: "menu.item.modifiers.updated",
      entityType: "MenuItemOptionGroup",
      entityId: optionGroup.id,
      metadata: { itemId: item.id, optionCount: optionGroup.options.length }
    });
    res.json({ optionGroup });
  } catch (error) {
    next(error);
  }
}

async function deleteItemOptionGroup(req, res, next) {
  try {
    const restaurantId = restaurantIdFor(req);
    const item = await prisma.menuItem.findUnique({ where: { id_restaurantId: { id: req.params.itemId, restaurantId } } });
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    const existing = await prisma.menuItemOptionGroup.findFirst({ where: { id: req.params.optionGroupId, menuItemId: item.id } });
    if (!existing) return res.status(404).json({ error: "Option group not found" });
    await prisma.menuItemOption.deleteMany({ where: { optionGroupId: existing.id } });
    await prisma.menuItemOptionGroup.delete({ where: { id: existing.id } });
    await recordAudit({
      actorUserId: req.user.id,
      restaurantId,
      action: "menu.item.modifiers.deleted",
      entityType: "MenuItemOptionGroup",
      entityId: existing.id,
      metadata: { itemId: item.id }
    });
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
      include: { statusHistory: true, delivery: true, customer: true, restaurant: true, items: true, location: true }
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
    res.json(await buildDriverInsights(restaurantIdFor(req), req.query));
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
    const insights = await buildDriverInsights(restaurantIdFor(req), req.query);
    res.json({ drivers: insights.drivers, summary: insights.summary, range: insights.range });
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
    const restaurantId = restaurantIdFor(req);
    await assertStaffLimit(restaurantId);
    const passwordHash = await bcrypt.hash(generateTemporaryPassword(), 12);
    const email = normalizeEmail(req.body.email);
    const user = await prisma.user.create({
      data: { email, name: req.body.name, passwordHash, role: req.body.role, restaurantId, phone: req.body.phone, forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: null }
    });
    const staff = await prisma.restaurantStaff.create({ data: { restaurantId, userId: user.id, role: req.body.role, permissionsJson: req.body.permissionsJson || permissionsForRole(req.body.role) } });
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
    await assertStaffLimit(restaurantId);
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
    const normalizedStatus = req.body.status ? req.body.status.toString().toUpperCase() : null;
    const revokeSessions = role !== existing.role || (normalizedStatus && normalizedStatus !== "ACTIVE");
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(req.body.name ? { name: req.body.name } : {}),
        ...(req.body.email ? { email: normalizeEmail(req.body.email) } : {}),
        ...(req.body.phone !== undefined ? { phone: req.body.phone } : {}),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        role,
        ...(revokeSessions ? { sessionVersion: { increment: 1 } } : {})
      }
    });
    if (revokeSessions) {
      await revokeAllUserSessions({ userId: user.id, reason: role !== existing.role ? "employee_role_changed" : `employee_status_${normalizedStatus.toLowerCase()}` });
    }
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
    const user = await prisma.user.update({ where: { id: existing.id }, data: { status: "SUSPENDED", sessionVersion: { increment: 1 } }, include: { staffProfile: true, driverProfile: true } });
    await revokeAllUserSessions({ userId: user.id, reason: "employee_disabled" });
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
    res.json(await buildCustomerInsights(restaurantIdFor(req), req.query));
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/customers/summary", async (req, res, next) => {
  try {
    res.json(await buildCustomerSummary(restaurantIdFor(req), req.query));
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/customers/:customerId", async (req, res, next) => {
  try {
    const customer = await buildCustomerDetail(restaurantIdFor(req), req.params.customerId, req.query);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json({ customer });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/customers/:customerId/notes", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const existing = await prisma.customer.findFirst({ where: { id: req.params.customerId, restaurantId } });
    if (!existing) return res.status(404).json({ error: "Customer not found" });
    const updateData = {};
    if (req.body.notes !== undefined) updateData.notes = req.body.notes || "";
    if (req.body.segment) updateData.segment = req.body.segment;
    const customer = await prisma.customer.update({ where: { id: existing.id }, data: updateData, include: { orders: true, loyaltyPoints: true } });
    await recordAudit({
      actorUserId: req.user.id,
      restaurantId,
      action: "customer.updated",
      entityType: "Customer",
      entityId: customer.id,
      metadata: { fields: Object.keys(updateData) }
    });
    res.json({ customer: enrichCustomer(customer) });
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
    const format = receiptFormatFor(req);
    const isReprint = receiptReprintFor(req);
    const order = await prisma.order.findUnique({
      where: { id_restaurantId: { id: req.params.orderId, restaurantId } },
      include: receiptOrderInclude()
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const ticket = ticketTextForKind(order, kind);
    const issued = await issueOrderTrackingToken(order.id);
    await recordAudit({
      actorUserId: req.user.id,
      restaurantId,
      action: auditActionForReceipt(kind, isReprint),
      entityType: "Order",
      entityId: order.id,
      metadata: { kind, format, isReprint }
    });
    res.json({
      printJob: { kind, provider: "browser_print", orderId: order.id, orderNumber: order.orderNumber, ticket, format, isReprint },
      receipt: buildReceiptPayload(issued.order, { kind, trackingToken: issued.trackingToken, format, isReprint })
    });
  } catch (error) {
    next(error);
  }
}

router.get("/:restaurantId/orders/:orderId/receipt", async (req, res, next) => {
  try {
    const restaurantId = restaurantIdFor(req);
    const kind = receiptKindFor(req);
    const format = receiptFormatFor(req);
    const isReprint = receiptReprintFor(req);
    const order = await prisma.order.findUnique({
      where: { id_restaurantId: { id: req.params.orderId, restaurantId } },
      include: receiptOrderInclude()
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const issued = await issueOrderTrackingToken(order.id);
    await recordAudit({
      actorUserId: req.user.id,
      restaurantId,
      action: "receipt.previewed",
      entityType: "Order",
      entityId: order.id,
      metadata: { kind, format, isReprint }
    }).catch(() => {});
    res.json({ receipt: buildReceiptPayload(issued.order, { kind, trackingToken: issued.trackingToken, format, isReprint }) });
  } catch (error) {
    next(error);
  }
});

router.post("/:restaurantId/orders/:orderId/print-kitchen-ticket", (req, res, next) => printOrder(req, res, next, "kitchen"));
router.post("/:restaurantId/orders/:orderId/print-customer-receipt", (req, res, next) => printOrder(req, res, next, "receipt"));
router.post("/:restaurantId/orders/:orderId/print-guest-check", (req, res, next) => printOrder(req, res, next, "guest"));
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
    await assertDeliveryZoneLimit(restaurantId);
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
    const report = await buildOperationsReport(restaurantIdFor(req), req.query);
    res.json({ sales: report.sales, charts: report.charts, drilldowns: report.drilldowns, range: report.range });
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/reports/operations", async (req, res, next) => {
  try {
    res.json(await buildOperationsReport(restaurantIdFor(req), req.query));
  } catch (error) {
    next(error);
  }
});

router.get("/:restaurantId/analytics", async (req, res, next) => {
  try {
    const report = await buildOperationsReport(restaurantIdFor(req), req.query);
    res.json({
      metrics: report.sales,
      charts: report.charts,
      popularItems: report.items.topSellingItems,
      salesTrend: report.charts.salesTrend,
      ordersTrend: report.charts.ordersTrend,
      customerGrowth: report.charts.customerGrowth,
      loyaltyGrowth: report.charts.loyaltyGrowth
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
    res.json({ locations: await ensureRestaurantLocations(restaurantIdFor(req)) });
  } catch (error) {
    next(error);
  }
});

router.patch("/:restaurantId/locations/:locationId", async (req, res, next) => {
  try {
    res.json(await updateRestaurantLocation({
      restaurantId: restaurantIdFor(req),
      locationId: req.params.locationId,
      data: req.body,
      actorUserId: req.user.id
    }));
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
    await assertGalleryImageLimit(restaurantId);
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
    await deleteImageFromSupabaseStorage({ publicUrl: existing.imageUrl, restaurantId }).catch(() => null);
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

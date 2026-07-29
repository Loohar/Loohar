import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../../config/prisma.js";
import { recordAudit } from "../../services/auditService.js";
import { sendAccountSetupEmail } from "../../services/accountAccessService.js";
import { defaultTenantHost } from "../../services/domainService.js";
import { DNS_TARGET } from "../../services/websiteService.js";
import { normalizeEmail } from "../../utils/authSecurity.js";
import { assertStripePlatformConfigured, stripeForm, stripeRequest } from "../paymentProviders/stripeRest.js";

const PLAN_PRICE_ENV = {
  STARTER: {
    MONTHLY: "STRIPE_PLATFORM_STARTER_MONTHLY_PRICE_ID",
    ANNUAL: "STRIPE_PLATFORM_STARTER_ANNUAL_PRICE_ID",
    LEGACY: "STRIPE_PLATFORM_PRICE_STARTER"
  },
  PROFESSIONAL: {
    MONTHLY: "STRIPE_PLATFORM_PRO_MONTHLY_PRICE_ID",
    ANNUAL: "STRIPE_PLATFORM_PRO_ANNUAL_PRICE_ID",
    LEGACY: "STRIPE_PLATFORM_PRICE_PROFESSIONAL"
  },
  ENTERPRISE: {
    MONTHLY: "STRIPE_PLATFORM_ENTERPRISE_MONTHLY_PRICE_ID",
    ANNUAL: "STRIPE_PLATFORM_ENTERPRISE_ANNUAL_PRICE_ID",
    LEGACY: "STRIPE_PLATFORM_PRICE_ENTERPRISE"
  }
};

const PLAN_PRICES = {
  STARTER: {
    MONTHLY: Number(process.env.PLATFORM_PLAN_STARTER_CENTS || process.env.PLATFORM_PLAN_STARTER_MONTHLY_CENTS || 9900),
    ANNUAL: Number(process.env.PLATFORM_PLAN_STARTER_ANNUAL_CENTS || 99000)
  },
  PROFESSIONAL: {
    MONTHLY: Number(process.env.PLATFORM_PLAN_PROFESSIONAL_CENTS || process.env.PLATFORM_PLAN_PROFESSIONAL_MONTHLY_CENTS || 19900),
    ANNUAL: Number(process.env.PLATFORM_PLAN_PROFESSIONAL_ANNUAL_CENTS || 199000)
  },
  ENTERPRISE: {
    MONTHLY: Number(process.env.PLATFORM_PLAN_ENTERPRISE_CENTS || process.env.PLATFORM_PLAN_ENTERPRISE_MONTHLY_CENTS || 39900),
    ANNUAL: Number(process.env.PLATFORM_PLAN_ENTERPRISE_ANNUAL_CENTS || 399000)
  }
};

const PLAN_FEATURES = {
  STARTER: ["Direct ordering website", "Pickup ordering", "Basic menu/catalog", "Restaurant onboarding"],
  PROFESSIONAL: ["Everything in Starter", "Delivery workflows", "Driver management", "Loyalty", "Coupons", "Delivery zones"],
  ENTERPRISE: ["Everything in Professional", "Advanced analytics", "Multi-location foundation", "Priority support"]
};

function slugify(value = "") {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function normalizePlanCode(planCode) {
  return ["STARTER", "PROFESSIONAL", "ENTERPRISE"].includes(planCode) ? planCode : "STARTER";
}

function normalizeBillingInterval(value) {
  return String(value || "MONTHLY").trim().toUpperCase() === "ANNUAL" ? "ANNUAL" : "MONTHLY";
}

function planPriceId(planCode, billingInterval = "MONTHLY") {
  const code = normalizePlanCode(planCode);
  const interval = normalizeBillingInterval(billingInterval);
  const envs = PLAN_PRICE_ENV[code];
  return process.env[envs[interval]] || (interval === "MONTHLY" ? process.env[envs.LEGACY] : "");
}

function sanitizeRegistrationPayload(body = {}) {
  const { password, confirmPassword, ownerPassword, ownerTemporaryPassword, passwordHash, ...safeBody } = body;
  return safeBody;
}

const defaultModules = ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"];
const operationalModules = [...defaultModules, "POS_REGISTER", "POS_KIOSK_MODE"];
const allowedBusinessTypes = new Set(["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"]);
const allowedModules = new Set(operationalModules);
const moduleLabelMap = {
  "restaurant ordering": "RESTAURANT_ORDERING",
  pickup: "PICKUP",
  delivery: "DELIVERY",
  "driver management": "DRIVER_MANAGEMENT",
  loyalty: "LOYALTY",
  coupons: "COUPONS",
  "delivery zones": "DELIVERY_ZONES",
  "food catalog": "FOOD_CATALOG",
  "pos register": "POS_REGISTER",
  pos: "POS_REGISTER",
  "pos kiosk": "POS_KIOSK_MODE",
  "kiosk mode": "POS_KIOSK_MODE"
};

const INTRO_PROGRAM_KEY = "loohar_introductory_program";
const DEFAULT_TRIAL_REMINDER_DAYS = [1, 30, 60, 75, 85, 90];
const allowedBillingModes = new Set(["INTRO_TRIAL", "PAYMENT_LINK", "STRIPE_CHECKOUT", "COMPLIMENTARY", "MANUAL_INVOICE", "DRAFT"]);

const defaultCategoriesByBusinessType = {
  RESTAURANT: ["Appetizers", "Soups", "Salads", "Lunch", "Dinner", "Desserts", "Drinks"],
  BAKERY: ["Cakes", "Pastries", "Bread", "Coffee", "Tea", "Desserts"],
  LIQUOR_STORE: ["Beer", "Wine", "Whiskey", "Vodka", "Rum", "Tequila", "Mixers"],
  COFFEE_SHOP: ["Espresso", "Coffee", "Tea", "Breakfast", "Bakery", "Sandwiches"]
};

function defaultCategoriesFor(businessType) {
  return defaultCategoriesByBusinessType[businessType] || defaultCategoriesByBusinessType.RESTAURANT;
}

function normalizeBusinessType(value) {
  const normalized = String(value || "RESTAURANT").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return allowedBusinessTypes.has(normalized) ? normalized : "RESTAURANT";
}

function normalizeModules(values) {
  const modules = (Array.isArray(values) ? values : []).map((value) => {
    const raw = String(value || "").trim();
    const enumValue = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (allowedModules.has(enumValue)) return enumValue;
    return moduleLabelMap[raw.toLowerCase()];
  }).filter(Boolean);
  return [...new Set(modules.length ? modules : defaultModules)];
}

function generatedAdminEmail(ownerEmail, slug) {
  const [local, domain] = normalizeEmail(ownerEmail).split("@");
  if (!domain) return `admin+${slug}@loohar.local`;
  return `${local}+admin@${domain}`;
}

function generateTemporaryPassword() {
  return `Temp-${crypto.randomBytes(9).toString("base64url")}1!`;
}

function boolFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function normalizeBillingMode(value) {
  const normalized = String(value || "INTRO_TRIAL").trim().toUpperCase();
  return allowedBillingModes.has(normalized) ? normalized : "INTRO_TRIAL";
}

function lifecycleForBillingMode(billingMode) {
  if (billingMode === "DRAFT") return "DRAFT";
  if (billingMode === "COMPLIMENTARY") return "COMPLIMENTARY";
  if (billingMode === "MANUAL_INVOICE") return "MANUAL_INVOICE";
  if (billingMode === "PAYMENT_LINK" || billingMode === "STRIPE_CHECKOUT") return "PENDING_PAYMENT";
  return "INTRO_TRIAL";
}

function paymentLifecycleForBillingMode(billingMode, programConfig) {
  if (billingMode === "COMPLIMENTARY") return "COMPLIMENTARY";
  if (billingMode === "MANUAL_INVOICE") return "MANUAL_INVOICE";
  if (billingMode === "DRAFT") return "NOT_REQUIRED";
  if (billingMode === "INTRO_TRIAL" && !programConfig.requirePaymentMethodAtSignup) return "NOT_REQUIRED";
  return "PENDING_PAYMENT";
}

function platformBillingStatusForMode(billingMode) {
  if (billingMode === "INTRO_TRIAL") return "TRIALING";
  if (billingMode === "COMPLIMENTARY" || billingMode === "MANUAL_INVOICE") return "ACTIVE";
  return "INCOMPLETE";
}

function providerForBillingMode(billingMode) {
  if (billingMode === "INTRO_TRIAL") return "loohar_introductory_program";
  if (billingMode === "COMPLIMENTARY") return "loohar_complimentary";
  if (billingMode === "MANUAL_INVOICE") return "loohar_manual_invoice";
  if (billingMode === "DRAFT") return "loohar_draft";
  return "stripe_platform";
}

function publicNameFromPayload(payload = {}) {
  return payload.publicBusinessName || payload.businessName || payload.name || "New Restaurant";
}

function configSnapshot(programConfig) {
  return {
    key: programConfig.key,
    introductoryProgramEnabled: programConfig.introductoryProgramEnabled,
    programName: programConfig.programName,
    defaultTrialDays: programConfig.defaultTrialDays,
    requirePaymentMethodAtSignup: programConfig.requirePaymentMethodAtSignup,
    requirePaymentMethodBeforeExpirationDay: programConfig.requirePaymentMethodBeforeExpirationDay,
    autoChargeWithoutExplicitAuthorization: false,
    defaultTrialPlan: programConfig.defaultTrialPlan,
    defaultTrialModules: programConfig.defaultTrialModules,
    trialReminderSchedule: programConfig.trialReminderSchedule,
    trialGracePeriodDays: programConfig.trialGracePeriodDays,
    autoSuspendAfterGracePeriod: programConfig.autoSuspendAfterGracePeriod,
    savingsReportEnabled: programConfig.savingsReportEnabled,
    aiInsightsEnabled: programConfig.aiInsightsEnabled,
    marketingAutomationEnabled: programConfig.marketingAutomationEnabled,
    smsEnabled: programConfig.smsEnabled,
    emailEnabled: programConfig.emailEnabled,
    pushEnabled: programConfig.pushEnabled
  };
}

function tenantIncludeForProvisioning() {
  return {
    users: { select: { id: true, email: true, name: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: true, lastLoginAt: true, createdAt: true, updatedAt: true } },
    websiteSettings: true,
    domains: true,
    deliveryZones: true,
    locations: true,
    subscriptions: { include: { plan: true } },
    platformSubscriptions: { include: { plan: true } },
    trialEnrollments: true,
    notificationSchedules: true,
    savingsBaseline: true,
    _count: { select: { orders: true, menuItems: true, drivers: true, customers: true } }
  };
}

function notificationRowsFor({ restaurantId, programConfig, startedAt, endsAt }) {
  if (!programConfig.emailEnabled && !programConfig.smsEnabled && !programConfig.pushEnabled) return [];
  const configured = Array.isArray(programConfig.trialReminderSchedule)
    ? programConfig.trialReminderSchedule
    : DEFAULT_TRIAL_REMINDER_DAYS;
  const offsets = [...new Set(configured.map((day) => Number(day)).filter((day) => Number.isFinite(day) && day >= 0 && day <= programConfig.defaultTrialDays))];
  return offsets.map((day) => {
    const scheduledFor = day >= programConfig.defaultTrialDays ? endsAt : addDays(startedAt, day);
    return {
      restaurantId,
      type: `intro_trial_day_${day}`,
      channel: programConfig.emailEnabled ? "email" : programConfig.smsEnabled ? "sms" : "push",
      scheduledFor,
      dedupeKey: `${restaurantId}:intro-trial:${day}`,
      metadataJson: {
        day,
        programKey: programConfig.key,
        programName: programConfig.programName,
        noAutomaticCharge: true
      }
    };
  });
}

export async function getIntroductoryProgramConfig({ tx = prisma } = {}) {
  const defaultTrialDays = numberFromEnv("LOOHAR_INTRO_TRIAL_DAYS", numberFromEnv("PLATFORM_BILLING_TRIAL_DAYS", 90));
  const trialGracePeriodDays = numberFromEnv("LOOHAR_INTRO_GRACE_PERIOD_DAYS", 7);
  const reminderSchedule = (process.env.LOOHAR_INTRO_REMINDER_DAYS || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return tx.platformProgramConfig.upsert({
    where: { key: INTRO_PROGRAM_KEY },
    create: {
      key: INTRO_PROGRAM_KEY,
      introductoryProgramEnabled: boolFromEnv("LOOHAR_INTRO_PROGRAM_ENABLED", true),
      programName: process.env.LOOHAR_INTRO_PROGRAM_NAME || `${defaultTrialDays}-Day Introductory Program`,
      defaultTrialDays,
      requirePaymentMethodAtSignup: boolFromEnv("LOOHAR_INTRO_REQUIRE_PAYMENT_METHOD_AT_SIGNUP", false),
      requirePaymentMethodBeforeExpirationDay: numberFromEnv("LOOHAR_INTRO_REQUIRE_PAYMENT_METHOD_BEFORE_EXPIRATION_DAY", 15),
      autoChargeWithoutExplicitAuthorization: false,
      allowSuperAdminComplimentaryAccounts: boolFromEnv("LOOHAR_ALLOW_COMPLIMENTARY_ACCOUNTS", true),
      allowManualInvoice: boolFromEnv("LOOHAR_ALLOW_MANUAL_INVOICE", true),
      defaultTrialPlan: normalizePlanCode(process.env.LOOHAR_INTRO_DEFAULT_PLAN || "PROFESSIONAL"),
      defaultTrialModules: defaultModules,
      trialReminderSchedule: reminderSchedule.length ? reminderSchedule : DEFAULT_TRIAL_REMINDER_DAYS,
      trialGracePeriodDays,
      autoSuspendAfterGracePeriod: boolFromEnv("LOOHAR_INTRO_AUTO_SUSPEND_AFTER_GRACE", false),
      allowTrialExtension: boolFromEnv("LOOHAR_INTRO_ALLOW_EXTENSION", true),
      maximumTrialExtensionDays: numberFromEnv("LOOHAR_INTRO_MAX_EXTENSION_DAYS", 30),
      savingsReportEnabled: boolFromEnv("LOOHAR_SAVINGS_REPORT_ENABLED", true),
      aiInsightsEnabled: boolFromEnv("LOOHAR_AI_INSIGHTS_ENABLED", true),
      marketingAutomationEnabled: boolFromEnv("LOOHAR_MARKETING_AUTOMATION_ENABLED", false),
      smsEnabled: boolFromEnv("LOOHAR_SMS_ENABLED", false),
      emailEnabled: boolFromEnv("LOOHAR_EMAIL_ENABLED", true),
      pushEnabled: boolFromEnv("LOOHAR_PUSH_ENABLED", false)
    },
    update: {
      introductoryProgramEnabled: boolFromEnv("LOOHAR_INTRO_PROGRAM_ENABLED", true),
      programName: process.env.LOOHAR_INTRO_PROGRAM_NAME || `${defaultTrialDays}-Day Introductory Program`,
      defaultTrialDays,
      requirePaymentMethodAtSignup: boolFromEnv("LOOHAR_INTRO_REQUIRE_PAYMENT_METHOD_AT_SIGNUP", false),
      requirePaymentMethodBeforeExpirationDay: numberFromEnv("LOOHAR_INTRO_REQUIRE_PAYMENT_METHOD_BEFORE_EXPIRATION_DAY", 15),
      autoChargeWithoutExplicitAuthorization: false,
      defaultTrialPlan: normalizePlanCode(process.env.LOOHAR_INTRO_DEFAULT_PLAN || "PROFESSIONAL"),
      defaultTrialModules: defaultModules,
      trialReminderSchedule: reminderSchedule.length ? reminderSchedule : DEFAULT_TRIAL_REMINDER_DAYS,
      trialGracePeriodDays,
      autoSuspendAfterGracePeriod: boolFromEnv("LOOHAR_INTRO_AUTO_SUSPEND_AFTER_GRACE", false),
      allowTrialExtension: boolFromEnv("LOOHAR_INTRO_ALLOW_EXTENSION", true),
      maximumTrialExtensionDays: numberFromEnv("LOOHAR_INTRO_MAX_EXTENSION_DAYS", 30),
      savingsReportEnabled: boolFromEnv("LOOHAR_SAVINGS_REPORT_ENABLED", true),
      aiInsightsEnabled: boolFromEnv("LOOHAR_AI_INSIGHTS_ENABLED", true),
      marketingAutomationEnabled: boolFromEnv("LOOHAR_MARKETING_AUTOMATION_ENABLED", false),
      smsEnabled: boolFromEnv("LOOHAR_SMS_ENABLED", false),
      emailEnabled: boolFromEnv("LOOHAR_EMAIL_ENABLED", true),
      pushEnabled: boolFromEnv("LOOHAR_PUSH_ENABLED", false),
      active: true
    }
  });
}

async function ensureTenantSubscriptionPlan(tx, planCode) {
  const code = normalizePlanCode(planCode);
  const name = code[0] + code.slice(1).toLowerCase();
  return tx.subscriptionPlan.upsert({
    where: { code },
    create: {
      code,
      name,
      monthlyPriceCents: PLAN_PRICES[code].MONTHLY,
      maxLocations: code === "ENTERPRISE" ? null : 1,
      maxDrivers: code === "STARTER" ? 0 : code === "PROFESSIONAL" ? 25 : null,
      featuresJson: { source: "introductory_program", features: PLAN_FEATURES[code] || [] }
    },
    update: {
      name,
      monthlyPriceCents: PLAN_PRICES[code].MONTHLY,
      maxLocations: code === "ENTERPRISE" ? null : 1,
      maxDrivers: code === "STARTER" ? 0 : code === "PROFESSIONAL" ? 25 : null,
      featuresJson: { source: "introductory_program", features: PLAN_FEATURES[code] || [] }
    }
  });
}

export async function provisionRestaurantTenant({
  body = {},
  actorUserId = null,
  source = "SUPER_ADMIN",
  pendingId = null,
  planCode: requestedPlanCode,
  billingInterval: requestedBillingInterval,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripeCheckoutSessionId = null,
  idempotencyKey = null,
  auditMetadata = undefined
} = {}) {
  const pending = pendingId ? await prisma.pendingRegistration.findUnique({ where: { id: pendingId } }) : null;
  if (pending?.restaurantId) {
    const existing = await prisma.restaurant.findUnique({ where: { id: pending.restaurantId }, include: tenantIncludeForProvisioning() });
    return { restaurant: existing, generatedAccounts: { delivery: "already_provisioned" } };
  }
  if (pending?.expiresAt && pending.expiresAt < new Date()) {
    await prisma.pendingRegistration.update({ where: { id: pending.id }, data: { status: "EXPIRED" } });
    const error = new Error("This registration reservation has expired. Start again to reserve the slug.");
    error.status = 410;
    throw error;
  }

  const registration = pending?.registrationJson && typeof pending.registrationJson === "object" ? pending.registrationJson : {};
  const payload = { ...registration, ...body };
  const businessName = payload.businessName || pending?.businessName || payload.name || publicNameFromPayload(payload);
  const publicBusinessName = payload.publicBusinessName || pending?.publicBusinessName || businessName;
  const slug = slugify(payload.slug || pending?.slug || publicBusinessName);
  const businessType = normalizeBusinessType(payload.businessType || pending?.businessType);
  const billingMode = normalizeBillingMode(payload.billingMode || registration.billingMode || (stripeSubscriptionId ? "STRIPE_CHECKOUT" : "INTRO_TRIAL"));
  const programConfig = await getIntroductoryProgramConfig();
  if (billingMode === "INTRO_TRIAL" && !programConfig.introductoryProgramEnabled) {
    const error = new Error("The introductory program is not currently available.");
    error.status = 403;
    throw error;
  }
  if (billingMode === "COMPLIMENTARY" && !programConfig.allowSuperAdminComplimentaryAccounts) {
    const error = new Error("Complimentary accounts are disabled by platform policy.");
    error.status = 403;
    throw error;
  }
  if (billingMode === "MANUAL_INVOICE" && !programConfig.allowManualInvoice) {
    const error = new Error("Manual invoice billing is disabled by platform policy.");
    error.status = 403;
    throw error;
  }

  const planCode = normalizePlanCode(requestedPlanCode || payload.planCode || payload.plan || pending?.planCode || programConfig.defaultTrialPlan);
  const billingInterval = normalizeBillingInterval(requestedBillingInterval || payload.billingInterval || pending?.billingInterval);
  const enabledModules = normalizeModules(payload.enabledModules || (billingMode === "INTRO_TRIAL" ? programConfig.defaultTrialModules : defaultModules));
  const ownerEmail = normalizeEmail(payload.ownerEmail || pending?.ownerEmail || payload.email);
  const ownerName = payload.ownerName || pending?.ownerName || `${publicBusinessName} Owner`;
  const restaurantAdminEmail = normalizeEmail(payload.restaurantAdminEmail || generatedAdminEmail(ownerEmail, slug));
  const restaurantEmail = normalizeEmail(payload.businessEmail || payload.email || ownerEmail);
  const now = new Date();
  const trialStartedAt = billingMode === "INTRO_TRIAL" ? now : null;
  const trialEndsAt = billingMode === "INTRO_TRIAL" ? addDays(now, programConfig.defaultTrialDays) : null;
  const trialGraceEndsAt = trialEndsAt ? addDays(trialEndsAt, programConfig.trialGracePeriodDays) : null;
  const lifecycleStatus = lifecycleForBillingMode(billingMode);
  const paymentLifecycleStatus = paymentLifecycleForBillingMode(billingMode, programConfig);
  const platformBillingStatus = platformBillingStatusForMode(billingMode);
  const snapshot = configSnapshot(programConfig);

  if (!ownerEmail) {
    const error = new Error("Owner email is required.");
    error.status = 400;
    throw error;
  }
  if (source === "PUBLIC_REGISTRATION" && !pending?.registrationJson?.ownerUserId) {
    const error = new Error("Registration owner account is missing. Restart registration before starting the introductory program.");
    error.status = 409;
    throw error;
  }

  const ownerTemporaryPassword = source === "PUBLIC_REGISTRATION" ? null : generateTemporaryPassword();
  const adminTemporaryPassword = source === "PUBLIC_REGISTRATION" ? null : generateTemporaryPassword();
  const [ownerPasswordHash, adminPasswordHash] = await Promise.all([
    ownerTemporaryPassword ? bcrypt.hash(ownerTemporaryPassword, 12) : Promise.resolve(null),
    adminTemporaryPassword ? bcrypt.hash(adminTemporaryPassword, 12) : Promise.resolve(null)
  ]);

  const restaurant = await prisma.$transaction(async (tx) => {
    const existingRestaurant = await tx.restaurant.findUnique({ where: { slug }, select: { id: true } });
    if (existingRestaurant) {
      if (pending) {
        await tx.pendingRegistration.update({ where: { id: pending.id }, data: { restaurantId: existingRestaurant.id, status: "TENANT_CREATED", completedAt: new Date() } });
        return tx.restaurant.findUnique({ where: { id: existingRestaurant.id }, include: tenantIncludeForProvisioning() });
      }
      const error = new Error(`Slug "${slug}" is already used by another tenant.`);
      error.status = 409;
      throw error;
    }

    const ownerConflict = await tx.user.findFirst({
      where: {
        email: { equals: ownerEmail, mode: "insensitive" },
        restaurantId: { not: null },
        ...(pending?.registrationJson?.ownerUserId ? { id: { not: pending.registrationJson.ownerUserId } } : {})
      },
      select: { id: true }
    });
    if (ownerConflict) {
      const error = new Error(`Owner email "${ownerEmail}" is already attached to another tenant.`);
      error.status = 409;
      throw error;
    }

    const adminConflict = await tx.user.findFirst({ where: { email: { equals: restaurantAdminEmail, mode: "insensitive" }, restaurantId: { not: null } }, select: { id: true } });
    if (adminConflict) {
      const error = new Error(`Restaurant admin email "${restaurantAdminEmail}" is already attached to another tenant.`);
      error.status = 409;
      throw error;
    }

    const [tenantPlan, platformPlan] = await Promise.all([
      ensureTenantSubscriptionPlan(tx, planCode),
      tx.platformPlan.upsert({
        where: { code: planCode },
        create: {
          code: planCode,
          name: planCode[0] + planCode.slice(1).toLowerCase(),
          monthlyPriceCents: PLAN_PRICES[planCode].MONTHLY,
          annualPriceCents: PLAN_PRICES[planCode].ANNUAL,
          trialDays: programConfig.defaultTrialDays,
          stripePriceIdMonthly: planPriceId(planCode, "MONTHLY") || null,
          stripePriceIdAnnual: planPriceId(planCode, "ANNUAL") || null,
          featuresJson: { source: "introductory_program", features: PLAN_FEATURES[planCode] || [] }
        },
        update: {
          monthlyPriceCents: PLAN_PRICES[planCode].MONTHLY,
          annualPriceCents: PLAN_PRICES[planCode].ANNUAL,
          trialDays: programConfig.defaultTrialDays,
          stripePriceIdMonthly: planPriceId(planCode, "MONTHLY") || null,
          stripePriceIdAnnual: planPriceId(planCode, "ANNUAL") || null,
          featuresJson: { source: "introductory_program", features: PLAN_FEATURES[planCode] || [] }
        }
      })
    ]);

    const createdRestaurant = await tx.restaurant.create({
      data: {
        name: publicBusinessName,
        businessName,
        businessType,
        enabledModules,
        slug,
        status: billingMode === "DRAFT" ? "PENDING" : "ACTIVE",
        tenantLifecycleStatus: lifecycleStatus,
        paymentLifecycleStatus,
        billingMode,
        introductoryProgramName: billingMode === "INTRO_TRIAL" ? programConfig.programName : null,
        introductoryProgramVersion: 1,
        trialStartedAt,
        trialEndsAt,
        trialGraceEndsAt,
        trialConfigJson: billingMode === "INTRO_TRIAL" ? snapshot : null,
        description: payload.description || `Order directly from ${publicBusinessName}.`,
        settingsJson: {
          ...(payload.settingsJson || {}),
          enabledModules,
          categoryLabel: payload.categoryLabel || payload.cuisineType || "Restaurant",
          createdBy: source,
          billingMode,
          introductoryProgram: billingMode === "INTRO_TRIAL" ? snapshot : null,
          onlineOrderingEnabled: false
        },
        phone: payload.phone || payload.businessPhone || null,
        email: restaurantEmail,
        address: payload.address || null,
        city: payload.city || null,
        state: payload.state || null,
        zip: payload.zip || null,
        timezone: payload.timezone || "America/Denver",
        pickupEnabled: payload.pickupEnabled ?? true,
        deliveryEnabled: payload.deliveryEnabled ?? true,
        websiteSettings: {
          create: {
            websiteEnabled: payload.websiteEnabled ?? true,
            cuisineType: payload.categoryLabel || payload.cuisineType || "Restaurant",
            tagline: payload.tagline || payload.categoryLabel || "Restaurant",
            heroTitle: publicBusinessName,
            heroSubtitle: payload.homepageSubtitle || `Order directly from ${publicBusinessName}.`,
            brandColor: payload.brandColor || "#1f9d80",
            accentColor: payload.accentColor || "#f4b740"
          }
        },
        domains: {
          create: {
            defaultSubdomain: slug,
            primaryDomain: defaultTenantHost(slug),
            canonicalDomain: defaultTenantHost(slug),
            customDomain: null,
            dnsTarget: DNS_TARGET,
            domainStatus: "NOT_CONFIGURED",
            sslStatus: "NOT_CONFIGURED"
          }
        },
        locations: {
          create: {
            name: "Primary Location",
            address: [payload.address, payload.city, payload.state, payload.zip].filter(Boolean).join(", ") || null,
            phone: payload.phone || payload.businessPhone || null,
            timezone: payload.timezone || "America/Denver",
            settingsJson: { primary: true, source }
          }
        },
        categories: {
          create: defaultCategoriesFor(businessType).map((name, index) => ({ name, sortOrder: index + 1 }))
        }
      }
    });

    const owner = pending?.registrationJson?.ownerUserId
      ? await tx.user.update({
          where: { id: pending.registrationJson.ownerUserId },
          data: { email: ownerEmail, name: ownerName, role: "TENANT_OWNER", status: "ACTIVE", forcePasswordChange: false, temporaryPassword: false, restaurantId: createdRestaurant.id }
        })
      : await tx.user.create({
          data: {
            email: ownerEmail,
            name: ownerName,
            passwordHash: ownerPasswordHash,
            role: "TENANT_OWNER",
            status: "ACTIVE",
            forcePasswordChange: true,
            temporaryPassword: true,
            passwordChangedAt: null,
            restaurantId: createdRestaurant.id
          }
        });

    let restaurantAdmin = null;
    if (source !== "PUBLIC_REGISTRATION") {
      restaurantAdmin = await tx.user.create({
        data: {
          email: restaurantAdminEmail,
          name: `${publicBusinessName} Admin`,
          passwordHash: adminPasswordHash,
          role: "RESTAURANT_ADMIN",
          status: "ACTIVE",
          forcePasswordChange: true,
          temporaryPassword: true,
          passwordChangedAt: null,
          restaurantId: createdRestaurant.id
        }
      });
    }

    await tx.restaurantStaff.upsert({
      where: { userId: owner.id },
      create: { restaurantId: createdRestaurant.id, userId: owner.id, role: "TENANT_OWNER" },
      update: { restaurantId: createdRestaurant.id, role: "TENANT_OWNER", active: true }
    });
    if (restaurantAdmin) {
      await tx.restaurantStaff.create({ data: { restaurantId: createdRestaurant.id, userId: restaurantAdmin.id, role: "RESTAURANT_ADMIN" } });
    }

    await tx.tenantSubscription.create({
      data: {
        restaurantId: createdRestaurant.id,
        planId: tenantPlan.id,
        active: billingMode !== "DRAFT",
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        renewalDate: trialEndsAt,
        stripeCustomerId,
        stripeSubscriptionId
      }
    });
    const platformSubscription = await tx.platformSubscription.create({
      data: {
        restaurantId: createdRestaurant.id,
        planId: platformPlan.id,
        status: platformBillingStatus,
        provider: providerForBillingMode(billingMode),
        stripeCustomerId,
        stripeSubscriptionId,
        stripeCheckoutSessionId,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        trialEndsAt,
        metadataJson: {
          source,
          billingMode,
          billingInterval,
          introductoryProgram: billingMode === "INTRO_TRIAL" ? snapshot : null,
          noAutomaticCharge: true
        }
      }
    });

    if (billingMode === "INTRO_TRIAL") {
      await tx.trialEnrollment.create({
        data: {
          restaurantId: createdRestaurant.id,
          platformSubscriptionId: platformSubscription.id,
          programKey: programConfig.key,
          programName: programConfig.programName,
          programVersion: 1,
          planCode,
          billingMode,
          status: "INTRO_TRIAL",
          startedAt: trialStartedAt,
          endsAt: trialEndsAt,
          graceEndsAt: trialGraceEndsAt,
          configSnapshotJson: snapshot,
          createdByUserId: actorUserId
        }
      });
      const reminderRows = notificationRowsFor({ restaurantId: createdRestaurant.id, programConfig, startedAt: trialStartedAt, endsAt: trialEndsAt });
      if (reminderRows.length) await tx.notificationSchedule.createMany({ data: reminderRows, skipDuplicates: true });
      if (programConfig.savingsReportEnabled) {
        await tx.savingsBaseline.create({
          data: {
            restaurantId: createdRestaurant.id,
            status: "ACTIVE",
            baselineJson: {
              startingAt: now,
              marketplaceCommissionBps: 3000,
              directOrderingCommissionBps: 0,
              source: "introductory_program_default"
            },
            assumptionsJson: { editableBySuperAdmin: true, estimatesOnly: true }
          }
        });
      }
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        restaurantId: createdRestaurant.id,
        action: "business.created",
        entityType: "Business",
        entityId: createdRestaurant.id,
        metadataJson: { source, billingMode, planCode, ...(auditMetadata || {}) }
      }
    });
    if (billingMode === "INTRO_TRIAL") {
      await tx.auditLog.create({
        data: {
          actorUserId,
          restaurantId: createdRestaurant.id,
          action: "introductory_program.started",
          entityType: "TrialEnrollment",
          entityId: createdRestaurant.id,
          metadataJson: { programName: programConfig.programName, trialStartedAt, trialEndsAt, trialGraceEndsAt, noAutomaticCharge: true }
        }
      });
    }

    if (pending) {
      await tx.pendingRegistration.update({
        where: { id: pending.id },
        data: {
          status: "TENANT_CREATED",
          restaurantId: createdRestaurant.id,
          stripeCustomerId,
          completedAt: new Date(),
          registrationJson: { ...(pending.registrationJson || {}), billingMode, introductoryProgram: billingMode === "INTRO_TRIAL" ? snapshot : null }
        }
      });
      await tx.slugReservation.updateMany({ where: { slug }, data: { restaurantId: createdRestaurant.id, expiresAt: null } });
    }

    return tx.restaurant.findUnique({ where: { id: createdRestaurant.id }, include: tenantIncludeForProvisioning() });
  }, { timeout: 20_000 });

  if (source !== "PUBLIC_REGISTRATION") {
    const setupUsers = (restaurant?.users || []).filter((user) => user.temporaryPassword && ["TENANT_OWNER", "RESTAURANT_ADMIN"].includes(user.role));
    await Promise.allSettled(setupUsers.map((user) => sendAccountSetupEmail({ user })));
  }
  return {
    restaurant,
    generatedAccounts: {
      ownerEmail,
      restaurantAdminEmail: source === "PUBLIC_REGISTRATION" ? null : restaurantAdminEmail,
      delivery: source === "PUBLIC_REGISTRATION" ? "owner_registration_password" : "set_password_email",
      billingMode,
      noAutomaticCharge: true
    }
  };
}

async function activatePaidRegistration({ pending, stripeCustomerId, stripeSubscriptionId, stripeCheckoutSessionId }) {
  const result = await provisionRestaurantTenant({
    pendingId: pending.id,
    planCode: pending.planCode,
    billingInterval: pending.billingInterval,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeCheckoutSessionId,
    source: "PUBLIC_REGISTRATION",
    body: { billingMode: "STRIPE_CHECKOUT" }
  });
  return result.restaurant;
}

export async function ensurePlatformPlan(planCode) {
  const code = normalizePlanCode(planCode);
  const name = code[0] + code.slice(1).toLowerCase();
  return prisma.platformPlan.upsert({
    where: { code },
    create: {
      code,
      name,
      monthlyPriceCents: PLAN_PRICES[code].MONTHLY,
      annualPriceCents: PLAN_PRICES[code].ANNUAL,
      stripePriceIdMonthly: planPriceId(code, "MONTHLY") || null,
      stripePriceIdAnnual: planPriceId(code, "ANNUAL") || null,
      featuresJson: { source: "loohar_default", features: PLAN_FEATURES[code] }
    },
    update: {
      monthlyPriceCents: PLAN_PRICES[code].MONTHLY,
      annualPriceCents: PLAN_PRICES[code].ANNUAL,
      stripePriceIdMonthly: planPriceId(code, "MONTHLY") || null,
      stripePriceIdAnnual: planPriceId(code, "ANNUAL") || null,
      featuresJson: { source: "loohar_default", features: PLAN_FEATURES[code] }
    }
  });
}

export async function getPlatformPlans() {
  const [plans, introductoryProgram] = await Promise.all([
    Promise.all(["STARTER", "PROFESSIONAL", "ENTERPRISE"].map((code) => ensurePlatformPlan(code))),
    getIntroductoryProgramConfig()
  ]);
  return {
    introductoryProgram: {
      enabled: introductoryProgram.introductoryProgramEnabled,
      programName: introductoryProgram.programName,
      defaultTrialDays: introductoryProgram.defaultTrialDays,
      requirePaymentMethodAtSignup: introductoryProgram.requirePaymentMethodAtSignup,
      requirePaymentMethodBeforeExpirationDay: introductoryProgram.requirePaymentMethodBeforeExpirationDay,
      autoChargeWithoutExplicitAuthorization: false,
      defaultTrialPlan: introductoryProgram.defaultTrialPlan,
      defaultTrialModules: introductoryProgram.defaultTrialModules,
      trialGracePeriodDays: introductoryProgram.trialGracePeriodDays,
      savingsReportEnabled: introductoryProgram.savingsReportEnabled,
      aiInsightsEnabled: introductoryProgram.aiInsightsEnabled
    },
    plans: plans
      .filter((plan) => plan.active)
      .map((plan) => ({
        code: plan.code,
        displayName: plan.name,
        description: `${plan.name} plan for restaurant-owned direct ordering.`,
        monthlyPriceCents: plan.monthlyPriceCents,
        annualPriceCents: plan.annualPriceCents,
        features: PLAN_FEATURES[plan.code] || [],
        trialDays: introductoryProgram.defaultTrialDays,
        introductoryProgramAvailable: introductoryProgram.introductoryProgramEnabled,
        introductoryProgramName: introductoryProgram.programName,
        paymentMethodRequiredAtSignup: introductoryProgram.requirePaymentMethodAtSignup,
        autoChargeWithoutExplicitAuthorization: false,
        locationLimit: plan.code === "ENTERPRISE" ? null : 1,
        staffLimit: plan.code === "STARTER" ? 5 : plan.code === "PROFESSIONAL" ? 25 : null,
        active: plan.active,
        monthlyCheckoutAvailable: Boolean(plan.stripePriceIdMonthly),
        annualCheckoutAvailable: Boolean(plan.stripePriceIdAnnual),
        checkoutAvailable: Boolean(plan.stripePriceIdMonthly || plan.stripePriceIdAnnual)
      }))
  };
}

export async function createPlatformCheckout({ body, user }) {
  assertStripePlatformConfigured();
  const billingInterval = normalizeBillingInterval(body.billingInterval);
  const requestedPlanCode = normalizePlanCode(body.planCode || body.plan);
  let pending;
  let planCode = requestedPlanCode;
  if (body.registrationId) {
    pending = await prisma.pendingRegistration.findUnique({ where: { id: body.registrationId } });
    if (!pending) {
      const error = new Error("Pending registration not found.");
      error.status = 404;
      throw error;
    }
    if (pending.restaurantId || ["TENANT_CREATED", "COMPLETED"].includes(pending.status)) {
      const error = new Error("Registration has already been provisioned.");
      error.status = 409;
      throw error;
    }
    if (pending.expiresAt && pending.expiresAt < new Date()) {
      await prisma.pendingRegistration.update({ where: { id: pending.id }, data: { status: "EXPIRED" } });
      const error = new Error("This registration reservation has expired. Start again to reserve the slug.");
      error.status = 410;
      throw error;
    }
    planCode = normalizePlanCode(body.planCode || pending.planCode);
  }
  const priceId = planPriceId(planCode, billingInterval);
  if (!priceId) {
    const envName = PLAN_PRICE_ENV[planCode][billingInterval] || PLAN_PRICE_ENV[planCode].LEGACY;
    const error = new Error(`Missing Stripe platform price ID for ${planCode} ${billingInterval}. Set ${envName}.`);
    error.status = 503;
    throw error;
  }
  await ensurePlatformPlan(planCode);
  const safeBody = sanitizeRegistrationPayload(body);
  const slug = pending?.slug || slugify(body.slug || body.businessName || body.publicBusinessName);
  const businessType = normalizeBusinessType(body.businessType);
  if (!pending) {
    pending = await prisma.pendingRegistration.upsert({
      where: { slug },
      create: {
        ownerEmail: body.ownerEmail || user?.email,
        normalizedEmail: normalizeEmail(body.ownerEmail || user?.email),
        ownerName: body.ownerName || user?.name,
        businessName: body.businessName || body.publicBusinessName,
        publicBusinessName: body.publicBusinessName || body.businessName,
        slug,
        businessType,
        planCode,
        billingInterval,
        status: "STARTED",
        registrationJson: { ...safeBody, billingInterval },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      },
      update: {
        ownerEmail: body.ownerEmail || user?.email,
        normalizedEmail: normalizeEmail(body.ownerEmail || user?.email),
        ownerName: body.ownerName || user?.name,
        businessName: body.businessName || body.publicBusinessName,
        publicBusinessName: body.publicBusinessName || body.businessName,
        businessType,
        planCode,
        billingInterval,
        status: "STARTED",
        registrationJson: { ...safeBody, billingInterval },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });
  } else {
    pending = await prisma.pendingRegistration.update({
      where: { id: pending.id },
      data: {
        planCode,
        billingInterval,
        status: "PAYMENT_PENDING",
        registrationJson: { ...(pending.registrationJson || {}), planCode, billingInterval }
      }
    });
  }
  await prisma.slugReservation.upsert({
    where: { slug },
    create: { slug, ownerEmail: pending.ownerEmail, expiresAt: pending.expiresAt },
    update: { ownerEmail: pending.ownerEmail, expiresAt: pending.expiresAt }
  });

  const successUrlTemplate = process.env.PLATFORM_BILLING_SUCCESS_URL || `${process.env.APP_URL || "https://loohar.com"}/register/status?registrationId={REGISTRATION_ID}&session_id={CHECKOUT_SESSION_ID}`;
  const successUrl = successUrlTemplate.replaceAll("{REGISTRATION_ID}", pending.id);
  const cancelUrl = process.env.PLATFORM_BILLING_CANCEL_URL || `${process.env.APP_URL || "https://loohar.com"}/register?billing=cancelled`;
  const form = stripeForm({
    mode: "subscription",
    customer_email: pending.ownerEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    "subscription_data[trial_period_days]": process.env.PLATFORM_BILLING_TRIAL_DAYS || undefined,
    "metadata[domain]": "PLATFORM_BILLING",
    "metadata[pendingRegistrationId]": pending.id,
    "metadata[slug]": pending.slug,
    "metadata[planCode]": planCode,
    "metadata[billingInterval]": billingInterval
  });
  const session = await stripeRequest({ secretKey: process.env.STRIPE_PLATFORM_SECRET_KEY, path: "/checkout/sessions", body: form });
  const updated = await prisma.pendingRegistration.update({
    where: { id: pending.id },
    data: {
      status: "CHECKOUT_CREATED",
      stripeCheckoutSessionId: session.id,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
      billingInterval
    }
  });
  return { checkoutUrl: session.url, sessionId: session.id, pendingRegistration: updated };
}

export async function createPlatformPortal({ user }) {
  assertStripePlatformConfigured();
  const subscription = await prisma.platformSubscription.findFirst({
    where: { restaurantId: user.restaurantId },
    orderBy: { createdAt: "desc" }
  });
  if (!subscription?.stripeCustomerId) {
    const error = new Error("No Stripe platform customer exists for this tenant subscription yet.");
    error.status = 404;
    throw error;
  }
  const form = stripeForm({
    customer: subscription.stripeCustomerId,
    return_url: process.env.PLATFORM_BILLING_PORTAL_RETURN_URL || `${process.env.APP_URL || "https://loohar.com"}/restaurant/${user.restaurantSlug || ""}/settings/payments`
  });
  const session = await stripeRequest({ secretKey: process.env.STRIPE_PLATFORM_SECRET_KEY, path: "/billing_portal/sessions", body: form });
  return { portalUrl: session.url };
}

export async function getPlatformSubscription({ user }) {
  const where = user.role === "SUPER_ADMIN" && !user.restaurantId ? {} : { restaurantId: user.restaurantId };
  const subscription = await prisma.platformSubscription.findFirst({
    where,
    include: { plan: true, invoices: { orderBy: { createdAt: "desc" }, take: 12 } },
    orderBy: { createdAt: "desc" }
  });
  return { subscription };
}

export async function cancelPlatformSubscription({ user }) {
  assertStripePlatformConfigured();
  const subscription = await prisma.platformSubscription.findFirst({ where: { restaurantId: user.restaurantId }, orderBy: { createdAt: "desc" } });
  if (!subscription?.stripeSubscriptionId) {
    const error = new Error("No active Stripe subscription found");
    error.status = 404;
    throw error;
  }
  const form = stripeForm({ cancel_at_period_end: "true" });
  const stripeSubscription = await stripeRequest({ secretKey: process.env.STRIPE_PLATFORM_SECRET_KEY, path: `/subscriptions/${subscription.stripeSubscriptionId}`, body: form });
  await recordAudit({
    actorUserId: user.id,
    restaurantId: user.restaurantId,
    action: "platform_subscription.cancel_requested",
    entityType: "PlatformSubscription",
    entityId: subscription.id,
    metadata: { stripeSubscriptionId: subscription.stripeSubscriptionId }
  });
  return {
    subscription,
    providerSubscription: {
      id: stripeSubscription.id,
      cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end),
      status: stripeSubscription.status || null
    },
    pendingWebhook: true
  };
}

function statusFromStripe(status = "") {
  const normalized = status.toUpperCase();
  if (normalized === "ACTIVE") return "ACTIVE";
  if (normalized === "TRIALING") return "TRIALING";
  if (normalized === "PAST_DUE") return "PAST_DUE";
  if (normalized === "CANCELED") return "CANCELED";
  if (normalized === "UNPAID") return "UNPAID";
  return "INCOMPLETE";
}

function dateFromUnix(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

export async function handleStripePlatformWebhook(payload = {}) {
  const eventType = payload.type || payload.eventType || "unknown";
  const object = payload.data?.object || payload.object || {};
  const eventId = payload.id || payload.providerEventId;
  const providerEventId = eventId || `manual-${eventType}-${object.id || Date.now()}`;
  const pendingRegistrationId = object.metadata?.pendingRegistrationId;
  let subscription = null;

  if (eventType === "checkout.session.completed") {
    const pending = pendingRegistrationId ? await prisma.pendingRegistration.findUnique({ where: { id: pendingRegistrationId } }) : null;
    if (pending) {
      const plan = await ensurePlatformPlan(pending.planCode);
      const stripeCustomerId = typeof object.customer === "string" ? object.customer : null;
      const stripeSubscriptionId = typeof object.subscription === "string" ? object.subscription : null;
      subscription = await prisma.platformSubscription.findFirst({
        where: { stripeCheckoutSessionId: object.id }
      });
      if (!subscription) {
        subscription = await prisma.platformSubscription.create({
          data: {
            restaurantId: pending.restaurantId,
            planId: plan.id,
            status: "ACTIVE",
            provider: "stripe_platform",
            stripeCustomerId,
            stripeSubscriptionId,
            stripeCheckoutSessionId: object.id,
            metadataJson: { pendingRegistrationId: pending.id, slug: pending.slug }
          }
        });
      }
      const paidPending = await prisma.pendingRegistration.update({
        where: { id: pending.id },
        data: { status: pending.restaurantId ? pending.status : "PAYMENT_VERIFIED", stripeCustomerId }
      });
      await recordAudit({
        action: "registration.payment.confirmed",
        entityType: "PendingRegistration",
        entityId: pending.id,
        metadata: { checkoutSessionId: object.id, planCode: pending.planCode }
      }).catch(() => {});
      const restaurant = await activatePaidRegistration({
        pending: paidPending,
        plan,
        stripeCustomerId,
        stripeSubscriptionId,
        stripeCheckoutSessionId: object.id
      });
      if (restaurant?.id && !subscription.restaurantId) {
        subscription = await prisma.platformSubscription.update({
          where: { id: subscription.id },
          data: { restaurantId: restaurant.id }
        });
      }
    }
  }

  if (eventType?.startsWith("customer.subscription.")) {
    const stripeSubscriptionId = object.id;
    const existing = await prisma.platformSubscription.findFirst({ where: { stripeSubscriptionId } });
    if (existing) {
      subscription = await prisma.platformSubscription.update({
        where: { id: existing.id },
        data: {
          status: statusFromStripe(object.status),
          stripeCustomerId: typeof object.customer === "string" ? object.customer : existing.stripeCustomerId,
          currentPeriodStart: dateFromUnix(object.current_period_start),
          currentPeriodEnd: dateFromUnix(object.current_period_end),
          trialEndsAt: dateFromUnix(object.trial_end),
          cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
          canceledAt: dateFromUnix(object.canceled_at)
        }
      });
    }
  }

  await prisma.platformBillingEvent.upsert({
    where: { providerEventId },
    create: {
      subscriptionId: subscription?.id || null,
      eventDomain: "PLATFORM_BILLING",
      provider: "stripe_platform",
      providerEventId,
      eventType,
      payloadJson: payload,
      processedAt: new Date()
    },
    update: { processedAt: new Date() }
  });

  return { received: true, subscription };
}

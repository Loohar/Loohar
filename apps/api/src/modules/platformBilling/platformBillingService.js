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
const allowedBusinessTypes = new Set(["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"]);
const allowedModules = new Set(defaultModules);
const moduleLabelMap = {
  "restaurant ordering": "RESTAURANT_ORDERING",
  pickup: "PICKUP",
  delivery: "DELIVERY",
  "driver management": "DRIVER_MANAGEMENT",
  loyalty: "LOYALTY",
  coupons: "COUPONS",
  "delivery zones": "DELIVERY_ZONES",
  "food catalog": "FOOD_CATALOG"
};

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

async function activatePaidRegistration({ pending, plan, stripeCustomerId, stripeSubscriptionId, stripeCheckoutSessionId }) {
  if (pending.restaurantId) {
    return prisma.restaurant.findUnique({ where: { id: pending.restaurantId } });
  }

  const registration = pending.registrationJson && typeof pending.registrationJson === "object" ? pending.registrationJson : {};
  const ownerEmail = normalizeEmail(pending.ownerEmail);
  const restaurantAdminEmail = normalizeEmail(registration.restaurantAdminEmail || generatedAdminEmail(ownerEmail, pending.slug));
  const ownerTemporaryPassword = generateTemporaryPassword();
  const adminTemporaryPassword = generateTemporaryPassword();
  const [ownerPasswordHash, adminPasswordHash] = await Promise.all([
    bcrypt.hash(ownerTemporaryPassword, 12),
    bcrypt.hash(adminTemporaryPassword, 12)
  ]);
  const enabledModules = normalizeModules(registration.enabledModules);
  const restaurantName = pending.publicBusinessName || pending.businessName;
  const restaurantEmail = normalizeEmail(registration.businessEmail || registration.email || ownerEmail);
  const restaurant = await prisma.$transaction(async (tx) => {
    const existingRestaurant = await tx.restaurant.findUnique({ where: { slug: pending.slug }, select: { id: true } });
    if (existingRestaurant) {
      await tx.pendingRegistration.update({ where: { id: pending.id }, data: { restaurantId: existingRestaurant.id, status: "TENANT_CREATED", completedAt: new Date() } });
      await tx.slugReservation.updateMany({ where: { slug: pending.slug }, data: { restaurantId: existingRestaurant.id, expiresAt: null } });
      return tx.restaurant.findUnique({ where: { id: existingRestaurant.id } });
    }

    const ownerConflict = await tx.user.findFirst({ where: { email: { equals: ownerEmail, mode: "insensitive" }, restaurantId: { not: null } }, select: { id: true } });
    if (ownerConflict) {
      throw Object.assign(new Error(`Owner email "${ownerEmail}" is already attached to another tenant.`), { status: 409 });
    }
    const adminConflict = await tx.user.findFirst({ where: { email: { equals: restaurantAdminEmail, mode: "insensitive" }, restaurantId: { not: null } }, select: { id: true } });
    if (adminConflict) {
      throw Object.assign(new Error(`Restaurant admin email "${restaurantAdminEmail}" is already attached to another tenant.`), { status: 409 });
    }

    const createdRestaurant = await tx.restaurant.create({
      data: {
        name: restaurantName,
        businessName: pending.businessName,
        businessType: pending.businessType,
        enabledModules,
        slug: pending.slug,
        status: "ACTIVE",
        description: registration.description || `Order directly from ${restaurantName}.`,
        settingsJson: {
          enabledModules,
          categoryLabel: registration.categoryLabel || registration.cuisineType || "Restaurant",
          createdBy: "PLATFORM_REGISTRATION",
          onlineOrderingEnabled: false
        },
        phone: registration.phone || null,
        email: restaurantEmail,
        address: registration.address || null,
        city: registration.city || null,
        state: registration.state || null,
        zip: registration.zip || null,
        timezone: registration.timezone || "America/Denver",
        pickupEnabled: registration.pickupEnabled ?? true,
        deliveryEnabled: registration.deliveryEnabled ?? true,
        websiteSettings: {
          create: {
            websiteEnabled: registration.websiteEnabled ?? true,
            cuisineType: registration.categoryLabel || registration.cuisineType || "Restaurant",
            tagline: registration.tagline || registration.categoryLabel || "Restaurant",
            heroTitle: restaurantName,
            heroSubtitle: registration.homepageSubtitle || `Order directly from ${restaurantName}.`,
            brandColor: registration.brandColor || "#1f9d80",
            accentColor: registration.accentColor || "#f4b740"
          }
        },
        domains: {
          create: {
            defaultSubdomain: pending.slug,
            primaryDomain: defaultTenantHost(pending.slug),
            canonicalDomain: defaultTenantHost(pending.slug),
            customDomain: null,
            dnsTarget: DNS_TARGET,
            domainStatus: "NOT_CONFIGURED",
            sslStatus: "NOT_CONFIGURED"
          }
        },
        categories: {
          create: defaultCategoriesFor(pending.businessType).map((name, index) => ({ name, sortOrder: index + 1 }))
        }
      }
    });

    const owner = await tx.user.upsert({
      where: { email: ownerEmail },
      create: {
        email: ownerEmail,
        name: pending.ownerName || `${restaurantName} Owner`,
        passwordHash: ownerPasswordHash,
        role: "TENANT_OWNER",
        status: "ACTIVE",
        forcePasswordChange: true,
        temporaryPassword: true,
        restaurantId: createdRestaurant.id
      },
      update: {
        name: pending.ownerName || `${restaurantName} Owner`,
        role: "TENANT_OWNER",
        status: "ACTIVE",
        restaurantId: createdRestaurant.id
      }
    });
    const restaurantAdmin = await tx.user.upsert({
      where: { email: restaurantAdminEmail },
      create: {
        email: restaurantAdminEmail,
        name: `${restaurantName} Admin`,
        passwordHash: adminPasswordHash,
        role: "RESTAURANT_ADMIN",
        status: "ACTIVE",
        forcePasswordChange: true,
        temporaryPassword: true,
        restaurantId: createdRestaurant.id
      },
      update: {
        name: `${restaurantName} Admin`,
        role: "RESTAURANT_ADMIN",
        status: "ACTIVE",
        restaurantId: createdRestaurant.id
      }
    });
    await tx.restaurantStaff.upsert({
      where: { userId: owner.id },
      create: { restaurantId: createdRestaurant.id, userId: owner.id, role: "TENANT_OWNER" },
      update: { restaurantId: createdRestaurant.id, role: "TENANT_OWNER", active: true }
    });
    await tx.restaurantStaff.upsert({
      where: { userId: restaurantAdmin.id },
      create: { restaurantId: createdRestaurant.id, userId: restaurantAdmin.id, role: "RESTAURANT_ADMIN" },
      update: { restaurantId: createdRestaurant.id, role: "RESTAURANT_ADMIN", active: true }
    });
    await tx.platformSubscription.updateMany({
      where: { stripeCheckoutSessionId, restaurantId: null },
      data: { restaurantId: createdRestaurant.id }
    });
    await tx.auditLog.create({
      data: {
        restaurantId: createdRestaurant.id,
        action: "registration.provisioning.started",
        entityType: "PendingRegistration",
        entityId: pending.id,
        metadataJson: { slug: pending.slug, planCode: pending.planCode }
      }
    });
    await tx.pendingRegistration.update({
      where: { id: pending.id },
      data: {
        status: "TENANT_CREATED",
        restaurantId: createdRestaurant.id,
        stripeCustomerId,
        completedAt: new Date()
      }
    });
    await tx.slugReservation.updateMany({ where: { slug: pending.slug }, data: { restaurantId: createdRestaurant.id, expiresAt: null } });
    await tx.platformBillingEvent.create({
      data: {
        eventDomain: "PLATFORM_BILLING",
        provider: "loohar",
        providerEventId: `registration.${pending.id}.tenant_created`,
        eventType: "registration.tenant_created",
        payloadJson: { pendingRegistrationId: pending.id, restaurantId: createdRestaurant.id, stripeSubscriptionId },
        processedAt: new Date()
      }
    });
    await tx.auditLog.create({
      data: {
        restaurantId: createdRestaurant.id,
        action: "registration.tenant.created",
        entityType: "Restaurant",
        entityId: createdRestaurant.id,
        metadataJson: { pendingRegistrationId: pending.id, slug: pending.slug }
      }
    });
    await tx.auditLog.create({
      data: {
        restaurantId: createdRestaurant.id,
        actorUserId: owner.id,
        action: "registration.owner.assigned",
        entityType: "User",
        entityId: owner.id,
        metadataJson: { pendingRegistrationId: pending.id, role: owner.role }
      }
    });
    await tx.auditLog.create({
      data: {
        restaurantId: createdRestaurant.id,
        action: "registration.completed",
        entityType: "PendingRegistration",
        entityId: pending.id,
        metadataJson: { slug: pending.slug, restaurantId: createdRestaurant.id }
      }
    });
    return tx.restaurant.findUnique({
      where: { id: createdRestaurant.id },
      include: { users: true }
    });
  }, { timeout: 20_000 });

  const setupUsers = (restaurant?.users || []).filter((user) => user.temporaryPassword && ["TENANT_OWNER", "RESTAURANT_ADMIN"].includes(user.role));
  await Promise.allSettled(setupUsers.map((user) => sendAccountSetupEmail({ user })));
  await recordAudit({ restaurantId: restaurant?.id, action: "business.created", entityType: "Business", entityId: restaurant?.id, metadata: { source: "platform_billing_webhook" } });
  return restaurant;
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
  const plans = await Promise.all(["STARTER", "PROFESSIONAL", "ENTERPRISE"].map((code) => ensurePlatformPlan(code)));
  return {
    plans: plans
      .filter((plan) => plan.active)
      .map((plan) => ({
        code: plan.code,
        displayName: plan.name,
        description: `${plan.name} plan for restaurant-owned direct ordering.`,
        monthlyPriceCents: plan.monthlyPriceCents,
        annualPriceCents: plan.annualPriceCents,
        features: PLAN_FEATURES[plan.code] || [],
        trialDays: Number(process.env.PLATFORM_BILLING_TRIAL_DAYS || 0),
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
  const updated = await prisma.platformSubscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end), status: stripeSubscription.status?.toUpperCase() === "ACTIVE" ? "ACTIVE" : "PAST_DUE" }
  });
  await recordAudit({ actorUserId: user.id, restaurantId: user.restaurantId, action: "platform_subscription.cancel_at_period_end", entityType: "PlatformSubscription", entityId: updated.id });
  return { subscription: updated };
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

import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma.js";
import { recordAudit } from "../../services/auditService.js";
import { defaultTenantHost } from "../../services/domainService.js";
import { maskEmail, normalizeEmail } from "../../utils/authSecurity.js";
import { validatePublicSlug } from "../../../../shared/reservedSlugs.js";
import { createPlatformCheckout, getPlatformPlans } from "../platformBilling/platformBillingService.js";

const REGISTRATION_TTL_MS = 60 * 60 * 1000;
const terminalStatuses = new Set(["TENANT_CREATED", "COMPLETED", "FAILED", "EXPIRED", "CANCELED", "CANCELLED"]);

function slugify(value = "") {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
}

function normalizePlanCode(value) {
  return ["STARTER", "PROFESSIONAL", "ENTERPRISE"].includes(value) ? value : "STARTER";
}

function normalizeBillingInterval(value) {
  return String(value || "MONTHLY").trim().toUpperCase() === "ANNUAL" ? "ANNUAL" : "MONTHLY";
}

function normalizeBusinessType(value) {
  const normalized = String(value || "RESTAURANT").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return ["RESTAURANT", "COFFEE_SHOP", "BAKERY", "FOOD_TRUCK", "CONVENIENCE_STORE", "GAS_STATION_FOOD_SHOP", "LIQUOR_STORE", "OTHER_FOOD_RETAIL"].includes(normalized) ? normalized : "RESTAURANT";
}

function safeRegistrationJson(body = {}, ownerUserId) {
  return {
    ownerUserId,
    ownerFirstName: body.firstName,
    ownerLastName: body.lastName,
    ownerPhone: body.phone,
    businessEmail: normalizeEmail(body.businessEmail),
    phone: body.businessPhone || body.phone,
    address: body.address,
    city: body.city,
    state: body.state,
    zip: body.zip,
    country: body.country || "US",
    timezone: body.timezone || "America/Denver",
    categoryLabel: body.cuisine || body.categoryLabel || "Restaurant",
    cuisineType: body.cuisine || body.categoryLabel || "Restaurant",
    pickupEnabled: true,
    deliveryEnabled: true,
    websiteEnabled: true,
    enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"],
    planCode: normalizePlanCode(body.planCode),
    billingInterval: normalizeBillingInterval(body.billingInterval),
    tosAccepted: Boolean(body.termsAccepted),
    privacyAccepted: Boolean(body.privacyAccepted)
  };
}

function registrationSummary(registration) {
  if (!registration) return null;
  const status = registration.status;
  const complete = ["TENANT_CREATED", "COMPLETED"].includes(status);
  const publicUrl = complete ? `https://${defaultTenantHost(registration.slug)}` : `https://loohar.com/${registration.slug}`;
  return {
    id: registration.id,
    ownerEmail: maskEmail(registration.ownerEmail),
    restaurantName: registration.publicBusinessName || registration.businessName,
    requestedSlug: registration.slug,
    publicUrl,
    onboardingUrl: complete ? `/restaurant/${registration.slug}/onboarding` : null,
    planCode: registration.planCode,
    billingInterval: registration.billingInterval || "MONTHLY",
    status,
    subscriptionStatus: complete ? "ACTIVE" : ["CHECKOUT_CREATED", "PAYMENT_PENDING", "PAYMENT_PROCESSING", "PAYMENT_VERIFIED"].includes(status) ? "PENDING" : "NONE",
    checkoutSessionCreated: Boolean(registration.stripeCheckoutSessionId),
    createdAt: registration.createdAt,
    expiresAt: registration.expiresAt,
    completedAt: registration.completedAt,
    steps: {
      paymentConfirmed: ["PAYMENT_VERIFIED", "TENANT_CREATED", "COMPLETED"].includes(status),
      creatingAccount: ["PAYMENT_VERIFIED", "PAYMENT_PROCESSING"].includes(status),
      creatingRestaurant: ["PAYMENT_VERIFIED", "PAYMENT_PROCESSING"].includes(status),
      assigningOwner: ["PAYMENT_VERIFIED", "PAYMENT_PROCESSING"].includes(status),
      onboardingReady: complete,
      complete
    }
  };
}

export async function listRegistrationPlans() {
  return getPlatformPlans();
}

export async function checkRegistrationSlug({ slug, ownerEmail }) {
  const normalizedSlug = slugify(slug);
  const validation = validatePublicSlug(normalizedSlug);
  if (!validation.ok) return { available: false, slug: validation.slug, reason: validation.error };
  const [restaurant, reservation, pending] = await Promise.all([
    prisma.restaurant.findUnique({ where: { slug: validation.slug }, select: { id: true } }),
    prisma.slugReservation.findUnique({ where: { slug: validation.slug } }),
    prisma.pendingRegistration.findUnique({ where: { slug: validation.slug }, select: { id: true, ownerEmail: true, status: true, expiresAt: true } })
  ]);
  if (restaurant) return { available: false, slug: validation.slug, reason: "That restaurant slug is already assigned." };
  const normalizedOwnerEmail = normalizeEmail(ownerEmail);
  const now = new Date();
  if (reservation?.expiresAt && reservation.expiresAt > now && normalizeEmail(reservation.ownerEmail) !== normalizedOwnerEmail) {
    return { available: false, slug: validation.slug, reason: "That slug is temporarily reserved during another checkout." };
  }
  if (pending && !terminalStatuses.has(pending.status) && (!pending.expiresAt || pending.expiresAt > now) && normalizeEmail(pending.ownerEmail) !== normalizedOwnerEmail) {
    return { available: false, slug: validation.slug, reason: "That slug is already in registration." };
  }
  return { available: true, slug: validation.slug, reason: "" };
}

export async function startRegistration({ body }) {
  const normalizedEmail = normalizeEmail(body.email);
  const ownerName = `${body.firstName || ""} ${body.lastName || ""}`.trim();
  const requestedSlug = slugify(body.preferredSlug || body.slug || body.publicBusinessName || body.businessName);
  const slugCheck = await checkRegistrationSlug({ slug: requestedSlug, ownerEmail: normalizedEmail });
  if (!slugCheck.available) {
    const error = new Error(slugCheck.reason);
    error.status = 409;
    throw error;
  }
  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true, restaurantId: true, status: true } });
  if (existingUser?.restaurantId || existingUser?.status === "ACTIVE") {
    const error = new Error("An active Loohar account already exists for that email.");
    error.status = 409;
    throw error;
  }
  const passwordHash = await bcrypt.hash(body.password, 12);
  const expiresAt = new Date(Date.now() + REGISTRATION_TTL_MS);
  const businessType = normalizeBusinessType(body.businessType);
  const planCode = normalizePlanCode(body.planCode);
  const billingInterval = normalizeBillingInterval(body.billingInterval);

  const registration = await prisma.$transaction(async (tx) => {
    const owner = existingUser
      ? await tx.user.update({
          where: { id: existingUser.id },
          data: { email: normalizedEmail, name: ownerName || normalizedEmail, phone: body.phone || null, passwordHash, role: "TENANT_OWNER", status: "INVITED", forcePasswordChange: false, temporaryPassword: false, passwordChangedAt: new Date(), restaurantId: null }
        })
      : await tx.user.create({
          data: { email: normalizedEmail, name: ownerName || normalizedEmail, phone: body.phone || null, passwordHash, role: "TENANT_OWNER", status: "INVITED", forcePasswordChange: false, temporaryPassword: false, passwordChangedAt: new Date(), restaurantId: null }
        });

    const registrationJson = safeRegistrationJson(body, owner.id);
    const pending = await tx.pendingRegistration.upsert({
      where: { slug: slugCheck.slug },
      create: {
        ownerEmail: normalizedEmail,
        normalizedEmail,
        ownerName,
        businessName: body.businessName,
        publicBusinessName: body.publicBusinessName || body.businessName,
        slug: slugCheck.slug,
        businessType,
        planCode,
        billingInterval,
        status: "STARTED",
        registrationJson,
        expiresAt
      },
      update: {
        ownerEmail: normalizedEmail,
        normalizedEmail,
        ownerName,
        businessName: body.businessName,
        publicBusinessName: body.publicBusinessName || body.businessName,
        businessType,
        planCode,
        billingInterval,
        status: "STARTED",
        registrationJson,
        expiresAt
      }
    });
    await tx.slugReservation.upsert({
      where: { slug: slugCheck.slug },
      create: { slug: slugCheck.slug, ownerEmail: normalizedEmail, expiresAt },
      update: { ownerEmail: normalizedEmail, expiresAt }
    });
    await tx.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "registration.account.created",
        entityType: "User",
        entityId: owner.id,
        metadataJson: { email: maskEmail(normalizedEmail), pendingRegistrationId: pending.id }
      }
    });
    await tx.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "registration.started",
        entityType: "PendingRegistration",
        entityId: pending.id,
        metadataJson: { slug: pending.slug, planCode, billingInterval }
      }
    });
    await tx.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "registration.slug.reserved",
        entityType: "SlugReservation",
        entityId: pending.slug,
        metadataJson: { slug: pending.slug, expiresAt }
      }
    });
    await tx.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "registration.business.saved",
        entityType: "PendingRegistration",
        entityId: pending.id,
        metadataJson: { businessName: pending.businessName, publicBusinessName: pending.publicBusinessName, businessType }
      }
    });
    await tx.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "registration.plan.selected",
        entityType: "PendingRegistration",
        entityId: pending.id,
        metadataJson: { planCode, billingInterval }
      }
    });
    return pending;
  });

  return { registration: registrationSummary(registration) };
}

export async function createRegistrationCheckout({ registrationId, planCode, billingInterval }) {
  const result = await createPlatformCheckout({ body: { registrationId, planCode, billingInterval } });
  await recordAudit({
    action: "registration.checkout.created",
    entityType: "PendingRegistration",
    entityId: registrationId,
    metadata: { planCode: normalizePlanCode(planCode), billingInterval: normalizeBillingInterval(billingInterval) }
  }).catch(() => {});
  return {
    registration: registrationSummary(result.pendingRegistration),
    checkoutUrl: result.checkoutUrl,
    sessionId: result.sessionId
  };
}

export async function getRegistrationStatus({ registrationId, sessionId }) {
  const registration = registrationId
    ? await prisma.pendingRegistration.findUnique({ where: { id: registrationId } })
    : sessionId
      ? await prisma.pendingRegistration.findFirst({ where: { stripeCheckoutSessionId: sessionId } })
      : null;
  if (!registration) {
    const error = new Error("Registration not found.");
    error.status = 404;
    throw error;
  }
  if (registration.expiresAt && registration.expiresAt < new Date() && !terminalStatuses.has(registration.status)) {
    const expired = await prisma.pendingRegistration.update({ where: { id: registration.id }, data: { status: "EXPIRED" } });
    return { registration: registrationSummary(expired) };
  }
  return { registration: registrationSummary(registration) };
}

export async function cancelRegistration({ registrationId }) {
  const registration = await prisma.pendingRegistration.findUnique({ where: { id: registrationId } });
  if (!registration) {
    const error = new Error("Registration not found.");
    error.status = 404;
    throw error;
  }
  if (registration.restaurantId) {
    const error = new Error("Completed registrations cannot be cancelled.");
    error.status = 409;
    throw error;
  }
  const cancelled = await prisma.$transaction(async (tx) => {
    const pending = await tx.pendingRegistration.update({ where: { id: registration.id }, data: { status: "CANCELED" } });
    await tx.slugReservation.updateMany({ where: { slug: registration.slug, restaurantId: null }, data: { expiresAt: new Date() } });
    await tx.auditLog.create({
      data: { action: "registration.cancelled", entityType: "PendingRegistration", entityId: registration.id, metadataJson: { slug: registration.slug } }
    });
    return pending;
  });
  return { registration: registrationSummary(cancelled) };
}

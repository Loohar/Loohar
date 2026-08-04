import bcrypt from "bcrypt";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authError, requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { recordAudit } from "../services/auditService.js";
import {
  createAuthSession,
  isSessionExpired,
  loadSessionForAccessToken,
  revokeAllUserSessions,
  revokeAuthSession,
  rotateAuthSessionRefreshToken
} from "../services/authSessionService.js";
import { notifyPasswordReset } from "../services/notificationService.js";
import { createPasswordResetLink, hashPasswordResetToken } from "../services/passwordResetService.js";
import { updateSupabaseAuthPassword } from "../services/supabaseAuthService.js";
import { authDiagnostic, maskEmail, normalizeEmail, strongPasswordSchema } from "../utils/authSecurity.js";
import { sanitizeUser } from "../utils/sanitize.js";
import { signAccessToken, verifyAccessToken } from "../utils/tokens.js";

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const passwordLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const refreshLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

function authUserSelect() {
  return {
    id: true,
    email: true,
    name: true,
    role: true,
    status: true,
    restaurantId: true,
    forcePasswordChange: true,
    temporaryPassword: true,
    passwordChangedAt: true,
    lastLoginAt: true,
    sessionVersion: true,
    mfaEnabled: true,
    mfaSetupStatus: true,
    mfaVerifiedAt: true,
    restaurant: { select: { id: true, name: true, businessName: true, slug: true, status: true, onboardingStatus: true, onboardingCurrentStep: true, websitePublishedAt: true } }
  };
}

function publicUser(user) {
  return sanitizeUser(user);
}

function membershipFromRestaurant({ restaurant, role, status = "ACTIVE" }) {
  if (!restaurant?.id) return null;
  return {
    tenantId: restaurant.id,
    tenantSlug: restaurant.slug,
    tenantName: restaurant.businessName || restaurant.name,
    onboardingStatus: restaurant.onboardingStatus || "NOT_STARTED",
    onboardingCurrentStep: restaurant.onboardingCurrentStep || "business",
    websitePublishedAt: restaurant.websitePublishedAt || null,
    role,
    status
  };
}

function setBestMembership(memberships, membership) {
  if (!membership?.tenantId) return;
  const existing = memberships.get(membership.tenantId);
  if (!existing || existing.status !== "ACTIVE" || membership.status === "ACTIVE") {
    memberships.set(membership.tenantId, membership);
  }
}

async function membershipsForUser(user) {
  if (!user?.id || user.role === "SUPER_ADMIN") return [];
  const memberships = new Map();

  if (user.restaurantId && user.restaurant) {
    const membership = membershipFromRestaurant({ restaurant: user.restaurant, role: user.role, status: user.status });
    setBestMembership(memberships, membership);
  } else if (user.restaurantId && user.restaurantSlug) {
    setBestMembership(memberships, {
      tenantId: user.restaurantId,
      tenantSlug: user.restaurantSlug,
      tenantName: user.restaurantName || user.restaurantSlug,
      role: user.role,
      status: user.status || "ACTIVE"
    });
  }

  const staffMemberships = await prisma.restaurantStaff.findMany({
    where: { userId: user.id },
    select: {
      role: true,
      active: true,
      restaurant: { select: { id: true, name: true, businessName: true, slug: true, status: true } }
    }
  });

  for (const staff of staffMemberships) {
    const membership = membershipFromRestaurant({
      restaurant: staff.restaurant,
      role: staff.role,
      status: staff.active && staff.restaurant?.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"
    });
    setBestMembership(memberships, membership);
  }

  return [...memberships.values()];
}

async function authResponse(user, req, sessionContext = null) {
  const safeUser = publicUser(user);
  const memberships = await membershipsForUser(user);
  const issuedSession = sessionContext || await createAuthSession({ user, req });
  return {
    user: safeUser,
    memberships,
    accessToken: signAccessToken(user, issuedSession.session),
    refreshToken: issuedSession.refreshToken
  };
}

const credentialsSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2).optional(),
    role: z.enum(["CUSTOMER", "TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "DRIVER"]).optional(),
    restaurantId: z.string().optional()
  })
});

const forgotPasswordSchema = z.object({
  body: z.object({ email: z.string().email() })
});

const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(20),
    newPassword: strongPasswordSchema
  })
});

const demoLoginSchema = z.object({
  body: z.object({
    mode: z.enum(["platform", "admin", "restaurant", "driver", "customer"]).optional(),
    role: z.enum(["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "DRIVER", "CUSTOMER"]).optional()
  }).default({})
});

function canLoginWithStatus(status) {
  return ["ACTIVE", "PASSWORD_RESET_REQUIRED"].includes(status || "ACTIVE");
}

function isProductionDefaultAdmin(email) {
  return process.env.NODE_ENV === "production" && email.toLowerCase() === "admin@platform.local";
}

function demoLoginEnabled() {
  if (process.env.NODE_ENV !== "production") return true;
  const environmentName = String(process.env.LOOHAR_ENV || process.env.APP_ENV || process.env.DEPLOY_ENV || process.env.VERCEL_ENV || "").toLowerCase();
  return process.env.ENABLE_DEMO_LOGIN === "true" && ["staging", "preview", "development", "test"].includes(environmentName);
}

function demoEmailForMode(mode = "platform") {
  const superAdminFixtureEmail = normalizeEmail(process.env.SMOKE_SUPER_ADMIN_EMAIL || process.env.DEMO_SUPER_ADMIN_EMAIL || "");
  return {
    platform: superAdminFixtureEmail || (process.env.NODE_ENV !== "production" ? "admin@platform.local" : null),
    admin: superAdminFixtureEmail || (process.env.NODE_ENV !== "production" ? "admin@platform.local" : null),
    restaurant: "owner@demobistro.local",
    driver: "driver@demobistro.local",
    customer: "customer@demo.local"
  }[mode] || superAdminFixtureEmail || (process.env.NODE_ENV !== "production" ? "admin@platform.local" : null);
}

function demoEmailForRole(role) {
  const superAdminFixtureEmail = normalizeEmail(process.env.SMOKE_SUPER_ADMIN_EMAIL || process.env.DEMO_SUPER_ADMIN_EMAIL || "");
  return {
    SUPER_ADMIN: superAdminFixtureEmail || (process.env.NODE_ENV !== "production" ? "admin@platform.local" : null),
    TENANT_OWNER: "owner@demobistro.local",
    RESTAURANT_ADMIN: "owner@demobistro.local",
    RESTAURANT_OWNER: "owner@demobistro.local",
    RESTAURANT_MANAGER: "manager@demobistro.local",
    CASHIER: "cashier@demobistro.local",
    KITCHEN_STAFF: "kitchen@demobistro.local",
    DRIVER: "driver@demobistro.local",
    CUSTOMER: "customer@demo.local"
  }[role];
}

function demoFallbackEmailsForRole(role) {
  const devOwnerEmails = process.env.ENABLE_DEV_OWNER_FIXTURE === "true"
    ? [normalizeEmail(process.env.DEV_OWNER_EMAIL || "development@loohar.com")]
    : [];
  return {
    TENANT_OWNER: [...devOwnerEmails, "rowner@loohar.com", "owner@northsidetacos.local"],
    RESTAURANT_ADMIN: [...devOwnerEmails, "rowner@loohar.com", "archie+admin@gmail.com"],
    RESTAURANT_OWNER: [...devOwnerEmails, "owner@northsidetacos.local", "rowner@loohar.com"],
    RESTAURANT_MANAGER: ["manager@demobistro.local"],
    CASHIER: ["cashier@demobistro.local"],
    KITCHEN_STAFF: ["kitchen@loohar.com"],
    DRIVER: ["driver@loohar.com", "driver@northsidetacos.local"]
  }[role] || [];
}

function demoLoginEmailForRequest({ role, mode }) {
  const fixtureRoles = ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER"];
  if (process.env.ENABLE_DEV_OWNER_FIXTURE === "true" && fixtureRoles.includes(role)) {
    return null;
  }
  return demoEmailForRole(role) || demoEmailForMode(mode);
}

function userEmailWhere(email) {
  return { email: { equals: normalizeEmail(email), mode: "insensitive" } };
}

function findUserByEmail(email, select) {
  return prisma.user.findFirst({ where: userEmailWhere(email), select });
}

function demoUserAvailable(user) {
  if (!user || !canLoginWithStatus(user.status) || isProductionDefaultAdmin(user.email)) return false;
  if (user.role !== "SUPER_ADMIN" && user.restaurantId && user.restaurant?.status !== "ACTIVE") return false;
  return true;
}

async function findDemoUser({ email, role }) {
  const preferred = email ? await findUserByEmail(email, authUserSelect()) : null;
  if (demoUserAvailable(preferred)) return preferred;
  if (role === "SUPER_ADMIN") {
    return prisma.user.findFirst({
      where: {
        role: "SUPER_ADMIN",
        status: { in: ["ACTIVE", "PASSWORD_RESET_REQUIRED"] },
        ...(process.env.NODE_ENV === "production" ? { NOT: userEmailWhere("admin@platform.local") } : {})
      },
      orderBy: [{ lastLoginAt: "desc" }, { createdAt: "asc" }],
      select: authUserSelect()
    });
  }
  if (!role) return null;
  for (const fallbackEmail of demoFallbackEmailsForRole(role)) {
    const fallback = await findUserByEmail(fallbackEmail, authUserSelect());
    if (demoUserAvailable(fallback)) return fallback;
  }
  return prisma.user.findFirst({
    where: {
      role,
      status: { in: ["ACTIVE", "PASSWORD_RESET_REQUIRED"] },
      restaurant: { status: "ACTIVE" }
    },
    orderBy: { lastLoginAt: "desc" },
    select: authUserSelect()
  });
}

router.post("/register", validate(credentialsSchema), async (req, res, next) => {
  try {
    const { email, password, name, role = "CUSTOMER", restaurantId } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const existingUser = await findUserByEmail(normalizedEmail, { id: true });
    if (existingUser) return res.status(409).json({ error: "Email already exists" });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email: normalizedEmail, passwordHash, name: name || normalizedEmail, role, restaurantId, temporaryPassword: false, forcePasswordChange: false, passwordChangedAt: new Date() },
      select: authUserSelect()
    });
    res.status(201).json(await authResponse(user, req));
  } catch (error) {
    next(error);
  }
});

router.post("/login", loginLimiter, validate(credentialsSchema.pick({ body: true })), async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    authDiagnostic("auth.login.attempt", { email });
    const user = await findUserByEmail(email, { ...authUserSelect(), passwordHash: true });
    if (!user) {
      authDiagnostic("auth.login.user_not_found", { email });
      await recordAudit({ action: "login.failed", entityType: "User", entityId: null, actorUserId: null, restaurantId: null, metadata: { email: maskEmail(email), reason: "user_not_found" } }).catch(() => {});
      return authError(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
    }
    if (!user.passwordHash || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      authDiagnostic(user.passwordHash ? "auth.login.password_mismatch" : "auth.login.missing_password_hash", { email: user.email, userId: user.id });
      await recordAudit({ action: "login.failed", entityType: "User", entityId: user.id, actorUserId: user.id, restaurantId: user.restaurantId || null, metadata: { email: maskEmail(user.email), reason: user.passwordHash ? "password_mismatch" : "missing_password_hash" } }).catch(() => {});
      return authError(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
    }
    if (isProductionDefaultAdmin(user.email) || !canLoginWithStatus(user.status)) {
      authDiagnostic("auth.login.account_inactive", { email: user.email, userId: user.id, status: user.status });
      await recordAudit({ action: "login.failed", entityType: "User", entityId: user.id, actorUserId: user.id, restaurantId: user.restaurantId, metadata: { email: maskEmail(user.email), reason: "inactive_status", status: user.status } }).catch(() => {});
      return authError(res, 403, "AUTH_USER_INACTIVE", "Account is not active");
    }
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: authUserSelect()
    });
    await recordAudit({ action: "login.success", entityType: "User", entityId: updatedUser.id, actorUserId: updatedUser.id, restaurantId: updatedUser.restaurantId, metadata: { role: updatedUser.role } }).catch(() => {});
    authDiagnostic("auth.login.success", { email: updatedUser.email, userId: updatedUser.id, role: updatedUser.role });
    authDiagnostic("auth.session.created", { userId: updatedUser.id, role: updatedUser.role });
    res.json(await authResponse(updatedUser, req));
  } catch (error) {
    next(error);
  }
});

router.post("/demo-login", loginLimiter, validate(demoLoginSchema), async (req, res, next) => {
  try {
    if (!demoLoginEnabled()) return res.status(404).json({ error: "Demo login is disabled." });
    const email = demoLoginEmailForRequest(req.body);
    const user = await findDemoUser({ email, role: req.body.role });
    if (!demoUserAvailable(user)) return res.status(404).json({ error: "Seeded development account is unavailable." });
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: authUserSelect()
    });
    await recordAudit({ action: "login.demo", entityType: "User", entityId: updatedUser.id, actorUserId: updatedUser.id, restaurantId: updatedUser.restaurantId, metadata: { role: updatedUser.role } }).catch(() => {});
    res.json(await authResponse(updatedUser, req));
  } catch (error) {
    next(error);
  }
});

router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const parsed = strongPasswordSchema.safeParse(req.body.newPassword);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Password does not meet requirements" });
    const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    const passwordSync = await updateSupabaseAuthPassword({ email: req.user.email, password: req.body.newPassword });
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        passwordHash,
        forcePasswordChange: false,
        temporaryPassword: false,
        passwordChangedAt: new Date(),
        status: "ACTIVE",
        sessionVersion: { increment: 1 }
      },
      select: authUserSelect()
    });
    await revokeAllUserSessions({ userId: user.id, reason: "password_changed" });
    await recordAudit({ actorUserId: user.id, restaurantId: user.restaurantId, action: "password.changed", entityType: "User", entityId: user.id });
    res.json({ ...(await authResponse(user, req)), passwordSync });
  } catch (error) {
    next(error);
  }
});

async function refreshToken(req, res, next) {
  try {
    if (!req.body?.refreshToken) return authError(res, 401, "AUTH_REFRESH_TOKEN_MISSING", "Refresh token is required");
    const { user, session, refreshToken: nextRefreshToken } = await rotateAuthSessionRefreshToken({
      refreshToken: req.body.refreshToken,
      req,
      userSelect: authUserSelect()
    });
    if (!user || isProductionDefaultAdmin(user.email)) {
      await recordAudit({ action: "token.refresh.failed", entityType: "User", entityId: user?.id || null, actorUserId: user?.id || null, restaurantId: user?.restaurantId || null, metadata: { reason: "invalid_user" } }).catch(() => {});
      return authError(res, 401, "AUTH_REFRESH_TOKEN_INVALID", "Invalid refresh token");
    }
    if (!canLoginWithStatus(user.status)) {
      await revokeAuthSession({ sessionId: session.id, reason: "inactive_user" }).catch(() => {});
      await recordAudit({ action: "token.refresh.failed", entityType: "User", entityId: user.id, actorUserId: user.id, restaurantId: user.restaurantId || null, metadata: { reason: "inactive_status", status: user.status } }).catch(() => {});
      return authError(res, 403, "AUTH_USER_INACTIVE", "Account is not active");
    }
    if (user.role !== "SUPER_ADMIN" && ["SUSPENDED", "DELETED"].includes(user.restaurant?.status || "")) {
      await revokeAuthSession({ sessionId: session.id, reason: "tenant_access_revoked" }).catch(() => {});
      await recordAudit({ action: "token.refresh.failed", entityType: "User", entityId: user.id, actorUserId: user.id, restaurantId: user.restaurantId || null, metadata: { reason: "tenant_inactive", status: user.restaurant?.status } }).catch(() => {});
      return authError(res, 403, "AUTH_TENANT_FORBIDDEN", "Tenant access denied");
    }
    res.json(await authResponse(user, req, { session, refreshToken: nextRefreshToken }));
  } catch (error) {
    await recordAudit({ action: "token.refresh.failed", entityType: "RefreshToken", metadata: { reason: error.name || "invalid_token" } }).catch(() => {});
    if (error.code === "AUTH_SESSION_REVOKED") return authError(res, 401, "AUTH_SESSION_REVOKED", error.message || "Session is no longer valid");
    if (error.status && error.code) return authError(res, error.status, error.code, error.message);
    if (error.name === "TokenExpiredError") return authError(res, 401, "AUTH_REFRESH_TOKEN_EXPIRED", "Refresh token has expired");
    if (["JsonWebTokenError", "NotBeforeError"].includes(error.name)) return authError(res, 401, "AUTH_REFRESH_TOKEN_INVALID", "Invalid refresh token");
    next(error);
  }
}

router.post("/refresh-token", refreshLimiter, refreshToken);
router.post("/refresh", refreshLimiter, refreshToken);

async function authenticateLogoutRequest(req, res) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    authError(res, 401, "AUTH_ACCESS_TOKEN_MISSING", "Missing bearer token");
    return null;
  }

  try {
    const payload = verifyAccessToken(token);
    const session = await loadSessionForAccessToken({ payload, userSelect: authUserSelect() });
    const user = session.user;
    return {
      payload,
      user,
      session,
      alreadyRevoked: Boolean(session.revokedAt)
        || isSessionExpired(session)
        || (payload.sessionVersion ?? 0) !== (session.sessionVersion || 0)
        || (session.sessionVersion || 0) !== (user.sessionVersion || 0)
    };
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      authError(res, 401, "AUTH_ACCESS_TOKEN_EXPIRED", "Access token has expired");
      return null;
    }
    if (["JsonWebTokenError", "NotBeforeError"].includes(error.name)) {
      authError(res, 401, "AUTH_ACCESS_TOKEN_INVALID", "Invalid bearer token");
      return null;
    }
    if (error.status && error.code) {
      authError(res, error.status, error.code, error.message);
      return null;
    }
    throw error;
  }
}

router.post("/forgot-password", passwordLimiter, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const user = await findUserByEmail(req.body.email, authUserSelect());
    if (!user || !canLoginWithStatus(user.status) || isProductionDefaultAdmin(user.email)) {
      return res.json({ ok: true, message: "If that email exists, a password reset link has been sent." });
    }
    const { resetUrl, expiresAt } = await createPasswordResetLink({ userId: user.id });
    await recordAudit({ actorUserId: user.id, restaurantId: user.restaurantId, action: "password.reset.requested", entityType: "User", entityId: user.id });
    await notifyPasswordReset({ user, resetUrl, expiresAt }).catch(() => {});
    res.json({
      ok: true,
      message: "If that email exists, a password reset link has been sent."
    });
  } catch (error) {
    next(error);
  }
});

router.post("/reset-password", passwordLimiter, validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const tokenHash = hashPasswordResetToken(req.body.token);
    const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: { include: { restaurant: { select: { id: true, name: true, businessName: true, slug: true } } } } } });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) return res.status(400).json({ error: "Reset link is invalid or expired." });
    if (!canLoginWithStatus(resetToken.user.status) || isProductionDefaultAdmin(resetToken.user.email)) return authError(res, 403, "AUTH_USER_INACTIVE", "Account is not active");
    const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    const passwordSync = await updateSupabaseAuthPassword({ email: resetToken.user.email, password: req.body.newPassword });
    const user = await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } });
      return tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          forcePasswordChange: false,
          temporaryPassword: false,
          passwordChangedAt: new Date(),
          status: "ACTIVE",
          sessionVersion: { increment: 1 }
        },
        select: authUserSelect()
      });
    });
    await revokeAllUserSessions({ userId: user.id, reason: "password_reset_completed" });
    await recordAudit({ actorUserId: user.id, restaurantId: user.restaurantId, action: "password.reset.completed", entityType: "User", entityId: user.id });
    res.json({ ...(await authResponse(user, req)), passwordSync });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const context = await authenticateLogoutRequest(req, res);
    if (!context) return;
    const user = context.user;
    if (!context.alreadyRevoked) {
      await revokeAuthSession({ sessionId: context.session.id, reason: "logout" });
    }
    await recordAudit({
      actorUserId: user.id,
      restaurantId: user.restaurantId,
      action: "logout",
      entityType: "User",
      entityId: user.id,
      metadata: { alreadyRevoked: context.alreadyRevoked, revocation: "authSession.current_device", sessionId: context.session.id }
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post("/logout-all-devices", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { sessionVersion: { increment: 1 } },
      select: authUserSelect()
    });
    await revokeAllUserSessions({ userId: user.id, reason: "logout_all_devices" });
    await recordAudit({
      actorUserId: user.id,
      restaurantId: user.restaurantId,
      action: "logout.all_devices",
      entityType: "User",
      entityId: user.id,
      metadata: { revocation: "authSession.all_devices" }
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    authDiagnostic("auth.me.success", { userId: req.user.id, role: req.user.role });
    res.json({ user: publicUser(req.user), memberships: await membershipsForUser(req.user) });
  } catch (error) {
    authDiagnostic("auth.me.failed", { userId: req.user?.id, reason: error.name || "unknown" });
    next(error);
  }
});

export default router;

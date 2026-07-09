import bcrypt from "bcrypt";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { recordAudit } from "../services/auditService.js";
import { notifyPasswordReset } from "../services/notificationService.js";
import { createPasswordResetLink, hashPasswordResetToken } from "../services/passwordResetService.js";
import { updateSupabaseAuthPassword } from "../services/supabaseAuthService.js";
import { sanitizeUser } from "../utils/sanitize.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/tokens.js";

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const passwordLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const refreshLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

const strongPasswordSchema = z.string()
  .min(12, "Password must be at least 12 characters")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[0-9]/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a special character");

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
    mfaEnabled: true,
    mfaSetupStatus: true,
    mfaVerifiedAt: true,
    restaurant: { select: { id: true, name: true, businessName: true, slug: true } }
  };
}

function publicUser(user) {
  return sanitizeUser(user);
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
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_LOGIN === "true";
}

function demoEmailForMode(mode = "platform") {
  return {
    platform: "admin@platform.local",
    admin: "admin@platform.local",
    restaurant: "owner@demobistro.local",
    driver: "driver@demobistro.local",
    customer: "customer@demo.local"
  }[mode] || "admin@platform.local";
}

function demoEmailForRole(role) {
  return {
    SUPER_ADMIN: "admin@platform.local",
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

router.post("/register", validate(credentialsSchema), async (req, res, next) => {
  try {
    const { email, password, name, role = "CUSTOMER", restaurantId } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: name || email, role, restaurantId, temporaryPassword: false, forcePasswordChange: false, passwordChangedAt: new Date() }
    });
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, restaurantId: user.restaurantId, forcePasswordChange: false, temporaryPassword: false, passwordChangedAt: user.passwordChangedAt },
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", loginLimiter, validate(credentialsSchema.pick({ body: true })), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.body.email }, select: { ...authUserSelect(), passwordHash: true } });
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      await recordAudit({ action: "login.failed", entityType: "User", entityId: user?.id || null, actorUserId: user?.id || null, restaurantId: user?.restaurantId || null, metadata: { email: req.body.email, reason: "invalid_credentials" } }).catch(() => {});
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (isProductionDefaultAdmin(user.email) || !canLoginWithStatus(user.status)) {
      await recordAudit({ action: "login.failed", entityType: "User", entityId: user.id, actorUserId: user.id, restaurantId: user.restaurantId, metadata: { email: user.email, reason: "inactive_status", status: user.status } }).catch(() => {});
      return res.status(403).json({ error: "Account is not active" });
    }
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: authUserSelect()
    });
    await recordAudit({ action: "login.success", entityType: "User", entityId: updatedUser.id, actorUserId: updatedUser.id, restaurantId: updatedUser.restaurantId, metadata: { role: updatedUser.role } }).catch(() => {});
    res.json({
      user: publicUser(updatedUser),
      accessToken: signAccessToken(updatedUser),
      refreshToken: signRefreshToken(updatedUser)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/demo-login", loginLimiter, validate(demoLoginSchema), async (req, res, next) => {
  try {
    if (!demoLoginEnabled()) return res.status(404).json({ error: "Demo login is disabled." });
    const email = demoEmailForRole(req.body.role) || demoEmailForMode(req.body.mode);
    const user = await prisma.user.findUnique({ where: { email }, select: authUserSelect() });
    if (!user || !canLoginWithStatus(user.status) || isProductionDefaultAdmin(user.email)) return res.status(404).json({ error: "Seeded development account is unavailable." });
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: authUserSelect()
    });
    await recordAudit({ action: "login.demo", entityType: "User", entityId: updatedUser.id, actorUserId: updatedUser.id, restaurantId: updatedUser.restaurantId, metadata: { role: updatedUser.role } }).catch(() => {});
    res.json({
      user: publicUser(updatedUser),
      accessToken: signAccessToken(updatedUser),
      refreshToken: signRefreshToken(updatedUser)
    });
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
        status: "ACTIVE"
      },
      select: authUserSelect()
    });
    await recordAudit({ actorUserId: user.id, restaurantId: user.restaurantId, action: "password.changed", entityType: "User", entityId: user.id });
    res.json({
      user: publicUser(user),
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user),
      passwordSync
    });
  } catch (error) {
    next(error);
  }
});

async function refreshToken(req, res, next) {
  try {
    const payload = verifyRefreshToken(req.body.refreshToken);
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: authUserSelect() });
    if (!user || !canLoginWithStatus(user.status) || isProductionDefaultAdmin(user.email)) {
      await recordAudit({ action: "token.refresh.failed", entityType: "User", entityId: user?.id || null, actorUserId: user?.id || null, restaurantId: user?.restaurantId || null, metadata: { reason: "invalid_user_or_status" } }).catch(() => {});
      return res.status(401).json({ error: "Invalid refresh token" });
    }
    res.json({ user: publicUser(user), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) });
  } catch (error) {
    await recordAudit({ action: "token.refresh.failed", entityType: "RefreshToken", metadata: { reason: error.name || "invalid_token" } }).catch(() => {});
    res.status(401).json({ error: "Invalid refresh token" });
  }
}

router.post("/refresh-token", refreshLimiter, refreshToken);
router.post("/refresh", refreshLimiter, refreshToken);

router.post("/forgot-password", passwordLimiter, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.body.email }, select: authUserSelect() });
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
    if (!canLoginWithStatus(resetToken.user.status) || isProductionDefaultAdmin(resetToken.user.email)) return res.status(403).json({ error: "Account is not active" });
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
          status: "ACTIVE"
        },
        select: authUserSelect()
      });
    });
    await recordAudit({ actorUserId: user.id, restaurantId: user.restaurantId, action: "password.reset.completed", entityType: "User", entityId: user.id });
    res.json({ user: publicUser(user), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user), passwordSync });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await recordAudit({ actorUserId: req.user.id, restaurantId: req.user.restaurantId, action: "logout", entityType: "User", entityId: req.user.id });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;

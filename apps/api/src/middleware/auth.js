import { isSessionExpired, loadSessionForAccessToken, revokeAuthSession, touchAuthSession } from "../services/authSessionService.js";
import { mfaEnforcementEnabled, roleRequiresMfa } from "../services/mfaService.js";
import { verifyAccessToken } from "../utils/tokens.js";

export function authError(res, status, code, error) {
  return res.status(status).json({ error, code });
}

function accessError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

// `restricted` lets a session that still owes MFA enrollment or a forced password change reach
// only the routes needed to complete that step (auth status, MFA setup, password change, logout).
export async function authenticateAccessToken(token, { restricted = false } = {}) {
  if (!token) throw accessError("Missing bearer token", 401, "AUTH_ACCESS_TOKEN_MISSING");

  const payload = verifyAccessToken(token);
  const session = await loadSessionForAccessToken({
    payload,
    userSelect: {
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
      restaurant: { select: { id: true, name: true, businessName: true, slug: true, status: true } }
    }
  });
  const user = session.user;

  if (!user) throw accessError("Invalid bearer token", 401, "AUTH_ACCESS_TOKEN_INVALID");
  if (session.revokedAt) {
    throw accessError("Session is no longer valid", 401, "AUTH_SESSION_REVOKED");
  }
  if (isSessionExpired(session)) {
    await revokeAuthSession({ sessionId: session.id, reason: "expired" }).catch(() => {});
    throw accessError("Access token session has expired", 401, "AUTH_SESSION_EXPIRED");
  }
  if ((payload.sessionVersion ?? 0) !== (session.sessionVersion || 0) || (session.sessionVersion || 0) !== (user.sessionVersion || 0)) {
    throw accessError("Session is no longer valid", 401, "AUTH_SESSION_REVOKED");
  }
  if (!["ACTIVE", "PASSWORD_RESET_REQUIRED"].includes(user.status || "ACTIVE")) {
    throw accessError("Account is not active", 403, "AUTH_USER_INACTIVE");
  }
  if (user.role !== "SUPER_ADMIN" && ["SUSPENDED", "DELETED"].includes(user.restaurant?.status || "")) {
    throw accessError("Tenant access denied", 403, "AUTH_TENANT_FORBIDDEN");
  }

  if (user.mfaEnabled && !session.mfaVerifiedAt) {
    throw accessError("Multi-factor verification is required", 401, "AUTH_MFA_REQUIRED");
  }
  const mfaEnrollmentRequired = mfaEnforcementEnabled() && roleRequiresMfa(user.role) && !user.mfaEnabled;
  const passwordChangeRequired = Boolean(user.forcePasswordChange) || user.status === "PASSWORD_RESET_REQUIRED";
  if (!restricted && mfaEnrollmentRequired) {
    throw accessError("Set up multi-factor authentication to continue", 403, "AUTH_MFA_ENROLLMENT_REQUIRED");
  }
  if (!restricted && passwordChangeRequired) {
    throw accessError("Change your password to continue", 403, "AUTH_PASSWORD_CHANGE_REQUIRED");
  }

  await touchAuthSession(session);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    restaurantId: user.restaurantId,
    restaurantSlug: user.restaurant?.slug || null,
    restaurantName: user.restaurant?.businessName || user.restaurant?.name || null,
    forcePasswordChange: user.forcePasswordChange,
    temporaryPassword: user.temporaryPassword,
    passwordChangedAt: user.passwordChangedAt,
    lastLoginAt: user.lastLoginAt,
    sessionVersion: user.sessionVersion,
    mfaEnabled: user.mfaEnabled,
    mfaSetupStatus: user.mfaSetupStatus,
    mfaVerifiedAt: user.mfaVerifiedAt,
    mfaEnrollmentRequired,
    passwordChangeRequired,
    sessionMfaVerifiedAt: session.mfaVerifiedAt || null,
    sessionId: session.id,
    sessionExpiresAt: session.expiresAt
  };
}

function authMiddleware({ restricted }) {
  return async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    req.user = await authenticateAccessToken(token, { restricted });
    req.tenantId = req.user.restaurantId;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return authError(res, 401, "AUTH_ACCESS_TOKEN_EXPIRED", "Access token has expired");
    }
    if (["JsonWebTokenError", "NotBeforeError"].includes(error.name)) {
      return authError(res, 401, "AUTH_ACCESS_TOKEN_INVALID", "Invalid bearer token");
    }
    if (error.status && error.code) return authError(res, error.status, error.code, error.message);
    next(error);
  }
  };
}

export const requireAuth = authMiddleware({ restricted: false });
export const requireAuthForAccountSetup = authMiddleware({ restricted: true });

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return authError(res, 403, "AUTH_ROLE_FORBIDDEN", "Insufficient permissions");
    }
    next();
  };
}

export function requireTenantAccess(req, res, next) {
  if (req.user?.role === "SUPER_ADMIN") return next();
  if (!req.tenantId) {
    return authError(res, 403, "AUTH_TENANT_FORBIDDEN", "Tenant access denied");
  }
  const requestedTenant = req.body.restaurantId || req.query.restaurantId;
  if (requestedTenant && requestedTenant !== req.tenantId) {
    return authError(res, 403, "AUTH_TENANT_FORBIDDEN", "Tenant access denied");
  }
  if (req.resolvedRestaurantId && req.resolvedRestaurantId !== req.tenantId) {
    return authError(res, 403, "AUTH_TENANT_FORBIDDEN", "Tenant access denied");
  }
  next();
}

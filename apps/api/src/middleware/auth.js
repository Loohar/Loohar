import { prisma } from "../config/prisma.js";
import { verifyAccessToken } from "../utils/tokens.js";

export function authError(res, status, code, error) {
  return res.status(status).json({ error, code });
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return authError(res, 401, "AUTH_ACCESS_TOKEN_MISSING", "Missing bearer token");

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
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
        restaurant: { select: { id: true, name: true, businessName: true, slug: true } }
      }
    });

    if (!user) return authError(res, 401, "AUTH_ACCESS_TOKEN_INVALID", "Invalid bearer token");
    if ((payload.sessionVersion ?? 0) !== (user.sessionVersion || 0)) return authError(res, 401, "AUTH_SESSION_REVOKED", "Session is no longer valid");
    if (!["ACTIVE", "PASSWORD_RESET_REQUIRED"].includes(user.status || "ACTIVE")) return authError(res, 403, "AUTH_USER_INACTIVE", "Account is not active");
    req.user = {
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
      mfaVerifiedAt: user.mfaVerifiedAt
    };
    req.tenantId = user.restaurantId;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return authError(res, 401, "AUTH_ACCESS_TOKEN_EXPIRED", "Access token has expired");
    }
    if (["JsonWebTokenError", "NotBeforeError"].includes(error.name)) {
      return authError(res, 401, "AUTH_ACCESS_TOKEN_INVALID", "Invalid bearer token");
    }
    next(error);
  }
}

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

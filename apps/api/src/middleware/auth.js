import { prisma } from "../config/prisma.js";
import { verifyAccessToken } from "../utils/tokens.js";

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

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
        mfaEnabled: true,
        mfaSetupStatus: true,
        mfaVerifiedAt: true,
        restaurant: { select: { id: true, name: true, businessName: true, slug: true } }
      }
    });

    if (!user) return res.status(401).json({ error: "Invalid token user" });
    if (!["ACTIVE", "PASSWORD_RESET_REQUIRED"].includes(user.status || "ACTIVE")) return res.status(403).json({ error: "Account is not active" });
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
      mfaEnabled: user.mfaEnabled,
      mfaSetupStatus: user.mfaSetupStatus,
      mfaVerifiedAt: user.mfaVerifiedAt
    };
    req.tenantId = user.restaurantId;
    next();
  } catch (error) {
    if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error.name)) {
      return res.status(401).json({ error: "Invalid or expired bearer token" });
    }
    next(error);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

export function requireTenantAccess(req, res, next) {
  if (req.user?.role === "SUPER_ADMIN") return next();
  const requestedTenant = req.params.restaurantId || req.body.restaurantId || req.query.restaurantId;
  if (!req.tenantId || (requestedTenant && requestedTenant !== req.tenantId)) {
    return res.status(403).json({ error: "Tenant access denied" });
  }
  next();
}

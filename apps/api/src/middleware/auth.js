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
      select: { id: true, email: true, name: true, role: true, restaurantId: true }
    });

    if (!user) return res.status(401).json({ error: "Invalid token user" });
    req.user = user;
    req.tenantId = user.restaurantId;
    next();
  } catch (error) {
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


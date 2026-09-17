import { prisma } from "../config/prisma.js";

const UNRESTRICTED_ROLES = new Set(["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN"]);

// Returns null when the user may see every location of the restaurant, otherwise the list of
// location ids assigned to their staff profile (an empty assignment means all locations, matching POS).
export async function allowedLocationIdsForUser(user, restaurantId) {
  if (!user || UNRESTRICTED_ROLES.has(user.role)) return null;
  const staff = await prisma.restaurantStaff.findFirst({
    where: { restaurantId, userId: user.id, active: true },
    select: { locationIdsJson: true }
  });
  const ids = Array.isArray(staff?.locationIdsJson)
    ? staff.locationIdsJson.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return ids.length ? ids : null;
}

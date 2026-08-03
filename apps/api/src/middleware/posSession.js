import { prisma } from "../config/prisma.js";
import { verifyPosSessionToken } from "../utils/tokens.js";

function deny(res, error, code = "POS_SESSION_REQUIRED") {
  return res.status(401).json({ error, code });
}

export async function requirePosSession(req, res, next) {
  try {
    const token = req.get("x-loohar-pos-session");
    if (!token) return deny(res, "Unlock this register with an employee PIN before continuing.");

    const payload = verifyPosSessionToken(token);
    const restaurantId = req.resolvedRestaurantId;
    const deviceId = req.get("x-loohar-device-id") || req.body?.deviceId || req.query?.deviceId || null;
    if (
      payload.purpose !== "POS_SESSION" ||
      payload.sub !== req.user?.id ||
      payload.restaurantId !== restaurantId ||
      !deviceId ||
      payload.deviceId !== deviceId
    ) {
      return deny(res, "The POS session does not match this employee, restaurant, or register.", "POS_SESSION_MISMATCH");
    }

    const [staff, device] = await Promise.all([
      prisma.restaurantStaff.findFirst({
        where: { id: payload.staffId, restaurantId, userId: req.user.id, active: true },
        select: { id: true, locationIdsJson: true }
      }),
      prisma.posDevice.findFirst({
        where: { id: deviceId, restaurantId, status: "ACTIVE" },
        select: { id: true, locationId: true }
      })
    ]);
    if (!staff || !device) {
      return deny(res, "The employee or register is no longer authorized.", "POS_SESSION_REVOKED");
    }
    if ((payload.locationId || null) !== (device.locationId || null)) {
      return deny(res, "The register location changed. Unlock the register again.", "POS_SESSION_LOCATION_CHANGED");
    }
    const staffLocationIds = Array.isArray(staff.locationIdsJson)
      ? staff.locationIdsJson.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (staffLocationIds.length && (!device.locationId || !staffLocationIds.includes(device.locationId))) {
      return deny(res, "This employee cannot operate the register location.", "POS_SESSION_LOCATION_DENIED");
    }

    req.posSession = payload;
    next();
  } catch (error) {
    if (["TokenExpiredError", "JsonWebTokenError", "NotBeforeError"].includes(error.name)) {
      return deny(res, "The POS session expired. Unlock the register again.", "POS_SESSION_EXPIRED");
    }
    next(error);
  }
}

import jwt from "jsonwebtoken";

function requiredSecret(name, fallback) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be set in production`);
  }
  return fallback;
}

const accessSecret = () => requiredSecret("JWT_SECRET", "dev-access-secret");
const refreshSecret = () => {
  const value = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_REFRESH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("REFRESH_TOKEN_SECRET must be set in production");
  }
  return "dev-refresh-secret";
};

export function signAccessToken(user, session = null) {
  return jwt.sign(
    {
      sub: user.id,
      sid: session?.id || user.sessionId || null,
      role: user.role,
      restaurantId: user.restaurantId || null,
      sessionVersion: session?.sessionVersion ?? user.sessionVersion ?? 0
    },
    accessSecret(),
    { expiresIn: "15m" }
  );
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, sessionVersion: user.sessionVersion || 0 }, refreshSecret(), { expiresIn: "14d" });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, accessSecret());
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, refreshSecret());
}

export function signPosSessionToken({ userId, restaurantId, staffId, deviceId, locationId }) {
  return jwt.sign(
    {
      sub: userId,
      purpose: "POS_SESSION",
      restaurantId,
      staffId,
      deviceId,
      locationId: locationId || null
    },
    accessSecret(),
    { expiresIn: "8h" }
  );
}

export function verifyPosSessionToken(token) {
  return jwt.verify(token, accessSecret());
}

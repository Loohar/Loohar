import jwt from "jsonwebtoken";

const accessSecret = () => process.env.JWT_SECRET || "dev-access-secret";
const refreshSecret = () => process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, restaurantId: user.restaurantId || null },
    accessSecret(),
    { expiresIn: "15m" }
  );
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id }, refreshSecret(), { expiresIn: "14d" });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, accessSecret());
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, refreshSecret());
}


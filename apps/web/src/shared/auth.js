import { authStorage } from "./browserStorage.js";

const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";
const USER_KEY = "user";

// TODO production hardening: move access/refresh tokens to httpOnly Secure SameSite cookies.
const browserStorageSensitiveKeys = ["password", "passwordHash", "hashedPassword", "resetToken", "resetPasswordToken", "mfaSecret"];

function sanitizeStoredUser(user) {
  if (!user || typeof user !== "object") return user;
  return Object.fromEntries(Object.entries(user).filter(([key]) => !browserStorageSensitiveKeys.includes(key)));
}

export function getStoredSession() {
  const token = authStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = authStorage.getItem(REFRESH_TOKEN_KEY);
  const storedUser = authStorage.getItem(USER_KEY);
  let user = null;
  try {
    user = storedUser ? JSON.parse(storedUser) : null;
  } catch {
    authStorage.removeItem(USER_KEY);
  }
  return {
    token,
    refreshToken,
    user
  };
}

export function storeSession({ accessToken, refreshToken, user }) {
  if (accessToken) authStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  else authStorage.removeItem(ACCESS_TOKEN_KEY);
  if (refreshToken) authStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  else authStorage.removeItem(REFRESH_TOKEN_KEY);
  if (user) authStorage.setItem(USER_KEY, JSON.stringify(sanitizeStoredUser(user)));
  else authStorage.removeItem(USER_KEY);
}

export function clearSession() {
  authStorage.removeItem(ACCESS_TOKEN_KEY);
  authStorage.removeItem(REFRESH_TOKEN_KEY);
  authStorage.removeItem(USER_KEY);
}

export function isDriver(user) {
  return user?.role === "DRIVER";
}

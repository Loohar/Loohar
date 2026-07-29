import { authStorage } from "./browserStorage.js";

const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";
const USER_KEY = "user";
export const AUTH_EXPIRED_EVENT = "loohar:auth-expired";
export const AUTH_SESSION_UPDATED_EVENT = "loohar:auth-updated";
let sessionRevision = 0;

// TODO production hardening: move access/refresh tokens to httpOnly Secure SameSite cookies.
const browserStorageSensitiveKeys = [
  "password",
  "passwordHash",
  "hashedPassword",
  "temporaryPassword",
  "resetToken",
  "resetPasswordToken",
  "mfaSecret",
  "sessionVersion",
  "accessToken",
  "refreshToken"
];

function sanitizeStoredUser(user) {
  if (!user || typeof user !== "object") return user;
  return Object.fromEntries(Object.entries(user).filter(([key]) => !browserStorageSensitiveKeys.includes(key)));
}

function emitAuthEvent(name, detail = {}) {
  if (globalThis.window?.dispatchEvent && typeof globalThis.window.CustomEvent === "function") {
    globalThis.window.dispatchEvent(new globalThis.window.CustomEvent(name, { detail }));
  }
}

function normalizeSessionPayload(session = {}) {
  return {
    accessToken: session.accessToken || session.token || "",
    refreshToken: session.refreshToken || "",
    user: sanitizeStoredUser(session.user || null)
  };
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

export function getAccessToken() {
  return authStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return authStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getSessionRevision() {
  return sessionRevision;
}

export function storeSession(session) {
  const { accessToken, refreshToken, user } = normalizeSessionPayload(session);
  if (accessToken) authStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  else authStorage.removeItem(ACCESS_TOKEN_KEY);
  if (refreshToken) authStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  else authStorage.removeItem(REFRESH_TOKEN_KEY);
  if (user) authStorage.setItem(USER_KEY, JSON.stringify(user));
  else authStorage.removeItem(USER_KEY);
  sessionRevision += 1;
  const storedSession = getStoredSession();
  emitAuthEvent(AUTH_SESSION_UPDATED_EVENT, { session: storedSession });
  return storedSession;
}

export function clearSession(reason = "session_cleared", options = {}) {
  authStorage.removeItem(ACCESS_TOKEN_KEY);
  authStorage.removeItem(REFRESH_TOKEN_KEY);
  authStorage.removeItem(USER_KEY);
  sessionRevision += 1;
  if (options.emit !== false) emitAuthEvent(AUTH_EXPIRED_EVENT, { reason });
}

export function isDriver(user) {
  return user?.role === "DRIVER";
}

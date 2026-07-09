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
  const token = localStorage.getItem(ACCESS_TOKEN_KEY) || "";
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY) || "";
  const storedUser = localStorage.getItem(USER_KEY);
  return {
    token,
    refreshToken,
    user: storedUser ? JSON.parse(storedUser) : null
  };
}

export function storeSession({ accessToken, refreshToken, user }) {
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  else localStorage.removeItem(ACCESS_TOKEN_KEY);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  else localStorage.removeItem(REFRESH_TOKEN_KEY);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(sanitizeStoredUser(user)));
  else localStorage.removeItem(USER_KEY);
}

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isDriver(user) {
  return user?.role === "DRIVER";
}

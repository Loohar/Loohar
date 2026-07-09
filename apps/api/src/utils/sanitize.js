const responseSensitiveKeys = new Set([
  "password",
  "passwordHash",
  "hashedPassword",
  "temporaryPassword",
  "resetPasswordToken",
  "resetToken",
  "tokenHash",
  "trackingTokenHash",
  "mfaSecret",
  "authorization",
  "serviceRoleKey",
  "supabaseServiceRoleKey",
  "ownerPassword",
  "ownerTemporaryPassword"
]);

const userSensitiveKeys = new Set([
  ...responseSensitiveKeys,
  "accessToken",
  "refreshToken"
]);

function sanitizeValue(value, sensitiveKeys) {
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, sensitiveKeys));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKeys.has(key))
      .map(([key, nestedValue]) => [key, sanitizeValue(nestedValue, sensitiveKeys)])
  );
}

export function sanitizeSensitiveFields(value) {
  return sanitizeValue(value, responseSensitiveKeys);
}

export function sanitizeUser(user) {
  if (!user) return null;
  const safeUser = sanitizeValue(user, userSensitiveKeys);
  if (user.restaurant) {
    safeUser.restaurantSlug = user.restaurant.slug || null;
    safeUser.restaurantName = user.restaurant.businessName || user.restaurant.name || null;
  }
  return safeUser;
}

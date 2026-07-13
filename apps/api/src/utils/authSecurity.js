import { z } from "zod";

export const strongPasswordSchema = z.string()
  .min(12, "Password must be at least 12 characters")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[0-9]/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a special character");

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return normalized ? "[masked-email]" : null;
  const visibleLocal = local.length <= 2 ? `${local[0] || ""}***` : `${local.slice(0, 2)}***${local.slice(-1)}`;
  const [domainName, ...suffixParts] = domain.split(".");
  const suffix = suffixParts.length ? `.${suffixParts.join(".")}` : "";
  const visibleDomain = domainName.length <= 2 ? `${domainName[0] || ""}***` : `${domainName.slice(0, 2)}***`;
  return `${visibleLocal}@${visibleDomain}${suffix}`;
}

export function authDiagnostic(event, details = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !["password", "passwordHash", "token", "accessToken", "refreshToken", "authorization", "cookie"].includes(key))
      .map(([key, value]) => [key, key.toLowerCase().includes("email") ? maskEmail(value) : value])
  );
  console.info(JSON.stringify({ event, ...safeDetails }));
}

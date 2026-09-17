import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../config/prisma.js";

// Time-based one-time passwords (RFC 6238, HMAC-SHA1, 30 s, 6 digits) — compatible with standard
// authenticator apps. Secrets are encrypted at rest; recovery codes are stored only as HMACs.

export const MFA_REQUIRED_ROLES = new Set(["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"]);
export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const MFA_LOCKOUT_MS = 15 * 60_000;
export const MFA_RECOVERY_CODE_COUNT = 10;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_ALLOWED_DRIFT_STEPS = 1;
const MFA_CHALLENGE_TTL = "5m";
const MFA_CHALLENGE_AUDIENCE = "loohar-mfa-challenge";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function mfaError(message, status, code, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function serverSecret(env = process.env) {
  const value = env.MFA_ENCRYPTION_KEY || env.JWT_SECRET;
  if (value) return value;
  if (!["development", "test"].includes(env.NODE_ENV || "") && env.LOOHAR_ALLOW_DEV_SECRETS !== "true") throw new Error("MFA_ENCRYPTION_KEY or JWT_SECRET must be set");
  return "dev-mfa-secret";
}

export function mfaEnforcementEnabled(env = process.env) {
  if (env.NODE_ENV === "production") return true;
  return env.MFA_ENFORCEMENT !== "off";
}

export function roleRequiresMfa(role) {
  return MFA_REQUIRED_ROLES.has(role);
}

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const cleaned = String(input || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpStep(atMs = Date.now()) {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function generateTotp(secretBuffer, step, digits = TOTP_DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", secretBuffer).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

// Returns the matched time step or null. Steps at or before `lastUsedStep` are rejected so a
// code can never be replayed.
export function matchTotp(secretBuffer, code, { atMs = Date.now(), lastUsedStep = null } = {}) {
  const normalized = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = totpStep(atMs);
  for (let drift = -TOTP_ALLOWED_DRIFT_STEPS; drift <= TOTP_ALLOWED_DRIFT_STEPS; drift += 1) {
    const step = current + drift;
    if (lastUsedStep !== null && lastUsedStep !== undefined && step <= lastUsedStep) continue;
    const expected = Buffer.from(generateTotp(secretBuffer, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(normalized))) return step;
  }
  return null;
}

function encryptionKey(env = process.env) {
  return Buffer.from(crypto.hkdfSync("sha256", serverSecret(env), "loohar-mfa-secret-encryption", "v1", 32));
}

export function encryptMfaSecret(secretBuffer, env = process.env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(secretBuffer), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptMfaSecret(stored, env = process.env) {
  const [version, iv, tag, data] = String(stored || "").split(".");
  if (version !== "v1" || !iv || !tag || !data) throw mfaError("MFA configuration is invalid. Contact support to reset MFA.", 409, "AUTH_MFA_CONFIGURATION_INVALID");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
}

export function hashRecoveryCode(code, env = process.env) {
  const normalized = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return crypto.createHmac("sha256", serverSecret(env)).update(`loohar-mfa-recovery-v1|${normalized}`).digest("hex");
}

function generateRecoveryCodes() {
  return Array.from({ length: MFA_RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function signMfaChallengeToken(user) {
  return jwt.sign(
    { sub: user.id, sessionVersion: user.sessionVersion || 0, purpose: "MFA_CHALLENGE" },
    serverSecret(),
    { expiresIn: MFA_CHALLENGE_TTL, audience: MFA_CHALLENGE_AUDIENCE }
  );
}

export function verifyMfaChallengeToken(token) {
  try {
    const payload = jwt.verify(String(token || ""), serverSecret(), { audience: MFA_CHALLENGE_AUDIENCE, algorithms: ["HS256"] });
    if (payload.purpose !== "MFA_CHALLENGE") throw new Error("wrong purpose");
    return payload;
  } catch {
    throw mfaError("The sign-in verification has expired. Sign in again.", 401, "AUTH_MFA_CHALLENGE_INVALID");
  }
}

function otpauthUrl({ secretBase32, email }) {
  const label = encodeURIComponent(`Loohar:${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=Loohar&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export async function startMfaEnrollment({ userId }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, mfaEnabled: true } });
  if (!user) throw mfaError("User not found", 404, "AUTH_USER_NOT_FOUND");
  if (user.mfaEnabled) throw mfaError("MFA is already enabled for this account.", 409, "AUTH_MFA_ALREADY_ENABLED");
  const secret = crypto.randomBytes(20);
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaPendingSecret: encryptMfaSecret(secret), mfaSetupStatus: "PENDING_VERIFICATION" }
  });
  const secretBase32 = base32Encode(secret);
  return { secret: secretBase32, otpauthUrl: otpauthUrl({ secretBase32, email: user.email }) };
}

// Atomic increment so parallel guesses cannot all read the same counter and skip the lockout.
async function recordFailure(user) {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { mfaFailedAttempts: { increment: 1 } },
    select: { mfaFailedAttempts: true }
  });
  if (updated.mfaFailedAttempts < MFA_MAX_FAILED_ATTEMPTS) return false;
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaFailedAttempts: 0, mfaLockedUntil: new Date(Date.now() + MFA_LOCKOUT_MS) }
  });
  return true;
}

function assertNotLocked(user) {
  if (user.mfaLockedUntil && new Date(user.mfaLockedUntil).getTime() > Date.now()) {
    throw mfaError("Too many incorrect codes. Try again later.", 429, "AUTH_MFA_LOCKED", { lockedUntil: user.mfaLockedUntil });
  }
}

const mfaUserSelect = {
  id: true,
  email: true,
  role: true,
  restaurantId: true,
  sessionVersion: true,
  mfaEnabled: true,
  mfaSecret: true,
  mfaPendingSecret: true,
  mfaLastUsedStep: true,
  mfaFailedAttempts: true,
  mfaLockedUntil: true
};

// Verifies the first code from the authenticator app, activates MFA, issues recovery codes and
// invalidates every existing session (the caller issues a fresh MFA-verified session).
export async function confirmMfaEnrollment({ userId, code }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: mfaUserSelect });
  if (!user) throw mfaError("User not found", 404, "AUTH_USER_NOT_FOUND");
  if (user.mfaEnabled) throw mfaError("MFA is already enabled for this account.", 409, "AUTH_MFA_ALREADY_ENABLED");
  if (!user.mfaPendingSecret) throw mfaError("Start MFA setup before confirming it.", 409, "AUTH_MFA_ENROLLMENT_NOT_STARTED");
  assertNotLocked(user);
  const step = matchTotp(decryptMfaSecret(user.mfaPendingSecret), code);
  if (step === null) {
    const locked = await recordFailure(user);
    throw mfaError(locked ? "Too many incorrect codes. Try again later." : "That code is not valid. Check your authenticator app and try again.", locked ? 429 : 401, locked ? "AUTH_MFA_LOCKED" : "AUTH_MFA_CODE_INVALID");
  }
  const recoveryCodes = generateRecoveryCodes();
  const updated = await prisma.$transaction(async (tx) => {
    const activated = await tx.user.updateMany({
      where: { id: user.id, mfaEnabled: false, mfaPendingSecret: user.mfaPendingSecret },
      data: {
        mfaEnabled: true,
        mfaSecret: user.mfaPendingSecret,
        mfaPendingSecret: null,
        mfaSetupStatus: "ENABLED",
        mfaVerifiedAt: new Date(),
        mfaLastUsedStep: step,
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        sessionVersion: { increment: 1 }
      }
    });
    if (activated.count === 0) throw mfaError("MFA setup changed. Start again.", 409, "AUTH_MFA_ENROLLMENT_CONFLICT");
    await tx.userMfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.userMfaRecoveryCode.createMany({ data: recoveryCodes.map((recoveryCode) => ({ userId: user.id, codeHash: hashRecoveryCode(recoveryCode) })) });
    await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "mfa_enabled" } });
    return tx.user.findUnique({ where: { id: user.id }, select: { id: true, sessionVersion: true } });
  });
  return { recoveryCodes, sessionVersion: updated.sessionVersion };
}

// Verifies a TOTP code or a one-time recovery code for a user who has MFA enabled.
export async function verifyMfaForUser({ userId, code, recoveryCode }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: mfaUserSelect });
  if (!user?.mfaEnabled || !user.mfaSecret) throw mfaError("MFA is not enabled for this account.", 409, "AUTH_MFA_NOT_ENABLED");
  assertNotLocked(user);
  if (recoveryCode) {
    const consumed = await prisma.userMfaRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: hashRecoveryCode(recoveryCode), usedAt: null },
      data: { usedAt: new Date() }
    });
    if (consumed.count === 1) {
      await prisma.user.update({ where: { id: user.id }, data: { mfaFailedAttempts: 0 } });
      const remaining = await prisma.userMfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } });
      return { method: "recovery_code", remainingRecoveryCodes: remaining };
    }
  } else {
    const step = matchTotp(decryptMfaSecret(user.mfaSecret), code, { lastUsedStep: user.mfaLastUsedStep });
    if (step !== null) {
      // Conditional write closes the race where two requests present the same code at once.
      const accepted = await prisma.user.updateMany({
        where: { id: user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
        data: { mfaLastUsedStep: step, mfaFailedAttempts: 0 }
      });
      if (accepted.count === 1) return { method: "totp" };
    }
  }
  const locked = await recordFailure(user);
  throw mfaError(locked ? "Too many incorrect codes. Try again later." : "That code is not valid.", locked ? 429 : 401, locked ? "AUTH_MFA_LOCKED" : "AUTH_MFA_CODE_INVALID");
}

export async function regenerateRecoveryCodes({ userId, code }) {
  await verifyMfaForUser({ userId, code });
  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.userMfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.userMfaRecoveryCode.createMany({ data: recoveryCodes.map((recoveryCode) => ({ userId, codeHash: hashRecoveryCode(recoveryCode) })) })
  ]);
  return { recoveryCodes };
}

// Clears MFA and signs the user out everywhere. Used by self-service disable for roles that do
// not require MFA and by the Super Admin support reset.
export async function clearMfa({ userId, reason }) {
  await prisma.$transaction([
    prisma.userMfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaPendingSecret: null,
        mfaSetupStatus: "NOT_CONFIGURED",
        mfaVerifiedAt: null,
        mfaLastUsedStep: null,
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        sessionVersion: { increment: 1 }
      }
    }),
    prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } })
  ]);
}

export async function mfaStatusForUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, mfaEnabled: true, mfaSetupStatus: true, mfaVerifiedAt: true } });
  const remainingRecoveryCodes = user?.mfaEnabled ? await prisma.userMfaRecoveryCode.count({ where: { userId, usedAt: null } }) : 0;
  return {
    enabled: Boolean(user?.mfaEnabled),
    setupStatus: user?.mfaSetupStatus || "NOT_CONFIGURED",
    verifiedAt: user?.mfaVerifiedAt || null,
    required: mfaEnforcementEnabled() && roleRequiresMfa(user?.role),
    remainingRecoveryCodes
  };
}

import crypto from "crypto";
import { prisma } from "../config/prisma.js";

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function nowPlus(ms) {
  return new Date(Date.now() + ms);
}

function randomId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(24).toString("hex");
}

function boundedString(value, maxLength) {
  if (!value || typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function requestUserAgent(req) {
  return boundedString(req?.headers?.["user-agent"], 512);
}

function requestIp(req) {
  const forwardedFor = boundedString(req?.headers?.["x-forwarded-for"], 128);
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  return boundedString(firstForwardedIp || req?.ip || req?.socket?.remoteAddress, 64);
}

function hashString(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function inferDeviceType(userAgent = "") {
  const ua = userAgent.toLowerCase();
  if (ua.includes("ipad") || ua.includes("tablet")) return "TABLET";
  if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) return "MOBILE";
  if (ua) return "DESKTOP";
  return "UNKNOWN";
}

function requestSessionMetadata(req) {
  const userAgent = requestUserAgent(req);
  return {
    deviceId: boundedString(req?.headers?.["x-loohar-device-id"], 128),
    deviceName: boundedString(req?.headers?.["x-loohar-device-name"], 128),
    deviceType: boundedString(req?.headers?.["x-loohar-device-type"], 32) || inferDeviceType(userAgent),
    userAgentHash: userAgent ? hashString(userAgent) : null,
    ipAddress: requestIp(req)
  };
}

function sessionError(message, code, status = 401) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function generateRefreshToken() {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

export function hashRefreshToken(refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") {
    throw sessionError("Refresh token is required", "AUTH_REFRESH_TOKEN_MISSING");
  }
  return hashString(refreshToken);
}

export function isSessionExpired(session, at = new Date()) {
  return !session?.expiresAt || new Date(session.expiresAt).getTime() <= at.getTime();
}

export async function createAuthSession({ user, req, tx = prisma, expiresAt = nowPlus(REFRESH_TOKEN_TTL_MS) }) {
  const refreshToken = generateRefreshToken();
  const metadata = requestSessionMetadata(req);
  const session = await tx.authSession.create({
    data: {
      userId: user.id,
      restaurantId: user.restaurantId || null,
      sessionFamilyId: randomId(),
      refreshTokenHash: hashRefreshToken(refreshToken),
      deviceId: metadata.deviceId,
      deviceName: metadata.deviceName,
      deviceType: metadata.deviceType,
      userAgentHash: metadata.userAgentHash,
      ipAddress: metadata.ipAddress,
      sessionVersion: user.sessionVersion || 0,
      expiresAt
    }
  });
  return { session, refreshToken };
}

export async function touchAuthSession(session) {
  if (!session?.id || session.revokedAt) return;
  const lastSeenAt = new Date(session.lastSeenAt || session.createdAt || 0).getTime();
  if (Date.now() - lastSeenAt < SESSION_TOUCH_INTERVAL_MS) return;
  await prisma.authSession.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() }
  }).catch(() => {});
}

export async function revokeAuthSession({ sessionId, reason = "logout" }) {
  if (!sessionId) return null;
  return prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason }
  });
}

export async function revokeAllUserSessions({ userId, reason = "logout_all_devices", tx = prisma }) {
  if (!userId) return null;
  return tx.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason }
  });
}

export async function revokeRestaurantSessions({ restaurantId, reason = "tenant_access_revoked", tx = prisma }) {
  if (!restaurantId) return null;
  return tx.authSession.updateMany({
    where: { restaurantId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason }
  });
}

async function revokeTokenFamily(sessionFamilyId, reason) {
  if (!sessionFamilyId) return;
  await prisma.authSession.updateMany({
    where: { sessionFamilyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason }
  });
}

export async function loadSessionForAccessToken({ payload, userSelect }) {
  if (!payload?.sid) throw sessionError("Access token is missing a session id", "AUTH_SESSION_REQUIRED");
  const session = await prisma.authSession.findUnique({
    where: { id: payload.sid },
    include: { user: { select: userSelect } }
  });
  if (!session || session.userId !== payload.sub) throw sessionError("Invalid bearer token", "AUTH_ACCESS_TOKEN_INVALID");
  return session;
}

export async function rotateAuthSessionRefreshToken({ refreshToken, req, userSelect }) {
  const currentHash = hashRefreshToken(refreshToken);
  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: currentHash },
    include: { user: { select: userSelect } }
  });

  if (!session) {
    const replayedSession = await prisma.authSession.findFirst({
      where: { previousRefreshTokenHash: currentHash },
      select: { sessionFamilyId: true }
    });
    if (replayedSession?.sessionFamilyId) {
      await revokeTokenFamily(replayedSession.sessionFamilyId, "refresh_token_replay");
      throw sessionError("Refresh token replay detected", "AUTH_REFRESH_TOKEN_REPLAY");
    }
    throw sessionError("Invalid refresh token", "AUTH_REFRESH_TOKEN_INVALID");
  }

  if (session.revokedAt) throw sessionError("Session is no longer valid", "AUTH_SESSION_REVOKED");
  if (isSessionExpired(session)) {
    await revokeAuthSession({ sessionId: session.id, reason: "expired" });
    throw sessionError("Refresh token has expired", "AUTH_REFRESH_TOKEN_EXPIRED");
  }
  if (!session.user) throw sessionError("Invalid refresh token", "AUTH_REFRESH_TOKEN_INVALID");
  if ((session.sessionVersion || 0) !== (session.user.sessionVersion || 0)) {
    await revokeAuthSession({ sessionId: session.id, reason: "session_version_mismatch" });
    throw sessionError("Session is no longer valid", "AUTH_SESSION_REVOKED");
  }

  const nextRefreshToken = generateRefreshToken();
  const nextHash = hashRefreshToken(nextRefreshToken);
  const metadata = requestSessionMetadata(req);
  const updatedSession = await prisma.authSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: nextHash,
      previousRefreshTokenHash: currentHash,
      rotatedAt: new Date(),
      lastSeenAt: new Date(),
      deviceId: metadata.deviceId || session.deviceId,
      deviceName: metadata.deviceName || session.deviceName,
      deviceType: metadata.deviceType || session.deviceType,
      userAgentHash: metadata.userAgentHash || session.userAgentHash,
      ipAddress: metadata.ipAddress || session.ipAddress
    },
    include: { user: { select: userSelect } }
  });

  return {
    user: updatedSession.user,
    session: updatedSession,
    refreshToken: nextRefreshToken
  };
}

export async function cleanupExpiredAuthSessions({ olderThan = new Date(), tx = prisma } = {}) {
  return tx.authSession.updateMany({
    where: { expiresAt: { lt: olderThan }, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "expired" }
  });
}

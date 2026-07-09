import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { appUrl } from "../config/urls.js";

function defaultResetTtlMs() {
  const minutes = Number(process.env.RESET_PASSWORD_EXPIRES_MINUTES || 30);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
}

export function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createPasswordResetUrl(token) {
  return `${appUrl()}/reset-password/${token}`;
}

export async function createPasswordResetLink({ userId, expiresInMs = defaultResetTtlMs() }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMs);
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now }
    }),
    prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashPasswordResetToken(token),
        expiresAt
      }
    })
  ]);
  return { resetUrl: createPasswordResetUrl(token), expiresAt };
}

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { maskEmail, normalizeEmail, strongPasswordSchema } from "../src/utils/authSecurity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

function singleConnectionUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "1");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

if (process.env.DIRECT_URL && process.env.AUTH_SCRIPT_USE_DATABASE_URL !== "true") {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
} else if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = singleConnectionUrl(process.env.DATABASE_URL);
}

export { maskEmail, normalizeEmail };

export function createPrismaClient() {
  return new PrismaClient();
}

export function databaseSummary() {
  const rawUrl = process.env.DATABASE_URL || "";
  try {
    const url = new URL(rawUrl);
    return { host: url.host, database: url.pathname.replace(/^\//, "") || null };
  } catch {
    return { host: rawUrl ? "[unparseable-database-url]" : "[missing-database-url]", database: null };
  }
}

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is required.`);
  }
  return String(value);
}

export function validateStrongPassword(password) {
  const parsed = strongPasswordSchema.safeParse(password);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || "Password does not meet requirements.");
  }
}

export function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function bcryptSelfTest() {
  const testPassword = `LooharTest-${Date.now()}!`;
  const hash = await bcrypt.hash(testPassword, 12);
  return bcrypt.compare(testPassword, hash);
}

export function hasArg(name) {
  return process.argv.slice(2).includes(name);
}

export async function recordScriptAudit(prisma, { actorUserId, restaurantId, action, entityType = "User", entityId, metadata = {} }) {
  return prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      restaurantId: restaurantId || null,
      action,
      entityType,
      entityId: entityId || null,
      metadataJson: metadata
    }
  });
}

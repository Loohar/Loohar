import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { maskEmail } from "../src/utils/authSecurity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const apiBase = String(process.env.AUTH_VERIFY_API_URL || process.env.API_URL || "https://api.loohar.com").replace(/\/+$/, "").replace(/\/api$/, "");
const email = String(process.env.AUTH_VERIFY_EMAIL || "").trim();
const password = String(process.env.AUTH_VERIFY_PASSWORD || "");

function assertNoSensitiveUserFields(user) {
  const forbidden = ["password", "passwordHash", "hashedPassword", "temporaryPassword", "resetToken", "resetPasswordToken", "mfaSecret"];
  const leaked = forbidden.find((key) => Object.prototype.hasOwnProperty.call(user || {}, key));
  if (leaked) throw new Error(`Auth response exposed sensitive user field: ${leaked}`);
}

async function readPayload(response) {
  return response.json().catch(() => ({}));
}

async function main() {
  if (!email || !password) {
    throw new Error("Set AUTH_VERIFY_EMAIL and AUTH_VERIFY_PASSWORD to run the production login verifier.");
  }

  const loginResponse = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const loginPayload = await readPayload(loginResponse);
  if (!loginResponse.ok || !loginPayload.accessToken) {
    throw new Error(`Login verifier failed at /api/auth/login with ${loginResponse.status}: ${loginPayload.error || "missing access token"}`);
  }
  assertNoSensitiveUserFields(loginPayload.user);

  const meResponse = await fetch(`${apiBase}/api/auth/me`, {
    credentials: "include",
    cache: "no-store",
    headers: { Authorization: `Bearer ${loginPayload.accessToken}` }
  });
  const mePayload = await readPayload(meResponse);
  if (!meResponse.ok || !mePayload.user?.id) {
    throw new Error(`Login verifier failed at /api/auth/me with ${meResponse.status}: ${mePayload.error || "missing user"}`);
  }
  assertNoSensitiveUserFields(mePayload.user);

  console.log(JSON.stringify({
    ok: true,
    api: apiBase,
    email: maskEmail(email),
    role: mePayload.user.role,
    memberships: Array.isArray(mePayload.memberships) ? mePayload.memberships.length : 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

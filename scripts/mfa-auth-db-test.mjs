// Database-backed HTTP test for privileged-role MFA and authentication hardening.
// Requires a DISPOSABLE local PostgreSQL database with migrations applied:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/mfa-auth-db-test.mjs
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP MFA auth DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "console",
  JWT_SECRET: "local-mfa-test-access-secret",
  REFRESH_TOKEN_SECRET: "local-mfa-test-refresh-secret",
  MFA_ENCRYPTION_KEY: "local-mfa-test-encryption-key"
});
delete process.env.MFA_ENFORCEMENT;
console.log = () => {};

const express = (await import("express")).default;
const bcrypt = (await import("bcrypt")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const authRoutes = (await import("../apps/api/src/routes/auth.js")).default;
const superAdminRoutes = (await import("../apps/api/src/routes/superAdmin.js")).default;
const { requireAuth } = await import("../apps/api/src/middleware/auth.js");
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");
const { base32Decode, generateTotp, totpStep, signMfaChallengeToken } = await import("../apps/api/src/services/mfaService.js");
const { signPosSessionToken } = await import("../apps/api/src/utils/tokens.js");

const app = express();
// Each call simulates a distinct client IP behind a trusted proxy so the per-IP login limiter does not
// throttle the whole suite; the per-account limiter still applies.
app.set("trust proxy", true);
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/admin", superAdminRoutes);
app.get("/api/protected", requireAuth, (req, res) => res.json({ ok: true, userId: req.user.id }));
app.use(errorHandler);

const runId = `mfa${Date.now().toString(36)}`;
const PASSWORD = "Loohar-Test-Password-2026!";
const responses = [];
let server;
let baseUrl;
let restaurant;

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.${(responses.length >> 8) & 255}.${responses.length & 255}.7`,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  responses.push(text);
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { status: response.status, body: json };
}

async function makeUser(label, role, extra = {}) {
  return prisma.user.create({
    data: {
      email: `${label}-${runId}@example.test`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      name: label,
      role,
      restaurantId: role === "SUPER_ADMIN" ? null : restaurant.id,
      passwordChangedAt: new Date(),
      ...extra
    }
  });
}

const login = (user, password = PASSWORD) => call("POST", "/api/auth/login", { body: { email: user.email, password } });
const codeFor = (secret, offset = 0) => generateTotp(base32Decode(secret), totpStep() + offset);

async function enroll(user) {
  const first = await login(user);
  const start = await call("POST", "/api/auth/mfa/enroll/start", { token: first.body.accessToken });
  const confirm = await call("POST", "/api/auth/mfa/enroll/confirm", { token: first.body.accessToken, body: { code: codeFor(start.body.enrollment.secret), currentPassword: PASSWORD } });
  return { first, start, confirm, secret: start.body.enrollment.secret };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  restaurant = await prisma.restaurant.create({ data: { name: `MFA ${runId}`, slug: `${runId}-mfa`, status: "ACTIVE" } });
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
});

test("public registration cannot create staff or owner accounts for a tenant", async () => {
  const escalation = await call("POST", "/api/auth/register", {
    body: { email: `attacker-${runId}@example.test`, password: PASSWORD, role: "RESTAURANT_OWNER", restaurantId: restaurant.id }
  });
  assert.equal(escalation.status, 403);
  assert.equal(escalation.body.code, "AUTH_REGISTRATION_ROLE_FORBIDDEN");
  assert.equal(await prisma.user.count({ where: { email: `attacker-${runId}@example.test` } }), 0);
  const customer = await call("POST", "/api/auth/register", { body: { email: `customer-${runId}@example.test`, password: PASSWORD } });
  assert.equal(customer.status, 201);
  assert.equal(customer.body.user.role, "CUSTOMER");
  assert.equal(customer.body.user.restaurantId ?? null, null);
});

test("privileged roles must enroll MFA before using the API; frontline roles are unaffected", async () => {
  const owner = await makeUser("owner-gate", "RESTAURANT_OWNER");
  const session = await login(owner);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.mfaEnrollmentRequired, true);
  const blocked = await call("GET", "/api/protected", { token: session.body.accessToken });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "AUTH_MFA_ENROLLMENT_REQUIRED");
  assert.equal((await call("GET", "/api/auth/me", { token: session.body.accessToken })).status, 200);

  const cashier = await makeUser("cashier", "CASHIER");
  const cashierSession = await login(cashier);
  assert.equal(cashierSession.body.user.mfaEnrollmentRequired, false);
  assert.equal((await call("GET", "/api/protected", { token: cashierSession.body.accessToken })).status, 200);
});

test("enrollment activates only after a valid code, encrypts the secret, hashes recovery codes and revokes old sessions", async () => {
  const manager = await makeUser("manager-enroll", "RESTAURANT_MANAGER");
  const first = await login(manager);
  const start = await call("POST", "/api/auth/mfa/enroll/start", { token: first.body.accessToken });
  assert.equal(start.status, 200);
  assert.match(start.body.enrollment.otpauthUrl, /^otpauth:\/\/totp\//);
  const pending = await prisma.user.findUnique({ where: { id: manager.id } });
  assert.equal(pending.mfaEnabled, false);
  assert.ok(pending.mfaPendingSecret.startsWith("v1.") && !pending.mfaPendingSecret.includes(start.body.enrollment.secret));

  const noPassword = await call("POST", "/api/auth/mfa/enroll/confirm", { token: first.body.accessToken, body: { code: codeFor(start.body.enrollment.secret) } });
  assert.equal(noPassword.status, 401, "binding an authenticator requires the current password");
  const wrong = await call("POST", "/api/auth/mfa/enroll/confirm", { token: first.body.accessToken, body: { code: "000000", currentPassword: PASSWORD } });
  assert.equal(wrong.status, 401);
  assert.equal((await prisma.user.findUnique({ where: { id: manager.id } })).mfaEnabled, false);

  const confirm = await call("POST", "/api/auth/mfa/enroll/confirm", { token: first.body.accessToken, body: { code: codeFor(start.body.enrollment.secret), currentPassword: PASSWORD } });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.recoveryCodes.length, 10);
  assert.equal((await call("GET", "/api/protected", { token: confirm.body.accessToken })).status, 200);
  assert.equal((await call("GET", "/api/protected", { token: first.body.accessToken })).status, 401, "pre-MFA session is revoked");
  assert.equal((await call("POST", "/api/auth/refresh", { body: { refreshToken: first.body.refreshToken } })).status, 401, "pre-MFA refresh token is revoked");

  const stored = await prisma.userMfaRecoveryCode.findMany({ where: { userId: manager.id } });
  assert.equal(stored.length, 10);
  assert.ok(stored.every((row) => !confirm.body.recoveryCodes.some((code) => row.codeHash.includes(code.replace("-", "")))));
  const activeUser = await prisma.user.findUnique({ where: { id: manager.id } });
  assert.ok(activeUser.mfaSecret.startsWith("v1.") && activeUser.mfaPendingSecret === null);
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: manager.id, action: "mfa.enabled" } }));
});

test("login with MFA issues no session until a valid, non-replayed code is presented", async () => {
  const admin = await makeUser("admin-login", "RESTAURANT_ADMIN");
  const { secret } = await enroll(admin);
  const challenge = await login(admin);
  assert.equal(challenge.status, 200);
  assert.equal(challenge.body.mfaRequired, true);
  assert.equal(challenge.body.accessToken, undefined);
  assert.equal(challenge.body.refreshToken, undefined);
  assert.equal((await call("GET", "/api/protected", { token: challenge.body.mfaToken })).status, 401, "challenge token is not an access token");

  const wrong = await call("POST", "/api/auth/mfa/verify", { body: { mfaToken: challenge.body.mfaToken, code: "123456" } });
  assert.equal(wrong.status, 401);
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: admin.id, action: "mfa.challenge.failed" } }));

  // Enrollment consumed the current step; the next step's code is accepted once and cannot be replayed.
  const nextCode = codeFor(secret, 1);
  const verified = await call("POST", "/api/auth/mfa/verify", { body: { mfaToken: challenge.body.mfaToken, code: nextCode } });
  assert.equal(verified.status, 200);
  assert.ok(verified.body.accessToken && verified.body.refreshToken);
  assert.equal((await call("GET", "/api/protected", { token: verified.body.accessToken })).status, 200);
  const replay = await call("POST", "/api/auth/mfa/verify", { body: { mfaToken: (await login(admin)).body.mfaToken, code: nextCode } });
  assert.equal(replay.status, 401, "a used code cannot be replayed");

  const refreshed = await call("POST", "/api/auth/refresh", { body: { refreshToken: verified.body.refreshToken } });
  assert.equal(refreshed.status, 200, "MFA-verified sessions refresh normally");
  assert.equal((await call("GET", "/api/protected", { token: refreshed.body.accessToken })).status, 200);
});

test("recovery codes work exactly once", async () => {
  const owner = await makeUser("owner-recovery", "TENANT_OWNER");
  const { confirm } = await enroll(owner);
  const recoveryCode = confirm.body.recoveryCodes[0];
  const first = await call("POST", "/api/auth/mfa/verify", { body: { mfaToken: (await login(owner)).body.mfaToken, recoveryCode } });
  assert.equal(first.status, 200);
  assert.equal(first.body.mfa.method, "recovery_code");
  assert.equal(first.body.mfa.remainingRecoveryCodes, 9);
  const second = await call("POST", "/api/auth/mfa/verify", { body: { mfaToken: (await login(owner)).body.mfaToken, recoveryCode } });
  assert.equal(second.status, 401);
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: owner.id, action: "mfa.recovery_code.used" } }));
});

test("repeated wrong codes lock MFA even for a correct code", async () => {
  const owner = await makeUser("owner-lock", "RESTAURANT_OWNER");
  const { secret } = await enroll(owner);
  const { mfaToken } = (await login(owner)).body;
  const attempts = await Promise.all(Array.from({ length: 6 }, () => call("POST", "/api/auth/mfa/verify", { body: { mfaToken, code: "999999" } })));
  assert.ok(attempts.some((attempt) => attempt.status === 429), JSON.stringify(attempts.map((attempt) => attempt.status)));
  const correct = await call("POST", "/api/auth/mfa/verify", { body: { mfaToken, code: codeFor(secret, 1) } });
  assert.equal(correct.status, 429);
  assert.equal(correct.body.code, "AUTH_MFA_LOCKED");
});

test("challenge tokens die with session invalidation and cannot be forged into POS or access tokens", async () => {
  const owner = await makeUser("owner-challenge", "RESTAURANT_OWNER");
  const { secret, confirm } = await enroll(owner);
  const { mfaToken } = (await login(owner)).body;
  assert.equal((await call("POST", "/api/auth/logout-all-devices", { token: confirm.body.accessToken })).status, 204);
  const stale = await call("POST", "/api/auth/mfa/verify", { body: { mfaToken, code: codeFor(secret, 1) } });
  assert.equal(stale.status, 401);
  const posToken = signPosSessionToken({ userId: owner.id, restaurantId: restaurant.id, staffId: "x", deviceId: "y", locationId: null, sessionId: null });
  assert.equal((await call("GET", "/api/protected", { token: posToken })).status, 401);
  const forgedChallenge = signMfaChallengeToken({ id: owner.id, sessionVersion: 999 });
  assert.equal((await call("POST", "/api/auth/mfa/verify", { body: { mfaToken: forgedChallenge, code: codeFor(secret, 1) } })).status, 401);
});

test("privileged users cannot turn MFA off; password reset still requires MFA", async () => {
  const owner = await makeUser("owner-disable", "RESTAURANT_OWNER");
  const { secret, confirm } = await enroll(owner);
  const disable = await call("POST", "/api/auth/mfa/disable", { token: confirm.body.accessToken, body: { currentPassword: PASSWORD, code: codeFor(secret, 1) } });
  assert.equal(disable.status, 403);
  assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).mfaEnabled, true);

  const { createPasswordResetLink } = await import("../apps/api/src/services/passwordResetService.js");
  const { resetUrl } = await createPasswordResetLink({ userId: owner.id });
  const token = decodeURIComponent(resetUrl.split("/").pop().split("?")[0]);
  const reset = await call("POST", "/api/auth/reset-password", { body: { token, newPassword: "Another-Strong-Password-2026!" } });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.mfaRequired, true);
  assert.equal(reset.body.accessToken, undefined);
  const reused = await call("POST", "/api/auth/reset-password", { body: { token, newPassword: "Third-Strong-Password-2026!" } });
  assert.equal(reused.status, 400, "reset links are single use");
});

test("changing a password requires the current password", async () => {
  const cashier = await makeUser("cashier-password", "CASHIER");
  const session = await login(cashier);
  const withoutCurrent = await call("POST", "/api/auth/change-password", { token: session.body.accessToken, body: { newPassword: "Stolen-Token-Password-2026!" } });
  assert.equal(withoutCurrent.status, 401);
  assert.equal(withoutCurrent.body.code, "AUTH_CURRENT_PASSWORD_INVALID");
  const withCurrent = await call("POST", "/api/auth/change-password", { token: session.body.accessToken, body: { currentPassword: PASSWORD, newPassword: "Rotated-Password-2026-Loohar!" } });
  assert.equal(withCurrent.status, 200);
});

test("Super Admin can reset another user's MFA with audit; tenant users cannot", async () => {
  const superAdmin = await makeUser("platform", "SUPER_ADMIN");
  const { secret: adminSecret } = await enroll(superAdmin);
  const adminSession = await call("POST", "/api/auth/mfa/verify", { body: { mfaToken: (await login(superAdmin)).body.mfaToken, code: codeFor(adminSecret, 1) } });
  assert.equal(adminSession.status, 200);
  const manager = await makeUser("manager-reset", "RESTAURANT_MANAGER");
  const { confirm } = await enroll(manager);

  const byTenantUser = await call("POST", `/api/admin/users/${manager.id}/mfa/reset`, { token: confirm.body.accessToken });
  assert.equal(byTenantUser.status, 403);

  const reset = await call("POST", `/api/admin/users/${manager.id}/mfa/reset`, { token: adminSession.body.accessToken, body: { reason: "lost phone" } });
  assert.equal(reset.status, 200);
  const cleared = await prisma.user.findUnique({ where: { id: manager.id } });
  assert.equal(cleared.mfaEnabled, false);
  assert.equal(cleared.mfaSecret, null);
  assert.equal(await prisma.userMfaRecoveryCode.count({ where: { userId: manager.id } }), 0);
  assert.equal((await call("GET", "/api/protected", { token: confirm.body.accessToken })).status, 401, "reset signs the user out everywhere");
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: manager.id, action: "mfa.reset_by_super_admin" } }));
});

test("no API response ever contains stored MFA secrets or recovery code hashes", async () => {
  const secrets = await prisma.user.findMany({ where: { mfaSecret: { not: null } }, select: { mfaSecret: true } });
  const hashes = await prisma.userMfaRecoveryCode.findMany({ select: { codeHash: true } });
  for (const text of responses) {
    assert.ok(!/"mfaSecret"|"mfaPendingSecret"|"codeHash"/.test(text), "sensitive MFA keys are never serialized");
    for (const { mfaSecret } of secrets) assert.ok(!text.includes(mfaSecret));
    for (const { codeHash } of hashes) assert.ok(!text.includes(codeHash));
  }
});

test("an impersonation session cannot enroll MFA or change the target's password", async () => {
  const superAdmin = await makeUser("platform-imp", "SUPER_ADMIN");
  const { secret } = await enroll(superAdmin);
  const adminSession = await call("POST", "/api/auth/mfa/verify", { body: { mfaToken: (await login(superAdmin)).body.mfaToken, code: codeFor(secret, 1) } });
  await makeUser("owner-imp", "RESTAURANT_OWNER");
  const imp = await call("POST", `/api/admin/restaurants/${restaurant.id}/impersonate`, { token: adminSession.body.accessToken });
  assert.equal(imp.status, 200);
  assert.equal(imp.body.refreshToken, null);
  const enrollStart = await call("POST", "/api/auth/mfa/enroll/start", { token: imp.body.accessToken });
  const password = await call("POST", "/api/auth/change-password", { token: imp.body.accessToken, body: { newPassword: "Hijack-Password-2026-Loohar!" } });
  assert.ok([403].includes(enrollStart.status) && enrollStart.body.code === "AUTH_IMPERSONATION_ACCOUNT_SETUP_FORBIDDEN", JSON.stringify(enrollStart));
  assert.equal(password.status, 403);
});

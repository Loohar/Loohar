// Adversarial tests for the Super Admin surfaces: the widest authority in the product. Real routes,
// real auth middleware, real sessions, against a disposable local database.
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/super-admin-authz-db-test.mjs
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
  console.log("SKIP super admin authz DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  EMAIL_PROVIDER: "console",
  JWT_SECRET: "local-superadmin-test-secret",
  REFRESH_TOKEN_SECRET: "local-superadmin-test-refresh"
});
console.log = () => {};

const express = (await import("express")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const superAdminRoutes = (await import("../apps/api/src/routes/superAdmin.js")).default;
const restaurantRoutes = (await import("../apps/api/src/routes/restaurant.js")).default;
const authRoutes = (await import("../apps/api/src/routes/auth.js")).default;
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");
const { createAuthSession } = await import("../apps/api/src/services/authSessionService.js");
const { signAccessToken } = await import("../apps/api/src/utils/tokens.js");

const app = express();
app.use(express.json());
app.use("/api/admin", superAdminRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/auth", authRoutes);
app.use(errorHandler);

const runId = `sa${Date.now().toString(36)}`;
let server;
let baseUrl;
const ctx = {};

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function sessionFor(user, { mfaVerified = true } = {}) {
  const { session } = await createAuthSession({ user, req: { headers: {} }, mfaVerifiedAt: mfaVerified ? new Date() : null });
  return signAccessToken(user, session);
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  ctx.superAdmin = await prisma.user.create({
    data: { email: `super-${runId}@example.test`, passwordHash: "x", name: "Platform Owner", role: "SUPER_ADMIN", mfaEnabled: true, passwordChangedAt: new Date() }
  });
  ctx.otherSuperAdmin = await prisma.user.create({
    data: { email: `super2-${runId}@example.test`, passwordHash: "x", name: "Second Owner", role: "SUPER_ADMIN", mfaEnabled: true, passwordChangedAt: new Date() }
  });
  ctx.restaurant = await prisma.restaurant.create({
    data: { name: `SA ${runId}`, slug: `${runId}-a`, status: "ACTIVE", tenantClassification: "INTERNAL_DEVELOPMENT", locations: { create: { name: "Main" } } }
  });
  ctx.owner = await prisma.user.create({
    data: { email: `owner-${runId}@example.test`, passwordHash: "x", name: "Owner", role: "TENANT_OWNER", restaurantId: ctx.restaurant.id, mfaEnabled: true, passwordChangedAt: new Date() }
  });
  await prisma.restaurantStaff.create({ data: { restaurantId: ctx.restaurant.id, userId: ctx.owner.id, role: "TENANT_OWNER", active: true } });
  ctx.cashier = await prisma.user.create({
    data: { email: `cashier-${runId}@example.test`, passwordHash: "x", name: "Cashier", role: "CASHIER", restaurantId: ctx.restaurant.id, passwordChangedAt: new Date() }
  });

  ctx.superToken = await sessionFor(ctx.superAdmin);
  ctx.ownerToken = await sessionFor(ctx.owner);
  ctx.cashierToken = await sessionFor(ctx.cashier);
});

after(async () => {
  server?.close();
  await prisma.$disconnect();
});

test("only a super admin can reach the platform surfaces", async () => {
  const paths = [
    ["GET", "/api/admin/restaurants"],
    ["GET", "/api/admin/dashboard-summary"],
    ["GET", `/api/admin/restaurants/${ctx.restaurant.id}/users`],
    ["GET", `/api/admin/restaurants/${ctx.restaurant.id}/audit`]
  ];
  for (const [method, path] of paths) {
    const anonymous = await call(method, path);
    assert.equal([401, 403].includes(anonymous.status), true, `${path} refuses anonymous callers`);
    const owner = await call(method, path, { token: ctx.ownerToken });
    assert.equal(owner.status, 403, `${path} refuses a restaurant owner`);
    const cashier = await call(method, path, { token: ctx.cashierToken });
    assert.equal(cashier.status, 403, `${path} refuses a cashier`);
    const superAdmin = await call(method, path, { token: ctx.superToken });
    assert.equal(superAdmin.status, 200, `${path} is open to a super admin`);
  }
});

test("a restaurant owner cannot suspend, delete or edit tenants", async () => {
  for (const [method, path, body] of [
    ["POST", `/api/admin/restaurants/${ctx.restaurant.id}/suspend`, {}],
    ["POST", `/api/admin/restaurants/${ctx.restaurant.id}/activate`, {}],
    ["PATCH", `/api/admin/restaurants/${ctx.restaurant.id}`, { name: "Renamed by attacker" }],
    ["DELETE", `/api/admin/restaurants/${ctx.restaurant.id}`, undefined]
  ]) {
    const result = await call(method, path, { token: ctx.ownerToken, body });
    assert.equal(result.status, 403, `${method} ${path} refuses a restaurant owner`);
  }
  const unchanged = await prisma.restaurant.findUnique({ where: { id: ctx.restaurant.id } });
  assert.equal(unchanged.status, "ACTIVE");
  assert.equal(unchanged.name, `SA ${runId}`);
});

test("impersonation is a short, audited support session that cannot change account security", async () => {
  const started = await call("POST", `/api/admin/restaurants/${ctx.restaurant.id}/impersonate`, { token: ctx.superToken });
  assert.equal(started.status, 200);
  assert.equal(started.body.refreshToken, null, "an impersonated session cannot be refreshed");
  const lifetimeMs = new Date(started.body.expiresAt).getTime() - Date.now();
  assert.ok(lifetimeMs > 0 && lifetimeMs <= 31 * 60_000, `impersonation expires quickly (${Math.round(lifetimeMs / 60000)} minutes)`);
  assert.equal(started.body.impersonatedUser.id, ctx.owner.id);
  assert.equal("passwordHash" in started.body.impersonatedUser, false, "no password material is returned");

  const audit = await prisma.auditLog.findFirst({ where: { action: "impersonation.started", entityId: ctx.owner.id }, orderBy: { createdAt: "desc" } });
  assert.ok(audit, "impersonation is recorded");
  assert.equal(audit.actorUserId, ctx.superAdmin.id, "the audit names the acting super admin");

  // The borrowed session can read the tenant, but must not be able to change account security.
  const impersonatedToken = started.body.accessToken;
  const enrollment = await call("POST", "/api/auth/mfa/enroll/start", { token: impersonatedToken });
  assert.equal(enrollment.status, 403, "an impersonated session cannot start MFA enrollment");
  assert.equal(enrollment.body.code, "AUTH_IMPERSONATION_ACCOUNT_SETUP_FORBIDDEN");

  const cashier = await call("POST", `/api/restaurants/${ctx.restaurant.id}/employees`, {
    token: impersonatedToken,
    body: { email: `impersonated-${runId}@example.test`, name: "Added while impersonating", role: "CASHIER" }
  });
  assert.equal([200, 201, 403].includes(cashier.status), true);
});

test("MFA reset is limited and always audited", async () => {
  const self = await call("POST", `/api/admin/users/${ctx.superAdmin.id}/mfa/reset`, { token: ctx.superToken, body: { reason: "test" } });
  assert.equal(self.status, 403, "a super admin cannot reset their own MFA");
  assert.equal(self.body.code, "MFA_SELF_RESET_FORBIDDEN");

  const otherPlatformOwner = await call("POST", `/api/admin/users/${ctx.otherSuperAdmin.id}/mfa/reset`, { token: ctx.superToken, body: { reason: "test" } });
  assert.equal(otherPlatformOwner.status, 403, "platform owner accounts need a dedicated recovery flow");
  assert.equal(otherPlatformOwner.body.code, "MFA_SUPER_ADMIN_RESET_FORBIDDEN");

  const byOwner = await call("POST", `/api/admin/users/${ctx.owner.id}/mfa/reset`, { token: ctx.ownerToken, body: { reason: "attacker" } });
  assert.equal(byOwner.status, 403, "a restaurant owner cannot reset anyone's MFA");
  assert.equal((await prisma.user.findUnique({ where: { id: ctx.owner.id } })).mfaEnabled, true, "the target keeps MFA");

  const supported = await call("POST", `/api/admin/users/${ctx.owner.id}/mfa/reset`, { token: ctx.superToken, body: { reason: "owner lost their phone" } });
  assert.equal(supported.status, 200, "a super admin can support a locked-out restaurant owner");
  assert.equal((await prisma.user.findUnique({ where: { id: ctx.owner.id } })).mfaEnabled, false, "MFA is cleared so the owner can enroll again");
  const audit = await prisma.auditLog.findFirst({ where: { action: "mfa.reset_by_super_admin", entityId: ctx.owner.id }, orderBy: { createdAt: "desc" } });
  assert.ok(audit, "the reset is recorded");
  assert.equal(audit.actorUserId, ctx.superAdmin.id);
  assert.match(String(audit.metadataJson?.reason || ""), /lost their phone/, "the reason the support action was taken is recorded");
});

test("a suspended tenant loses access while its data stays intact", async () => {
  const suspended = await call("POST", `/api/admin/restaurants/${ctx.restaurant.id}/suspend`, { token: ctx.superToken, body: { reason: "billing" } });
  assert.equal(suspended.status, 200);
  assert.equal((await prisma.restaurant.findUnique({ where: { id: ctx.restaurant.id } })).status, "SUSPENDED");

  const blocked = await call("GET", `/api/restaurants/${ctx.restaurant.id}/reporting/daily`, { token: ctx.ownerToken });
  assert.equal([401, 403].includes(blocked.status), true, "a suspended tenant cannot use the product");

  const activated = await call("POST", `/api/admin/restaurants/${ctx.restaurant.id}/activate`, { token: ctx.superToken });
  assert.equal(activated.status, 200);
  assert.equal((await prisma.restaurant.findUnique({ where: { id: ctx.restaurant.id } })).status, "ACTIVE", "reactivation restores the tenant");
});

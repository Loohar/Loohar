// Signing out must work even when the access token has expired (L-28).
//
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db \
//   node --test scripts/logout-expired-token-db-test.mjs
//
// An access token lives 15 minutes. Logout used to require an unexpired one, so a cashier who
// stepped away and came back to press "log out" got a 401 while the refresh session stayed alive on
// a shared restaurant device: the sign-out they believed in never happened, and the refresh token
// sitting in browser storage still worked.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP logout expired token DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}
const jwtSecret = `logout-test-${crypto.randomBytes(8).toString("hex")}`;
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  NODE_ENV: "test",
  JWT_SECRET: jwtSecret,
  REFRESH_TOKEN_SECRET: `${jwtSecret}-refresh`
});

const jwt = (await import("jsonwebtoken")).default;
const { prisma } = await import("../apps/api/src/config/prisma.js");
const authRoutes = (await import("../apps/api/src/routes/auth.js")).default;
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");
const express = (await import("express")).default;

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use(errorHandler);
const server = app.listen(0);
const port = server.address().port;
const logout = (token) => fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
  method: "POST",
  headers: token ? { Authorization: `Bearer ${token}` } : {}
});

const runId = `lo${Date.now().toString(36)}`;
let seq = 0;

async function seedSignedInUser() {
  seq += 1;
  const user = await prisma.user.create({
    data: { email: `logout-${runId}-${seq}@example.test`, passwordHash: "not-a-real-hash", name: "Cashier", role: "RESTAURANT_MANAGER", sessionVersion: 0 }
  });
  const session = await prisma.authSession.create({
    data: {
      userId: user.id,
      sessionFamilyId: crypto.randomUUID(),
      sessionVersion: 0,
      refreshTokenHash: crypto.createHash("sha256").update(`${runId}-${seq}`).digest("hex"),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });
  return { user, session };
}
// Same claims the application signs, so the only difference in the expired case is the expiry.
const claimsFor = ({ user, session }) => ({
  sub: user.id,
  sid: session.id,
  role: user.role,
  restaurantId: user.restaurantId || null,
  sessionVersion: 0
});
const tokenFor = (context, { expired = false } = {}) => jwt.sign(
  claimsFor(context),
  jwtSecret,
  { expiresIn: expired ? -600 : 900 }
);
const sessionOf = (id) => prisma.authSession.findUnique({ where: { id } });

after(async () => {
  server.close();
  await prisma.$disconnect();
});

test("logging out with a live token revokes the session", async () => {
  const context = await seedSignedInUser();
  const response = await logout(tokenFor(context));
  assert.equal(response.status, 204);
  assert.ok((await sessionOf(context.session.id)).revokedAt, "the session must be revoked");
});

test("logging out with an expired token still revokes the session", async () => {
  const context = await seedSignedInUser();
  const response = await logout(tokenFor(context, { expired: true }));
  assert.equal(response.status, 204, "an expired token must not stop someone signing out");
  const session = await sessionOf(context.session.id);
  assert.ok(session.revokedAt, "the refresh session must not survive a sign-out the user believes in");
});

test("a forged or missing token still cannot revoke anything", async () => {
  const context = await seedSignedInUser();

  const forged = jwt.sign(claimsFor(context), "not-the-signing-secret", { expiresIn: 900 });
  assert.equal((await logout(forged)).status, 401, "a token Loohar did not sign is refused");
  assert.equal((await logout(null)).status, 401, "no token is refused");
  assert.equal((await logout("not-a-token")).status, 401);
  assert.equal((await sessionOf(context.session.id)).revokedAt, null, "the session is untouched by those attempts");
});

test("logging out twice stays successful and does not disturb another session", async () => {
  const mine = await seedSignedInUser();
  const other = await seedSignedInUser();

  assert.equal((await logout(tokenFor(mine, { expired: true }))).status, 204);
  assert.equal((await logout(tokenFor(mine, { expired: true }))).status, 204, "signing out again is not an error");
  assert.equal((await sessionOf(other.session.id)).revokedAt, null, "another user's session is untouched");
});

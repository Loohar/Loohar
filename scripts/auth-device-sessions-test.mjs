import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const schema = readFileSync(join(root, "apps/api/prisma/schema.prisma"), "utf8");
const migrationPath = join(root, "apps/api/prisma/migrations/20260804090000_auth_device_sessions/migration.sql");
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const service = readFileSync(join(root, "apps/api/src/services/authSessionService.js"), "utf8");
const middleware = readFileSync(join(root, "apps/api/src/middleware/auth.js"), "utf8");
const authRoutes = readFileSync(join(root, "apps/api/src/routes/auth.js"), "utf8");
const superAdminRoutes = readFileSync(join(root, "apps/api/src/routes/superAdmin.js"), "utf8");
const restaurantRoutes = readFileSync(join(root, "apps/api/src/routes/restaurant.js"), "utf8");
const tokens = readFileSync(join(root, "apps/api/src/utils/tokens.js"), "utf8");
const failures = [];

function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
    return;
  }
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function sliceBetween(content, startNeedle, endNeedle) {
  const start = content.indexOf(startNeedle);
  const end = content.indexOf(endNeedle, start + startNeedle.length);
  if (start === -1 || end === -1) return "";
  return content.slice(start, end);
}

const authSessionModel = sliceBetween(schema, "model AuthSession", "\nmodel Restaurant");
const logoutRoute = sliceBetween(authRoutes, 'router.post("/logout"', '\nrouter.post("/logout-all-devices"');
const logoutAllDevicesRoute = sliceBetween(authRoutes, 'router.post("/logout-all-devices"', '\nrouter.get("/me"');
const refreshRoute = sliceBetween(authRoutes, "async function refreshToken", '\nrouter.post("/refresh-token"');
const passwordChangeRoute = sliceBetween(authRoutes, 'router.post("/change-password"', "\nasync function refreshToken");
const passwordResetRoute = sliceBetween(authRoutes, 'router.post("/reset-password"', '\nrouter.post("/logout"');

assertCheck(Boolean(migration), "Auth device-session migration exists");
assertCheck(migration.includes('CREATE TABLE "AuthSession"'), "Migration creates AuthSession table");
assertCheck(migration.includes('"refreshTokenHash" TEXT NOT NULL') && migration.includes('AuthSession_refreshTokenHash_key'), "Migration stores unique hashed refresh tokens");
assertCheck(migration.includes('AuthSession_userId_revokedAt_idx') && migration.includes('AuthSession_expiresAt_idx') && migration.includes('AuthSession_sessionFamilyId_idx'), "Migration adds session lookup and cleanup indexes");
assertCheck(migration.includes('ON DELETE CASCADE') && migration.includes('ON DELETE SET NULL'), "Migration uses explicit foreign-key delete behavior");

assertCheck(/refreshTokenHash\s+String\s+@unique/.test(authSessionModel), "AuthSession model keeps refresh token hash unique");
assertCheck(authSessionModel.includes("previousRefreshTokenHash") && authSessionModel.includes("sessionFamilyId"), "AuthSession model keeps token-family replay state");
assertCheck(authSessionModel.includes("deviceId") && authSessionModel.includes("deviceName") && authSessionModel.includes("deviceType"), "AuthSession model captures bounded device metadata");
assertCheck(authSessionModel.includes("revokedAt") && authSessionModel.includes("revokedReason") && authSessionModel.includes("expiresAt"), "AuthSession model supports revocation and expiration");

assertCheck(service.includes("crypto.randomBytes(REFRESH_TOKEN_BYTES)") && service.includes("toString(\"base64url\")"), "Refresh tokens are opaque random values");
assertCheck(service.includes("crypto.createHash(\"sha256\")") && !service.includes("passwordHash"), "Refresh tokens are hashed server-side without mixing password fields");
assertCheck(service.includes("createAuthSession") && service.includes("rotateAuthSessionRefreshToken"), "Service creates and rotates sessions");
assertCheck(service.includes("previousRefreshTokenHash: currentHash") && service.includes("refresh_token_replay"), "Service detects refresh-token replay");
assertCheck(service.includes("revokeAuthSession") && service.includes("revokeAllUserSessions") && service.includes("revokeRestaurantSessions"), "Service exposes scoped revocation helpers");
assertCheck(service.includes("cleanupExpiredAuthSessions"), "Service exposes safe expired-session cleanup");

assertCheck(tokens.includes("sid: session?.id") && tokens.includes("sessionVersion"), "Access token contains persisted session id");
assertCheck(middleware.includes("loadSessionForAccessToken") && service.includes("payload?.sid"), "Middleware loads the persisted session from access-token sid");
assertCheck(middleware.includes("session.revokedAt") && middleware.includes("isSessionExpired(session)") && middleware.includes("sessionVersion"), "Middleware rejects revoked, expired, and stale sessions");
assertCheck(middleware.includes("touchAuthSession(session)"), "Middleware updates session last-seen metadata on valid access");

assertCheck(refreshRoute.includes("rotateAuthSessionRefreshToken") && refreshRoute.includes("revokeAuthSession") && refreshRoute.includes("tenant_access_revoked"), "Refresh route rotates sessions and revokes invalid tenant/user sessions");
assertCheck(!authRoutes.includes("signRefreshToken") && !authRoutes.includes("verifyRefreshToken"), "Auth routes do not issue or verify stateless refresh JWTs");
assertCheck(logoutRoute.includes("revokeAuthSession") && logoutRoute.includes("authSession.current_device") && !logoutRoute.includes("sessionVersion: { increment: 1 }"), "Logout revokes current device only");
assertCheck(logoutAllDevicesRoute.includes("sessionVersion: { increment: 1 }") && logoutAllDevicesRoute.includes("revokeAllUserSessions") && logoutAllDevicesRoute.includes("authSession.all_devices"), "Logout-all-devices revokes every active session");
assertCheck(passwordChangeRoute.includes("sessionVersion: { increment: 1 }") && passwordChangeRoute.includes("revokeAllUserSessions"), "Password change revokes all existing sessions");
assertCheck(passwordResetRoute.includes("sessionVersion: { increment: 1 }") && passwordResetRoute.includes("revokeAllUserSessions"), "Password reset revokes all existing sessions");
assertCheck(superAdminRoutes.includes("revokeRestaurantSessions") && superAdminRoutes.includes("business_suspended") && superAdminRoutes.includes("business_${status.toLowerCase()}"), "Tenant suspension/deletion revokes tenant sessions");
assertCheck(superAdminRoutes.includes("revokeAllUserSessions") && superAdminRoutes.includes("admin_password_reset") && superAdminRoutes.includes("user_status_"), "Admin user changes revoke affected user sessions");
assertCheck(restaurantRoutes.includes("revokeAllUserSessions") && restaurantRoutes.includes("employee_role_changed") && restaurantRoutes.includes("employee_disabled"), "Restaurant employee changes revoke affected staff sessions");

if (failures.length) {
  console.error(`auth-device-sessions-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("auth-device-sessions-test passed.");

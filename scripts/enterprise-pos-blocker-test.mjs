import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const authRoutes = readFileSync(join(root, "apps/api/src/routes/auth.js"), "utf8");
const authMiddleware = readFileSync(join(root, "apps/api/src/middleware/auth.js"), "utf8");
const authSessionService = readFileSync(join(root, "apps/api/src/services/authSessionService.js"), "utf8");
const prismaSchema = readFileSync(join(root, "apps/api/prisma/schema.prisma"), "utf8");
const tokens = readFileSync(join(root, "apps/api/src/utils/tokens.js"), "utf8");
const webApp = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const posScreens = readFileSync(join(root, "apps/web/src/apps/pos/PosWorkflowScreens.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");
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

const logoutRoute = sliceBetween(authRoutes, 'router.post("/logout"', '\nrouter.post("/logout-all-devices"');
const logoutAllDevicesRoute = sliceBetween(authRoutes, 'router.post("/logout-all-devices"', '\nrouter.get("/me"');
const demoLoginEnabled = sliceBetween(authRoutes, "function demoLoginEnabled()", "\nfunction demoEmailForMode");
const findDemoUser = sliceBetween(authRoutes, "async function findDemoUser", '\nrouter.post("/register"');
const posApiBlock = sliceBetween(webApp, "async function posApi", "\n  async function loadPos");

assertCheck(prismaSchema.includes("model AuthSession") && prismaSchema.includes("authSessions"), "Prisma schema defines canonical AuthSession relations");
assertCheck(/refreshTokenHash\s+String\s+@unique/.test(prismaSchema) && prismaSchema.includes("previousRefreshTokenHash"), "AuthSession stores hashed refresh tokens with replay-detection state");
assertCheck(prismaSchema.includes("sessionFamilyId") && prismaSchema.includes("revokedAt") && prismaSchema.includes("expiresAt"), "AuthSession records token family, revocation, and expiration data");
assertCheck(prismaSchema.includes("@@index([userId, revokedAt])") && prismaSchema.includes("@@index([expiresAt])") && prismaSchema.includes("@@index([sessionFamilyId])"), "AuthSession has safe lookup and cleanup indexes");

assertCheck(authSessionService.includes("generateRefreshToken") && authSessionService.includes("crypto.randomBytes") && authSessionService.includes("hashRefreshToken"), "AuthSession service generates and hashes opaque refresh tokens");
assertCheck(authSessionService.includes("createAuthSession") && authSessionService.includes("rotateAuthSessionRefreshToken"), "AuthSession service creates sessions and rotates refresh tokens");
assertCheck(authSessionService.includes("previousRefreshTokenHash") && authSessionService.includes("refresh_token_replay") && authSessionService.includes("revokeTokenFamily"), "Refresh replay detection revokes the token family");
assertCheck(authSessionService.includes("revokeAuthSession") && authSessionService.includes("revokeAllUserSessions") && authSessionService.includes("revokeRestaurantSessions"), "AuthSession service supports current-device, all-device, and tenant-wide revocation");

assertCheck(tokens.includes("sid: session?.id") && tokens.includes("sessionVersion"), "Access tokens include session id and session version claims");
assertCheck(authMiddleware.includes("loadSessionForAccessToken") && authSessionService.includes("payload?.sid") && authMiddleware.includes("session.revokedAt"), "Auth middleware validates persisted session state for every bearer token");
assertCheck(authMiddleware.includes("isSessionExpired(session)") && authMiddleware.includes("revokeAuthSession") && authMiddleware.includes("sessionVersion"), "Auth middleware rejects expired or stale sessions");

assertCheck(authRoutes.includes("verifyAccessToken") && authRoutes.includes("authenticateLogoutRequest"), "Logout route verifies the submitted access token server-side");
assertCheck(authRoutes.includes("createAuthSession") && authRoutes.includes("rotateAuthSessionRefreshToken") && !authRoutes.includes("signRefreshToken"), "Auth routes use persisted sessions instead of stateless refresh JWT issuance");
assertCheck(logoutRoute.includes("revokeAuthSession") && logoutRoute.includes("authSession.current_device"), "Logout revokes only the current persisted device session");
assertCheck(!logoutRoute.includes("sessionVersion: { increment: 1 }"), "Current-device logout does not invalidate every active device");
assertCheck(logoutRoute.includes("alreadyRevoked") && logoutRoute.includes("res.status(204).send()"), "Repeated logout returns an idempotent no-content success when already revoked");
assertCheck(logoutAllDevicesRoute.includes("requireAuth") && logoutAllDevicesRoute.includes("sessionVersion: { increment: 1 }") && logoutAllDevicesRoute.includes("revokeAllUserSessions"), "Logout-all-devices route preserves explicit all-session revocation");
assertCheck(logoutAllDevicesRoute.includes("authSession.all_devices"), "Logout-all-devices audit metadata records all-device revocation");
assertCheck(demoLoginEnabled.includes("ENABLE_DEMO_LOGIN") && demoLoginEnabled.includes("staging") && demoLoginEnabled.includes("preview"), "Demo login can be enabled for staging or preview without opening production by default");
assertCheck(findDemoUser.includes('role === "SUPER_ADMIN"') && findDemoUser.includes('role: "SUPER_ADMIN"') && findDemoUser.includes('NOT: userEmailWhere("admin@platform.local")'), "Super Admin staging fixture lookup is role based and avoids production default admin");

assertCheck(!posApiBlock.includes("authRetry: false"), "POS API no longer disables shared auth refresh retry");
assertCheck(posApiBlock.includes("clearOnUnauthorized: false") && posApiBlock.includes("skipDedupe: true"), "POS API keeps register state and avoids request dedupe for operational calls");
assertCheck(posApiBlock.includes('"x-loohar-pos-session"') && posApiBlock.includes("...(options.headers || {})"), "POS auth retry preserves POS session and idempotency headers");
assertCheck(webApp.includes("function lazyPosScreen") && webApp.includes('import("./apps/pos/PosWorkflowScreens.jsx")') && !webApp.includes('from "./apps/pos/PosWorkflowScreens.jsx"'), "POS workflow screens are route-split with lazy named imports");
assertCheck(webApp.includes('const DriverPwaApp = lazy(() => import("./apps/driver/DriverApp.jsx"))') && !webApp.includes('from "./apps/driver/DriverApp.jsx"'), "Driver app is route-split out of the initial application bundle");
assertCheck(webApp.includes("<Suspense fallback={<PosChunkFallback") && webApp.includes("<Suspense fallback={<div className=\"min-h-screen"), "Lazy POS and driver routes render safe loading fallbacks");

assertCheck(posScreens.includes("pos-entry-item-copy") && posScreens.includes("pos-entry-customize-badge"), "POS item cards expose dedicated copy and customize badge elements");
assertCheck(styles.includes(".pos-entry-item-copy") && styles.includes("pr-24") && styles.includes(".pos-entry-customize-badge"), "POS item CSS reserves badge space to prevent Customize overlap");
assertCheck(posScreens.includes("pos-entry-empty-cart") && styles.includes(".pos-entry-empty-cart") && styles.includes("min-h-[280px]"), "POS empty-cart state has dedicated spacing and centering");

if (failures.length) {
  console.error(`enterprise-pos-blocker-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("enterprise-pos-blocker-test passed.");

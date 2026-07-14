import fs from "node:fs";

const checks = [];

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function check(label, passed, detail = "") {
  checks.push({ label, passed, detail });
}

const app = read("apps/web/src/App.jsx");
const apiClient = read("apps/web/src/lib/api.js");
const authRoutes = read("apps/api/src/routes/auth.js");
const driverApi = read("apps/web/src/apps/driver/services/driverApi.js");
const serviceWorker = read("apps/web/public/sw.js");
const authMiddleware = read("apps/api/src/middleware/auth.js");
const tokenUtils = read("apps/api/src/utils/tokens.js");
const apiPackage = read("apps/api/package.json");
const verifyLoginScript = read("apps/api/prisma/auth-verify-login.js");
const repairUserScript = read("apps/api/prisma/auth-repair-user.js");
const diagnosticForm = app.slice(app.indexOf('<form className="mt-6 grid gap-4" onSubmit={submitDiagnostic}>'), app.indexOf("<InlineError message={error}", app.indexOf('<form className="mt-6 grid gap-4" onSubmit={submitDiagnostic}>')));
const diagnosticSubmit = app.slice(app.indexOf("async function submitDiagnostic"), app.indexOf("function PublicHome"));

check("Auth form submits through onSubmit", /<form className="panel grid gap-4" onSubmit=\{submitLogin\}>/.test(app));
check("Auth submit button is explicit", /type="submit" disabled=\{loading \|\| !apiOnline\}/.test(app));
check("Auth submit button has no onClick conflict", !/<button[^>]+type="submit"[^>]+onClick=/.test(app));
check("Login response is validated", /validateAuthPayload\(await api\("\/api\/auth\/login"/.test(app));
check("Login calls are unauthenticated", /skipAuth: true/.test(app) && /const token = options\.skipAuth \? ""/.test(apiClient));
check("Login does not retry stale refresh token", /authRetry: false/.test(app) && /clearOnUnauthorized: false/.test(app));
check("Login verifies session before redirect", /verifyLoginSession\(payload, requestId\)/.test(app) && /api\("\/api\/auth\/me", \{ token: payload\.accessToken/.test(app));
check("Redirect destination is centralized", /function getPostLoginDestination\(user\)/.test(app) && /window\.location\.replace\(getPostLoginDestination\(user\)\)/.test(app));
check("Driver login uses clean auth request", /skipAuth: true/.test(driverApi) && /authRetry: false/.test(driverApi));
check("Auth diagnostic route is gated", /VITE_AUTH_DIAGNOSTIC === "true"/.test(app) && /initialPath === "\/auth-diagnostic"/.test(app));
check("Auth diagnostic form submits once without click handler", diagnosticForm.includes("onSubmit={submitDiagnostic}") && diagnosticForm.includes('type="submit"') && !diagnosticForm.includes("onClick"));
check("Auth diagnostic sends one login request", (diagnosticSubmit.match(/apiRequestUrl\("\/api\/auth\/login"\)/g) || []).length === 1);
check("Auth diagnostic stages include auth me", /AUTH_ME_REQUEST_SENT/.test(app) && /AUTH_ME_RESPONSE_STATUS/.test(app));
check("Service worker keeps auth network-only", /driver-pwa-shell-v3/.test(serviceWorker) && /AUTH_NETWORK_ONLY_PATHS/.test(serviceWorker) && /\/auth-diagnostic/.test(serviceWorker));
check("Backend login endpoint exists", /router\.post\("\/login"/.test(authRoutes));
check("Backend verifies password with bcrypt", /bcrypt\.compare\(req\.body\.password, user\.passwordHash\)/.test(authRoutes));
check("Backend auth response includes access and refresh tokens", /accessToken: signAccessToken\(user\)/.test(authRoutes) && /refreshToken: signRefreshToken\(user\)/.test(authRoutes));
check("Backend me endpoint exists", /router\.get\("\/me", requireAuth/.test(authRoutes));
check("Backend auth me diagnostics are safe", /auth\.me\.token_present/.test(authMiddleware) && /auth\.me\.token_valid/.test(authMiddleware) && /auth\.me\.user_found/.test(authMiddleware) && /auth\.me\.success/.test(authMiddleware));
check("Backend auth secrets validate at startup", /export function validateAuthSecrets/.test(tokenUtils) && /validateAuthSecrets\(\)/.test(read("apps/api/src/server.js")));
check("Auth verify login script is read-only", /AUTH_VERIFY_EMAIL/.test(verifyLoginScript) && /passwordMatch/.test(verifyLoginScript) && !/signAccessToken|signRefreshToken/.test(verifyLoginScript));
check("Auth repair user script is confirmation gated", /AUTH_REPAIR_CONFIRM/.test(repairUserScript) && /AUTH_REPAIR_ALLOW_CREATE/.test(repairUserScript) && /sessionVersion: \{ increment: 1 \}/.test(repairUserScript));
check("Auth CLI scripts are exposed", /auth:verify-login/.test(apiPackage) && /auth:repair-user/.test(apiPackage));

const failed = checks.filter((item) => !item.passed);
for (const item of checks) {
  console.log(`${item.passed ? "PASS" : "FAIL"} ${item.label}${item.detail ? ` - ${item.detail}` : ""}`);
}

if (failed.length > 0) {
  console.error(`Auth contract failed: ${failed.length}/${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`Auth contract passed: ${checks.length}/${checks.length} checks passed.`);

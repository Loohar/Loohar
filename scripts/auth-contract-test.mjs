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

check("Auth form submits through onSubmit", /<form className="panel grid gap-4" onSubmit=\{submitLogin\}>/.test(app));
check("Auth submit button is explicit", /type="submit" disabled=\{loading \|\| !apiOnline\}/.test(app));
check("Login response is validated", /validateAuthPayload\(await api\("\/api\/auth\/login"/.test(app));
check("Login calls are unauthenticated", /skipAuth: true/.test(app) && /const token = options\.skipAuth \? ""/.test(apiClient));
check("Login does not retry stale refresh token", /authRetry: false/.test(app) && /clearOnUnauthorized: false/.test(app));
check("Login verifies session before redirect", /verifyLoginSession\(payload, requestId\)/.test(app) && /api\("\/api\/auth\/me", \{ token: payload\.accessToken/.test(app));
check("Redirect destination is centralized", /function getPostLoginDestination\(user\)/.test(app) && /window\.location\.replace\(getPostLoginDestination\(user\)\)/.test(app));
check("Driver login uses clean auth request", /skipAuth: true/.test(driverApi) && /authRetry: false/.test(driverApi));
check("Backend login endpoint exists", /router\.post\("\/login"/.test(authRoutes));
check("Backend verifies password with bcrypt", /bcrypt\.compare\(req\.body\.password, user\.passwordHash\)/.test(authRoutes));
check("Backend auth response includes access and refresh tokens", /accessToken: signAccessToken\(user\)/.test(authRoutes) && /refreshToken: signRefreshToken\(user\)/.test(authRoutes));
check("Backend me endpoint exists", /router\.get\("\/me", requireAuth/.test(authRoutes));

const failed = checks.filter((item) => !item.passed);
for (const item of checks) {
  console.log(`${item.passed ? "PASS" : "FAIL"} ${item.label}${item.detail ? ` - ${item.detail}` : ""}`);
}

if (failed.length > 0) {
  console.error(`Auth contract failed: ${failed.length}/${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`Auth contract passed: ${checks.length}/${checks.length} checks passed.`);

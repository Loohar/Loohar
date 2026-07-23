import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const auth = readFileSync(join(root, "apps/api/src/routes/auth.js"), "utf8");
const bootstrap = readFileSync(join(root, "apps/api/prisma/bootstrap-dev-owner.js"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
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

const bootstrapMain = sliceBetween(bootstrap, "async function main()", "\nmain()");
const authResponseBlock = sliceBetween(auth, "async function authResponse(user)", "\nconst credentialsSchema");
const demoLoginEmailForRequest = sliceBetween(auth, "function demoLoginEmailForRequest(", "\nfunction userEmailWhere");
const demoLoginRoute = sliceBetween(auth, 'router.post("/demo-login"', '\nrouter.post("/change-password"');
const normalizeSessionUser = sliceBetween(app, "function normalizeSessionUser(", "\nfunction safeReturnTo");
const handleAuthenticatedBlock = sliceBetween(app, "function handleAuthenticated(payload)", "\n  async function submitLogin");
const bootstrapOutput = sliceBetween(bootstrap, "console.log(JSON.stringify({", "\n  }, null, 2));");

assertCheck(packageJson.scripts?.["test:restaurant-owner-login"] === "node scripts/restaurant-owner-login-test.mjs", "Restaurant owner login test script is registered");
assertCheck(bootstrap.includes('process.env.ENABLE_DEV_OWNER_FIXTURE !== "true"'), "Development owner fixture requires explicit env opt-in");
assertCheck(bootstrap.includes('throw new Error("Refusing to create a development owner fixture in production.")'), "Development owner fixture refuses production runtime");
assertCheck(bootstrap.includes('process.env.DEV_OWNER_EMAIL || "development@loohar.com"'), "Development owner fixture targets the requested email only by default");
assertCheck(bootstrap.includes('requiredEnv("DEV_OWNER_TEMP_PASSWORD")'), "Temporary password comes from env only");
assertCheck(!bootstrap.includes("Welcome12!") && !bootstrap.includes("YourStrongTempPasswordHere"), "No plaintext development password is committed in the fixture script");
assertCheck(bootstrapMain.includes('role: "TENANT_OWNER"') && !bootstrapMain.includes('role: "SUPER_ADMIN"'), "Fixture creates and repairs the owner as TENANT_OWNER only");
assertCheck(bootstrapMain.includes("forcePasswordChange: true") && bootstrapMain.includes("temporaryPassword: true"), "Fixture forces first-login password change without exposing the password");
assertCheck(bootstrapOutput.includes("maskEmail(user.email)") && !bootstrapOutput.includes("password:"), "Fixture output masks email and does not print password");
assertCheck(authResponseBlock.includes("membershipsForUser(user)") && authResponseBlock.includes("memberships,"), "Login response includes verified memberships");
assertCheck(normalizeSessionUser.includes("memberships") && normalizeSessionUser.includes("membership?.tenantSlug"), "Frontend stores backend memberships in the normalized session user");
assertCheck(app.includes("dashboardPathFor(user)") && app.includes("primaryRestaurantSlugFor(user)"), "Post-login redirect uses normalized backend user and membership slug");
assertCheck(app.includes('restaurant: "TENANT_OWNER"') && app.includes("mode !== \"platform\""), "Seeded restaurant login requests a tenant owner and is hidden from the generic platform login");
assertCheck(auth.includes('process.env.ENABLE_DEV_OWNER_FIXTURE === "true"') && auth.includes('process.env.DEV_OWNER_EMAIL || "development@loohar.com"'), "Backend demo login can prefer the opt-in development owner fixture");
assertCheck(
  demoLoginEmailForRequest.includes('fixtureRoles.includes(role)') && demoLoginEmailForRequest.includes("return null;")
    && demoLoginRoute.includes("demoLoginEmailForRequest(req.body)"),
  "Opt-in development owner fixture bypasses the older seeded owner email during demo login"
);
assertCheck(
  handleAuthenticatedBlock.indexOf("setSession(sessionPayload)") > -1
    && handleAuthenticatedBlock.indexOf("setSession(sessionPayload)") < handleAuthenticatedBlock.indexOf("if (requiresPasswordChange(normalizedUser))")
    && handleAuthenticatedBlock.indexOf("onLogin(sessionPayload)") > handleAuthenticatedBlock.indexOf("if (normalizedUser?.mfaEnabled)"),
  "Temporary-password seeded owner sessions stay local until reset gates finish"
);

if (failures.length) {
  console.error(`restaurant-owner-login-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("restaurant-owner-login-test passed.");

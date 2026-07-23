import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
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

const dashboardPath = sliceBetween(app, "function dashboardPathFor(", "\nfunction restaurantOnboardingComplete");
const tenantGuard = sliceBetween(app, "function canAccessTenantRoute(", "\nfunction normalizeRole");
const restaurantRoute = sliceBetween(app, "if (isRestaurantRoute || isSiteAdminRoute)", "\n  if (isSiteRoute)");
const kitchenRoute = sliceBetween(app, "if (isKitchenRoute)", "\n  if (isAdminRoute)");

assertCheck(packageJson.scripts?.["test:role-redirects"] === "node scripts/role-redirects-test.mjs", "Role redirect test script is registered");
assertCheck(app.includes('const adminRoles = ["SUPER_ADMIN"]'), "Only SUPER_ADMIN is treated as a platform admin role");
assertCheck(app.includes('"TENANT_OWNER"') && app.includes('"RESTAURANT_ADMIN"') && app.includes('"RESTAURANT_MANAGER"'), "Restaurant roles include tenant owner, admin, and manager roles");
assertCheck(!app.includes('restaurantRoles.concat(["SUPER_ADMIN"])') && !app.includes("restaurantRoles.includes(\"SUPER_ADMIN\")"), "SUPER_ADMIN is not folded into restaurant role checks");
assertCheck(dashboardPath.includes('SUPER_ADMIN: "/admin"'), "Super Admin still lands on /admin");
assertCheck(dashboardPath.includes('TENANT_OWNER: needsOnboarding ? onboardingPath : restaurantPath'), "Tenant owner redirects to the restaurant dashboard or onboarding");
assertCheck(dashboardPath.includes('`/restaurant/${slug}/dashboard`'), "Restaurant dashboard redirect includes the tenant slug");
assertCheck(tenantGuard.includes('normalizeRole(user.role) === "SUPER_ADMIN") return false'), "Tenant route guard rejects Super Admin as a tenant user");
assertCheck(tenantGuard.includes("restaurantMembershipSlugs(user)") && tenantGuard.includes("allowedSlugs.includes(slug)"), "Tenant route guard validates membership slugs");
assertCheck(restaurantRoute.includes("allowedRestaurantRouteRoles") && restaurantRoute.includes("canAccessTenantRoute(user, initialPath, \"restaurant\")"), "Restaurant routes require role and tenant access");
assertCheck(kitchenRoute.includes("kitchenRoles") && kitchenRoute.includes("canAccessTenantRoute(user, initialPath, \"kitchen\")"), "Kitchen routes require kitchen-capable tenant access");

if (failures.length) {
  console.error(`role-redirects-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("role-redirects-test passed.");

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

const appHeader = sliceBetween(app, "function AppHeader(", "\nfunction LoginStrip");
const platformNavigation = sliceBetween(app, "function platformNavigation(", "\nfunction restaurantOperationsNavigation");
const restaurantOperationsNavigation = sliceBetween(app, "function restaurantOperationsNavigation(", "\nfunction kitchenNavigation");
const adminRoute = sliceBetween(app, "if (isAdminRoute)", "\n  if (isRestaurantRoute || isSiteAdminRoute)");
const restaurantRoute = sliceBetween(app, "if (isRestaurantRoute || isSiteAdminRoute)", "\n  if (isSiteRoute)");
const adminApp = sliceBetween(app, "function AdminApp(", "\nfunction RestaurantApp");
const tenantSiteHeader = sliceBetween(app, '<header className="site-header premium">', "\n      </header>");

assertCheck(packageJson.scripts?.["test:admin-ui"] === "node scripts/admin-ui-test.mjs", "Admin UI test script is registered");
assertCheck(appHeader.includes('<LooharPlatformBrand size="default" />') && appHeader.includes('<LooharPlatformBrand size="compact" />'), "Authenticated app shell uses the standardized Loohar platform brand");
assertCheck(!appHeader.includes("BrandMark") && !appHeader.includes("app-brand-icon") && !appHeader.includes("loohar-brand"), "Authenticated app shell has no legacy platform logo markup");
assertCheck(adminRoute.includes("platformNavigation(initialPath, user?.role === \"SUPER_ADMIN\")") && adminRoute.includes("<AdminApp"), "Super Admin route renders through the shared platform shell");
assertCheck(platformNavigation.includes("platformNavItems.map") && platformNavigation.includes('href: "/admin/business/new"') && platformNavigation.includes('label: "Add Business"'), "Super Admin navigation keeps role-specific Add Business action");
assertCheck(restaurantRoute.includes("restaurantOperationsNavigation(user, restaurantSlug, initialPath)") && restaurantOperationsNavigation.includes('label: "Kitchen"'), "Restaurant operations navigation remains separate and keeps Kitchen in restaurant context");
assertCheck(adminApp.includes("View Website") && adminApp.includes("Open Restaurant Admin") && adminApp.includes("Manage Domain") && adminApp.includes("Audit History"), "Super Admin business actions remain available");
assertCheck(adminApp.includes("logoUrl") && adminApp.includes("Restaurant logo URL") && !adminApp.includes("LooharPlatformBrand"), "Admin tenant website settings still edit tenant logo data, not the platform logo");
assertCheck(tenantSiteHeader.includes("logoImage") && tenantSiteHeader.includes("restaurant.name") && !tenantSiteHeader.includes("LooharPlatformBrand"), "Public restaurant site header keeps restaurant-uploaded logo data");

if (failures.length) {
  console.error(`admin-ui-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("admin-ui-test passed.");

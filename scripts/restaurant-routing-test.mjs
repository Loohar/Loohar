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

const pageDefinitions = sliceBetween(app, "const restaurantPageDefinitions", "\nconst restaurantPageOrder");
const pageHelpers = sliceBetween(app, "function restaurantPageFromPath(", "\nfunction restaurantOperationsNavigation");
const restaurantApp = sliceBetween(app, "function RestaurantApp(", "\nfunction KitchenApp");
const routeBlock = sliceBetween(app, "if (isRestaurantRoute || isSiteAdminRoute)", "\n  if (isSiteRoute)");

const requiredPages = ["dashboard", "pos", "orders", "kitchen", "customers", "drivers", "reports", "settings"];

assertCheck(packageJson.scripts?.["test:restaurant-routing"] === "node scripts/restaurant-routing-test.mjs", "Restaurant routing test script is registered");
for (const page of requiredPages) {
  assertCheck(pageDefinitions.includes(`${page}: {`), `${page} is defined as a restaurant page`);
}
assertCheck(app.includes('const restaurantPageOrder = ["dashboard", "pos", "orders", "kitchen", "customers", "drivers", "reports", "settings"]'), "Restaurant sidebar order uses the required dedicated routes");
assertCheck(app.includes("function restaurantPagePath") && app.includes('const base = slug ? `/restaurant/${slug}` : "/restaurant"') && app.includes("return `${base}/${page}`"), "Restaurant route helper builds /restaurant/:slug/:page paths");
assertCheck(app.includes("function legacyRestaurantRedirectPath") && app.includes("return restaurantPagePath(slug, page)"), "Malformed legacy routes redirect to tenant-scoped paths");
assertCheck(app.includes('if (prefix === "restaurant" && isRestaurantPageSegment(parts[1])) return "";'), "Route slug parser does not treat page names as tenant slugs");
assertCheck(routeBlock.includes("legacyRestaurantRedirect") && routeBlock.includes("<Redirecting to={legacyRestaurantRedirect} />"), "Restaurant route block applies legacy redirects");
assertCheck(restaurantApp.includes("const RestaurantPageComponent = restaurantPageComponents[currentRestaurantPage]") && restaurantApp.includes("<RestaurantPageComponent>"), "RestaurantApp wraps content in the dedicated page component");
assertCheck(app.includes("function RestaurantDashboardPage") && app.includes("function RestaurantPosPage") && app.includes("function RestaurantOrdersPage") && app.includes("function RestaurantSettingsPage"), "Dedicated restaurant page components exist");
for (const malformed of ["/restaurant/orders/orders", "/restaurant/orders/customers", "/restaurant/orders/drivers", "/restaurant/orders/reports", "/restaurant/orders/settings"]) {
  assertCheck(!app.includes(malformed), `Malformed route ${malformed} is not hard-coded`);
}

if (failures.length) {
  console.error(`restaurant-routing-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("restaurant-routing-test passed.");

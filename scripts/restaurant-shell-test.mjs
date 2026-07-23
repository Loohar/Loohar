import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");
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

const shell = sliceBetween(app, "function RestaurantAppShell(", "\nfunction LoginStrip");
const kitchenRoute = sliceBetween(app, "if (isKitchenRoute)", "\n  if (isAdminRoute)");
const restaurantRoute = sliceBetween(app, "if (isRestaurantRoute || isSiteAdminRoute)", "\n  if (isSiteRoute)");
const dashboardPath = sliceBetween(app, "function dashboardPathFor(", "\nfunction restaurantOnboardingComplete");

assertCheck(packageJson.scripts?.["test:restaurant-shell"] === "node scripts/restaurant-shell-test.mjs", "Restaurant shell test script is registered");
assertCheck(shell.includes("<aside") && shell.includes("<header") && shell.includes("<main"), "RestaurantAppShell renders semantic aside, header, and main regions");
assertCheck(shell.includes("restaurant-shell-topbar") && !shell.includes("app-nav"), "RestaurantAppShell has a compact header without the shared top-row app nav");
assertCheck(shell.includes("restaurant-shell-page-head") && shell.includes("pageInfo.description"), "RestaurantAppShell renders page title, breadcrumb, and description");
assertCheck(kitchenRoute.includes("<RestaurantAppShell") && kitchenRoute.includes("<KitchenApp"), "Legacy kitchen route renders through RestaurantAppShell");
assertCheck(restaurantRoute.includes("<RestaurantAppShell") && restaurantRoute.includes("<RestaurantApp"), "Restaurant routes render through RestaurantAppShell");
assertCheck(restaurantRoute.includes("activePage={restaurantPage}") && kitchenRoute.includes('activePage="kitchen"'), "Restaurant and kitchen routes pass route-aware active page state");
assertCheck(app.includes('restaurantPagePath(slug, page)') && app.includes('function restaurantPageFromPath'), "Dedicated restaurant page route helpers exist");
assertCheck(dashboardPath.includes('`/restaurant/${slug}/dashboard`'), "Restaurant users land on the dedicated dashboard route after login");
assertCheck(styles.includes("grid-template-columns: 280px minmax(0, 1fr)") && styles.includes(".restaurant-shell-sidebar"), "Desktop shell uses a fixed sidebar plus fluid content grid");
assertCheck(!app.includes("function kitchenNavigation"), "Kitchen-specific navbar helper has been removed");

if (failures.length) {
  console.error(`restaurant-shell-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("restaurant-shell-test passed.");

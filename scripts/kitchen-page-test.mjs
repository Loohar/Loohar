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

const kitchenRoute = sliceBetween(app, "if (isKitchenRoute)", "\n  if (isAdminRoute)");
const restaurantRoute = sliceBetween(app, "if (isRestaurantRoute || isSiteAdminRoute)", "\n  if (isSiteRoute)");

assertCheck(packageJson.scripts?.["test:kitchen-page"] === "node scripts/kitchen-page-test.mjs", "Kitchen page test script is registered");
assertCheck(app.includes('kitchen: {') && app.includes('title: "Kitchen"'), "Kitchen page is in the restaurant route inventory");
assertCheck(app.includes('path === "/kitchen" || path.startsWith("/kitchen/")'), "Legacy /kitchen route maps to the kitchen page");
assertCheck(kitchenRoute.includes("<RestaurantAppShell") && kitchenRoute.includes('activePage="kitchen"'), "Standalone kitchen route uses the shared restaurant shell");
assertCheck(restaurantRoute.includes('restaurantPage === "kitchen"') && restaurantRoute.includes("<KitchenApp"), "Restaurant kitchen page renders KitchenApp content");
assertCheck(app.includes('id="kitchen"') && app.includes('id="kitchen-summary"'), "Kitchen workspace keeps the KDS panel anchors");
assertCheck(app.includes("Print Kitchen Ticket") && app.includes("kdsStatusFor"), "Kitchen page keeps ticket printing and KDS status logic");
assertCheck(!app.includes("function kitchenNavigation"), "Kitchen no longer owns a page-specific navbar helper");

if (failures.length) {
  console.error(`kitchen-page-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("kitchen-page-test passed.");

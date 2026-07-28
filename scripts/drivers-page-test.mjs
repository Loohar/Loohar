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

function assertPanelGuard(panelMarkup, guardName, message) {
  const guardIndex = app.indexOf(`{${guardName} ? (`);
  const panelIndex = app.indexOf(panelMarkup, guardIndex);
  const closingIndex = app.indexOf(") : null}", panelIndex);
  assertCheck(guardIndex !== -1 && panelIndex !== -1 && closingIndex !== -1, message);
}

assertCheck(packageJson.scripts?.["test:drivers-page"] === "node scripts/drivers-page-test.mjs", "Drivers page test script is registered");
assertCheck(app.includes('drivers: {') && app.includes('title: "Drivers"'), "Drivers page is in the restaurant route inventory");
assertCheck(app.includes('href: `${restaurantBasePath}/drivers?filter=available`'), "Dashboard available-driver shortcut points to the Drivers page");
assertCheck(app.includes('id="drivers"') && app.includes("Driver Dispatch Center"), "Drivers workspace keeps the dispatch center");
assertCheck(app.includes('hasLock("DRIVER_MANAGEMENT")') && app.includes("<UpgradeRequired feature=\"DRIVER_MANAGEMENT\""), "Drivers page preserves driver-management entitlement lock");
assertCheck(app.includes("availableDrivers") && app.includes("busyDrivers") && app.includes("offlineDrivers"), "Drivers page keeps availability buckets");
assertCheck(app.includes("assignDispatchDelivery") && app.includes("cancelDispatchAssignment"), "Drivers page keeps assignment and cancellation actions");
assertCheck(app.includes('const isDriversPage = currentRestaurantPage === "drivers";'), "Drivers route has an explicit render guard");
assertPanelGuard('<div className="panel" id="drivers">', "isDriversPage", "Drivers route mounts dispatch only behind the Drivers guard");
assertCheck(!app.includes(".restaurant-dashboard-drivers :is"), "Drivers route does not rely on CSS-hidden unrelated panels");

if (failures.length) {
  console.error(`drivers-page-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("drivers-page-test passed.");

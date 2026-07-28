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

assertCheck(packageJson.scripts?.["test:customers-page"] === "node scripts/customers-page-test.mjs", "Customers page test script is registered");
assertCheck(app.includes('customers: {') && app.includes('title: "Customers"'), "Customers page is in the restaurant route inventory");
assertCheck(app.includes('href: `${restaurantBasePath}/customers`'), "Dashboard customer shortcut points to the Customers page");
assertCheck(app.includes('id="customers-summary"') && app.includes('id={isCustomersPage ? "customers" : undefined}') && app.includes('id="customers-crm"'), "Customers workspace keeps summary and CRM anchors");
assertCheck(app.includes('hasLock("CUSTOMER_CRM")') && app.includes("<UpgradeRequired feature=\"CUSTOMER_CRM\""), "Customers page preserves CRM entitlement lock");
assertCheck(app.includes("loyaltyPointBalance") && app.includes("lifetimeSpendCents"), "Customers page keeps loyalty and lifetime-spend context");
assertCheck(app.includes('const isCustomersPage = currentRestaurantPage === "customers";'), "Customers route has an explicit render guard");
assertPanelGuard('<div className="grid gap-4 md:grid-cols-4" id="customers-summary">', "isCustomersPage", "Customers summary mounts only behind the Customers guard");
assertPanelGuard('<div className="panel" id="customers-crm">', "isCustomersPage", "Customer CRM mounts only behind the Customers guard");
assertCheck(app.includes('id={isCustomersPage ? "customers" : undefined}'), "Customers wrapper only receives the Customers anchor on the Customers route");
assertCheck(!app.includes(".restaurant-dashboard-customers :is"), "Customers route does not rely on CSS-hidden unrelated panels");

if (failures.length) {
  console.error(`customers-page-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("customers-page-test passed.");

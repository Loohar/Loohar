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

assertCheck(packageJson.scripts?.["test:customers-page"] === "node scripts/customers-page-test.mjs", "Customers page test script is registered");
assertCheck(app.includes('customers: {') && app.includes('title: "Customers"'), "Customers page is in the restaurant route inventory");
assertCheck(app.includes('href: `${restaurantBasePath}/customers`'), "Dashboard customer shortcut points to the Customers page");
assertCheck(app.includes('id="customers-summary"') && app.includes('id="customers"') && app.includes('id="customers-crm"'), "Customers workspace keeps summary and CRM anchors");
assertCheck(app.includes('hasLock("CUSTOMER_CRM")') && app.includes("<UpgradeRequired feature=\"CUSTOMER_CRM\""), "Customers page preserves CRM entitlement lock");
assertCheck(app.includes("loyaltyPointBalance") && app.includes("lifetimeSpendCents"), "Customers page keeps loyalty and lifetime-spend context");
assertCheck(styles.includes(".restaurant-dashboard-customers") && styles.includes("#customers-summary"), "Customers route shows customer panels and hides unrelated panels");

if (failures.length) {
  console.error(`customers-page-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("customers-page-test passed.");

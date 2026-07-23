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

assertCheck(packageJson.scripts?.["test:orders-page"] === "node scripts/orders-page-test.mjs", "Orders page test script is registered");
assertCheck(app.includes('orders: {') && app.includes('title: "Orders"'), "Orders page is in the restaurant route inventory");
assertCheck(app.includes('href: `${restaurantBasePath}/orders?status=pending`'), "Dashboard pending-orders shortcut points to the Orders page");
assertCheck(app.includes('id="orders"') && app.includes("Live orders"), "Orders workspace keeps the live orders panel");
assertCheck(app.includes("Print Receipt") && app.includes("Kitchen Ticket") && app.includes("Driver Slip"), "Orders page keeps receipt, kitchen-ticket, and driver-slip actions");
assertCheck(app.includes("assignDriver(order)") && app.includes("updateOrderStatus(order, status)"), "Orders page keeps assignment and status-update workflows");
assertCheck(styles.includes(".restaurant-dashboard-orders") && styles.includes("#orders"), "Orders route shows the orders workspace and hides unrelated panels");

if (failures.length) {
  console.error(`orders-page-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("orders-page-test passed.");

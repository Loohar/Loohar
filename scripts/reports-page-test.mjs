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

assertCheck(packageJson.scripts?.["test:reports-page"] === "node scripts/reports-page-test.mjs", "Reports page test script is registered");
assertCheck(app.includes('reports: {') && app.includes('title: "Reports"'), "Reports page is in the restaurant route inventory");
assertCheck(app.includes('href: `${restaurantBasePath}/reports?range=today`'), "Dashboard sales shortcut points to the Reports page");
assertCheck(app.includes('id="reports"') && app.includes("Advanced reporting"), "Reports workspace keeps the reporting panel");
assertCheck(app.includes('id="reports-analytics-summary"') && app.includes('id="reports-menu-insights"'), "Reports route keeps analytics and menu insight panels");
assertCheck(app.includes('hasLock("REPORTS")') && app.includes("<UpgradeRequired feature=\"REPORTS\""), "Reports page preserves reports entitlement lock");
assertCheck(app.includes("Daily sales") && app.includes("Top selling items") && app.includes("Driver metrics"), "Reports page keeps sales, menu, customer, and driver metrics");
assertCheck(styles.includes(".restaurant-dashboard-reports") && styles.includes("#reports"), "Reports route shows reporting panels and hides unrelated panels");

if (failures.length) {
  console.error(`reports-page-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("reports-page-test passed.");

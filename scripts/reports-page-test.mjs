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

assertCheck(packageJson.scripts?.["test:reports-page"] === "node scripts/reports-page-test.mjs", "Reports page test script is registered");
assertCheck(app.includes('reports: {') && app.includes('title: "Reports"'), "Reports page is in the restaurant route inventory");
assertCheck(app.includes('href: `${restaurantBasePath}/reports?range=today`'), "Dashboard sales shortcut points to the Reports page");
assertCheck(app.includes('id="reports"') && app.includes("Advanced reporting"), "Reports workspace keeps the reporting panel");
assertCheck(app.includes('id="reports-analytics-summary"') && app.includes('id="reports-menu-insights"'), "Reports route keeps analytics and menu insight panels");
assertCheck(app.includes('hasLock("REPORTS")') && app.includes("<UpgradeRequired feature=\"REPORTS\""), "Reports page preserves reports entitlement lock");
assertCheck(app.includes("Daily sales") && app.includes("Top selling items") && app.includes("Driver metrics"), "Reports page keeps sales, menu, customer, and driver metrics");
assertCheck(app.includes('const isReportsPage = currentRestaurantPage === "reports";'), "Reports route has an explicit render guard");
assertPanelGuard('<div className="panel" id="reports-analytics-summary">', "isReportsPage", "Reports analytics summary mounts only behind the Reports guard");
assertPanelGuard('<div className="panel" id="reports-menu-insights">', "isReportsPage", "Reports menu insights mount only behind the Reports guard");
assertPanelGuard('<div className="panel" id="reports">', "isReportsPage", "Advanced reports panel mounts only behind the Reports guard");
assertCheck(!app.includes(".restaurant-dashboard-reports :is"), "Reports route does not rely on CSS-hidden unrelated panels");

if (failures.length) {
  console.error(`reports-page-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("reports-page-test passed.");

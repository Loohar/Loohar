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

assertCheck(packageJson.scripts?.["test:restaurant-sidebar"] === "node scripts/restaurant-sidebar-test.mjs", "Restaurant sidebar test script is registered");
assertCheck(shell.includes('aria-label="Restaurant operations navigation"'), "Sidebar navigation has an accessible label");
assertCheck(shell.includes('aria-current={active ? "page" : undefined}'), "Sidebar navigation exposes active route state");
assertCheck(shell.includes("renderSidebarNav()") && shell.includes("renderSidebarNav(closeDrawer)"), "Sidebar and mobile drawer use the same nav renderer");
assertCheck(shell.includes("Public site") && shell.includes("Support") && shell.includes("Logout"), "Sidebar footer keeps public-site, support, and logout actions");
assertCheck(shell.includes("StatusPill") && shell.includes("authChecking"), "Topbar keeps API/session status without full nav buttons");
assertCheck(styles.includes(".restaurant-shell-nav-item.active") && styles.includes("bg-ink text-white"), "Sidebar active state is visibly distinct");
assertCheck(styles.includes("min-h-11") && styles.includes("focus:ring-2"), "Sidebar controls keep touch-friendly size and focus styling");
assertCheck(styles.includes(".restaurant-shell-sidebar-footer") && styles.includes("mt-auto"), "Sidebar footer is anchored at the bottom");
assertCheck(styles.includes("@media (max-width: 767px)") && styles.includes(".restaurant-shell-page-head h1"), "Restaurant shell has mobile refinements");

if (failures.length) {
  console.error(`restaurant-sidebar-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("restaurant-sidebar-test passed.");

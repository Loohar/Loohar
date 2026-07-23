import { readFileSync } from "node:fs";

const source = readFileSync("apps/web/src/App.jsx", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sliceBetween(content, startNeedle, endNeedle) {
  const start = content.indexOf(startNeedle);
  const end = content.indexOf(endNeedle, start + startNeedle.length);
  if (start === -1 || end === -1) return "";
  return content.slice(start, end);
}

const pageDefinitions = sliceBetween(source, "const restaurantPageDefinitions", "\nfunction restaurantPageFromPath");
const navMatch = source.match(/function restaurantOperationsNavigation[\s\S]*?function dashboardPathFor/);
assert(navMatch, "restaurantOperationsNavigation function was not found.");

const navSource = navMatch[0];
const requiredLabels = ["Dashboard", "Orders", "Kitchen", "Customers", "Drivers", "Reports", "Settings"];

for (const label of requiredLabels) {
  assert(pageDefinitions.includes(`label: "${label}"`), `Restaurant owner route inventory is missing ${label}.`);
}

assert(pageDefinitions.includes('const restaurantPageOrder = ["dashboard", "orders", "kitchen", "customers", "drivers", "reports", "settings"]'), "Restaurant page order must define the dedicated app pages.");
assert(!pageDefinitions.includes('label: "Menu"'), "Restaurant owner shell must not expose Menu as a top-level route.");
assert(!pageDefinitions.includes('label: "Website"'), "Restaurant owner shell must not expose Website as a top-level route.");
assert(!navSource.includes("icon: MenuIcon"), "Restaurant owner desktop nav must not use the hamburger/MenuIcon as a nav item.");
assert(navSource.includes("restaurantPagePath(slug, page)"), "Restaurant nav must use dedicated route paths.");
assert(navSource.includes("currentPage === page"), "Restaurant nav must set route-aware active state.");
assert(navSource.includes('page !== "kitchen" || canUseKitchen'), "Kitchen link must remain role-aware.");
assert(!navSource.includes("#orders") && !navSource.includes("#drivers") && !navSource.includes("#settings"), "Primary restaurant nav must not use legacy hash links.");
for (const hash of ["#orders", "#customers", "#drivers", "#reports", "#kitchen", "#settings", "#settings-menu-catalog", "#settings-website-branding", "#settings-domains-seo"]) {
  assert(source.includes(`"${hash}"`), `Legacy route hash ${hash} must remain mapped safely.`);
}

console.log("Restaurant owner navbar contract passed.");

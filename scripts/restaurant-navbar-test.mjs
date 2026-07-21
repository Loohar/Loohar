import { readFileSync } from "node:fs";

const source = readFileSync("apps/web/src/App.jsx", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const navMatch = source.match(/function restaurantOperationsNavigation[\s\S]*?function kitchenNavigation/);
assert(navMatch, "restaurantOperationsNavigation function was not found.");

const navSource = navMatch[0];
const requiredLabels = ["Dashboard", "Orders", "Kitchen", "Customers", "Drivers", "Reports", "Settings"];

for (const label of requiredLabels) {
  assert(navSource.includes(`label: "${label}"`), `Restaurant owner nav is missing ${label}.`);
}

assert(!navSource.includes('label: "Menu"'), "Restaurant owner desktop nav must not expose Menu as a top-level item.");
assert(!navSource.includes('label: "Website"'), "Restaurant owner desktop nav must not expose Website as a top-level item.");
assert(!navSource.includes("icon: MenuIcon"), "Restaurant owner desktop nav must not use the hamburger/MenuIcon as a nav item.");
assert(navSource.includes('href: `${base}#orders`'), "Orders nav must target the live orders section.");
assert(navSource.includes('href: `${base}#drivers`'), "Drivers nav must target the dispatch center.");
assert(navSource.includes('href: `${base}#settings`'), "Settings nav must target the settings center.");

console.log("Restaurant owner navbar contract passed.");

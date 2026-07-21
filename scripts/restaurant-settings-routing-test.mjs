import { readFileSync } from "node:fs";

const source = readFileSync("apps/web/src/App.jsx", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const requiredDestinations = [
  "settings-profile",
  "settings-website-branding",
  "settings-menu-catalog",
  "settings-gallery-social",
  "settings-ordering",
  "settings-delivery",
  "settings-domains-seo",
  "settings-payments",
  "settings-staff-access",
  "settings-notifications",
  "settings-billing",
  "settings-security",
  "settings-advanced"
];

for (const destination of requiredDestinations) {
  assert(source.includes(`href: "#${destination}"`) || source.includes(`id="${destination}"`), `Settings destination ${destination} is not wired.`);
  assert(source.includes(`id="${destination}"`), `Settings anchor id ${destination} is missing from the dashboard.`);
}

assert(source.includes('id="orders"'), "Live orders section must keep the Orders nav anchor.");
assert(source.includes('id="drivers"'), "Driver dispatch center must keep the Drivers nav anchor.");
assert(source.includes("Settings center"), "Settings center panel is missing.");
assert(source.includes("Configuration and editing tools live here"), "Settings center needs context for restaurant owners.");

console.log("Restaurant settings routing contract passed.");

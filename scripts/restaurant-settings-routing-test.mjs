import { readFileSync } from "node:fs";

const source = readFileSync("apps/web/src/App.jsx", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPanelGuard(panelMarkup, guardExpression, message) {
  const guardIndex = source.indexOf(`{${guardExpression} ? (`);
  const panelIndex = source.indexOf(panelMarkup, guardIndex);
  const closingIndex = source.indexOf(") : null}", panelIndex);
  assert(guardIndex !== -1 && panelIndex !== -1 && closingIndex !== -1, message);
}

function sliceBetween(content, startNeedle, endNeedle) {
  const start = content.indexOf(startNeedle);
  const end = content.indexOf(endNeedle, start + startNeedle.length);
  if (start === -1 || end === -1) return "";
  return content.slice(start, end);
}

const requiredDestinations = [
  "settings-account",
  "settings-restaurant-profile",
  "settings-business-hours",
  "settings-website-branding",
  "settings-menu-catalog",
  "settings-gallery-social",
  "settings-ordering",
  "settings-delivery-zones",
  "settings-domains-seo",
  "settings-payments",
  "settings-receipts-printing",
  "settings-staff-roles",
  "settings-notifications",
  "settings-billing-subscription",
  "settings-security-audit",
  "settings-pos-kiosk",
  "settings-integrations",
  "settings-developer-api"
];

for (const destination of requiredDestinations) {
  assert(source.includes(`href: "#${destination}"`) || source.includes(`id="${destination}"`), `Settings destination ${destination} is not wired.`);
  assert(source.includes(`id="${destination}"`), `Settings anchor id ${destination} is missing from the dashboard.`);
}

assert(source.includes('const isSettingsPage = currentRestaurantPage === "settings";'), "Settings route has an explicit render guard.");
assert(source.includes('const isSettingsCenterPage = isSettingsPage && !selectedSettingsSectionId;'), "Root settings page needs its own Settings Center guard.");
assert(source.includes('const showSettingsSection = (sectionId) => isSettingsPage && selectedSettingsSectionId === normalizeRestaurantSettingsSectionId(sectionId);'), "Settings sections need explicit section-level routing.");
assert(source.includes('return "";'), "Root settings route must not default to an editor section.");
assertPanelGuard('<div className="grid gap-5 xl:grid-cols-2" id="settings">', "isSettingsPage", "Settings route wrapper mounts only behind the Settings route guard.");
assertPanelGuard('<div className="panel xl:col-span-2">', "isSettingsCenterPage", "Root settings mounts only the Settings center.");
assertPanelGuard('<div className="panel" id="settings-menu-catalog">', 'showSettingsSection("menu-catalog")', "Menu catalog settings mount only behind the menu-catalog section guard.");
assertPanelGuard('<div className="panel" id="settings-delivery-zones">', 'showSettingsSection("delivery-zones")', "Delivery zone settings mount only behind the delivery-zones section guard.");
assertPanelGuard('<div className="panel" id="settings-notifications">', 'showSettingsSection("notifications")', "Notification settings mount only behind the notifications section guard.");
assertPanelGuard('<div className="panel" id="settings-account">', 'showSettingsSection("account")', "Account settings mount only behind the account section guard.");
assertPanelGuard('<div className="panel" id="settings-website-branding">', 'showSettingsSection("website-branding")', "Website settings mount only behind the website-branding section guard.");
const restaurantApp = sliceBetween(source, "function RestaurantApp(", "\nfunction DevelopmentEntitlementSimulator");
assert(!restaurantApp.includes('id="kitchen-summary"'), "RestaurantApp must not mount Kitchen summary; KitchenApp owns the KDS route.");
assert(!source.includes(".restaurant-dashboard-settings :is"), "Settings route does not rely on CSS-hidden unrelated panels.");
assert(source.includes("Settings center"), "Settings center panel is missing.");
assert(source.includes("Configuration and editing tools live here"), "Settings center needs context for restaurant owners.");

console.log("Restaurant settings routing contract passed.");

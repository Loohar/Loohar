import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../apps/web/src/App.jsx", import.meta.url), "utf8");
const restaurantRoutes = readFileSync(new URL("../apps/api/src/routes/restaurant.js", import.meta.url), "utf8");

const requiredSections = [
  "account",
  "restaurant-profile",
  "locations",
  "business-hours",
  "ordering",
  "menu-catalog",
  "payments",
  "receipts-printing",
  "website-branding",
  "gallery-social",
  "domains-seo",
  "staff-roles",
  "notifications",
  "loyalty",
  "coupons",
  "delivery-zones",
  "pos-kiosk",
  "security-audit",
  "billing-subscription",
  "integrations",
  "developer-api"
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (const id of requiredSections) {
  if (!restaurantRoutes.includes(`id: "${id}"`)) fail(`Backend settings registry is missing ${id}.`);
  if (!app.includes(`id: "${id}"`)) fail(`Frontend settings link registry is missing ${id}.`);
  if (!app.includes(`id="settings-${id}"`)) fail(`Frontend settings panel is missing settings-${id}.`);
}

[
  "SETTINGS_SECTION_STATUS",
  "function settingsRegistryPayload",
  "async function settingsSectionSnapshot",
  "router.get(\"/:restaurantId/settings/search\"",
  "router.get(\"/:restaurantId/settings/audit\"",
  "router.get(\"/:restaurantId/settings/:section\""
].forEach((fragment) => {
  if (!restaurantRoutes.includes(fragment)) fail(`Backend settings endpoint marker missing: ${fragment}`);
});

if (restaurantRoutes.includes("posShift")) fail("Invalid Prisma model reference posShift is still present.");
if (!app.includes("settingsStatusTone(item.status)") || !app.includes("settingsStatusLabel(item.status)")) {
  fail("Settings center does not render explicit status pills.");
}

console.log("Settings platform test passed.");

import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../apps/web/src/App.jsx", import.meta.url), "utf8");
const restaurantRoutes = readFileSync(new URL("../apps/api/src/routes/restaurant.js", import.meta.url), "utf8");

function assertIncludes(source, fragment, label = fragment) {
  if (!source.includes(fragment)) {
    console.error(`Missing restaurant context marker: ${label}`);
    process.exit(1);
  }
}

function assertNotIncludes(source, fragment, label = fragment) {
  if (source.includes(fragment)) {
    console.error(`Forbidden restaurant context fallback remains: ${label}`);
    process.exit(1);
  }
}

[
  "function restaurantProfilePlaceholder",
  "loadRestaurantInFlightRef",
  "loadRestaurantRequestIdRef",
  "realtimeRefreshTimerRef",
  "requestId !== loadRestaurantRequestIdRef.current",
  "setProfile(profilePayload.restaurant || initialProfile)",
  "restaurantOperationsTitle = `${profile.businessName || profile.name || \"Restaurant\"} operations`"
].forEach((fragment) => assertIncludes(app, fragment));

[
  "setProfile(profilePayload.restaurant || demoRestaurant)",
  "Demo Bistro operations",
  "profile.slug || \"demo-bistro\"",
  "businessName: demoRestaurant.businessName"
].forEach((fragment) => assertNotIncludes(app, fragment));

[
  "async function resolveRestaurantIdentifier",
  "prisma.restaurant.findUnique",
  "req.tenantId !== restaurant.id",
  "Tenant access denied"
].forEach((fragment) => assertIncludes(restaurantRoutes, fragment));

assertNotIncludes(restaurantRoutes, "findFirst({ where: { OR", "slug/id route fallback using findFirst");

console.log("Restaurant context test passed.");

import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../apps/web/src/App.jsx", import.meta.url), "utf8");
const restaurantRoutes = readFileSync(new URL("../apps/api/src/routes/restaurant.js", import.meta.url), "utf8");
const authMiddleware = readFileSync(new URL("../apps/api/src/middleware/auth.js", import.meta.url), "utf8");

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

const primarySlugBlock = app.slice(app.indexOf("function primaryRestaurantSlugFor"), app.indexOf("function legacyRestaurantRedirectPath"));
assertNotIncludes(primarySlugBlock, "user?.restaurantId", "primary restaurant route fallback to raw tenant id");
assertNotIncludes(app, "const restaurantId = user?.restaurantId || routeRestaurantId;", "RestaurantApp route tenant overridden by session tenant");
assertNotIncludes(app, "const restaurantKey = user?.restaurantId || routeRestaurantId || initialSlug || user?.restaurantSlug || \"\";", "onboarding route tenant overridden by session tenant");
assertIncludes(app, "const restaurantId = initialSlug || user?.restaurantSlug || routeRestaurantId || user?.restaurantId || \"\";", "RestaurantApp prefers route slug before session tenant id");
assertIncludes(app, "const restaurantKey = initialSlug || user?.restaurantSlug || routeRestaurantId || user?.restaurantId || \"\";", "onboarding prefers route slug before session tenant id");
assertNotIncludes(app, 'const publicWebsitePath = restaurantSlug ? publicPathForSlug(restaurantSlug) : "/sites/demo-bistro";', "restaurant shell public site demo fallback");
assertIncludes(app, "resetRestaurantLiveState(initialProfile)", "restaurant failed loads reset live state");
assertIncludes(app, "const [categories, setCategories] = useState([])", "restaurant categories start empty");

const restaurantApp = app.slice(app.indexOf("function RestaurantApp("), app.indexOf("function KitchenApp"));
[
  "demoRestaurant",
  "demoOrders",
  "demoDrivers",
  "demoGallery",
  "demoWebsiteSettings",
  "demoDomain",
  "demo mode"
].forEach((fragment) => assertNotIncludes(restaurantApp, fragment, `RestaurantApp live-only state: ${fragment}`));

[
  "async function resolveRestaurantIdentifier",
  "prisma.restaurant.findUnique",
  "req.tenantId !== restaurant.id",
  "Tenant access denied"
].forEach((fragment) => assertIncludes(restaurantRoutes, fragment));

assertNotIncludes(restaurantRoutes, "findFirst({ where: { OR", "slug/id route fallback using findFirst");
assertNotIncludes(authMiddleware, "req.params.restaurantId || req.body.restaurantId || req.query.restaurantId", "raw path tenant id comparison");
assertIncludes(authMiddleware, "req.resolvedRestaurantId && req.resolvedRestaurantId !== req.tenantId", "resolved route tenant guard");

console.log("Restaurant context test passed.");

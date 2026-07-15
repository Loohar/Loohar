import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function read(filePath) {
  return readFileSync(join(root, filePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error(`✗ ${message}`);
    return;
  }
  console.log(`✓ ${message}`);
}

const schema = read("apps/api/prisma/schema.prisma");
const restaurantRoutes = read("apps/api/src/routes/restaurant.js");
const uploadRoutes = read("apps/api/src/routes/uploads.js");
const uploadService = read("apps/api/src/services/uploadService.js");
const superAdminRoutes = read("apps/api/src/routes/superAdmin.js");
const app = read("apps/web/src/App.jsx");
const apiClient = read("apps/web/src/lib/api.js");

assert(schema.includes("enum OnboardingStatus"), "Prisma schema defines onboarding status");
assert(schema.includes("onboardingCurrentStep") && schema.includes("websitePublishedAt"), "Restaurant stores onboarding progress and publish state");
assert(schema.includes("mobileHeroImageUrl") && schema.includes("faviconUrl") && schema.includes("buttonColor"), "Website settings store onboarding branding fields");
assert(restaurantRoutes.includes('router.get("/onboarding"') && restaurantRoutes.includes('router.patch("/:restaurantId/onboarding/:step"'), "Restaurant onboarding API routes exist");
assert(restaurantRoutes.includes("requireTenantAccess") && restaurantRoutes.includes("Tenant access denied"), "Restaurant onboarding stays tenant scoped");
assert(restaurantRoutes.includes("onboardingReadiness") && restaurantRoutes.includes("orderingReady: websiteReady && sections.fulfillment && sections.menu && paymentReady"), "Backend separates website readiness from ordering readiness");
assert(restaurantRoutes.includes("websitePublishedAt") && restaurantRoutes.includes("onboardingStatus: \"COMPLETED\"") && restaurantRoutes.includes("onboardingCompletedAt"), "Publish endpoint persists completed onboarding");
assert(uploadRoutes.includes("restaurant-mobile-hero") && uploadRoutes.includes("restaurant-favicon") && uploadRoutes.includes("menu-item"), "Upload routes support onboarding image types");
assert(uploadService.includes("tenants/") && uploadService.includes("hero/mobile") && uploadService.includes("favicon"), "Upload service uses tenant-safe onboarding paths");
assert(superAdminRoutes.includes("adminOnboardingSummary") && superAdminRoutes.includes("completionPercentage"), "Super Admin exposes onboarding visibility");
assert(app.includes("RestaurantOnboardingWizard") && app.includes("isRestaurantOnboardingRoute") && app.includes("restaurantOnboardingComplete"), "Frontend routes restaurant owners into onboarding");
assert(app.includes("Skip for now") && app.includes("restaurant-mobile-hero") && app.includes("uploadMenuItemImage"), "Wizard supports optional skips and required uploads");
assert(app.includes("--button") && app.includes("contactMessage") && app.includes("cateringMessage"), "Public site consumes onboarding website settings");
assert(apiClient.includes("error.payload = payload"), "Frontend preserves backend readiness errors");

if (failures.length) {
  console.error(`Onboarding test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("Onboarding test passed.");

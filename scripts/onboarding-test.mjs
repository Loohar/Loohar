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
const onboardingWizard = app.slice(app.indexOf("function RestaurantOnboardingWizard"), app.indexOf("function AuthPage"));

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
assert(app.includes("draftDirtyRef") && app.includes("galleryDirtyRef") && app.includes("forceDraft") && app.includes("forceGallery") && app.includes("serverRefreshPending"), "Onboarding protects dirty drafts from background API refreshes");
assert(app.includes("businessHourNoteMaxLength = 500") && app.includes("maxLength={businessHourNoteMaxLength}") && app.includes("Holiday or special-hours note") && app.includes("<textarea"), "Business-hours special note uses stable textarea with 500 character limit");
assert(app.includes("menuReviewState") && app.includes("menuReviewMessage") && app.includes("Saving menu review") && app.includes("Menu reviewed and saved") && app.includes("aria-live=\"polite\""), "Menu review has accessible saving, saved, and error feedback");
assert(app.includes("gallerySaveState") && app.includes("galleryDirtyMap") && app.includes("galleryTitleMaxLength") && app.includes("galleryCaptionMaxLength") && app.includes("key={image.id}") && app.includes("aria-busy"), "Gallery metadata editing has per-image dirty and mutation states");
assert(app.includes("updateSocialDraft") && app.includes("socialDraftDirty"), "Social link editor tracks unsaved input without resetting local text");
assert(app.includes("type=\"submit\" disabled={saving === \"menu-category\"}") && app.includes("type=\"submit\" disabled={saving === \"menu-item\"}"), "Quick menu submit buttons are explicitly typed");
assert(app.includes("type=\"button\" onClick={() => saveStep(\"menu\")}") && app.includes("type=\"button\" onClick={() => saveGalleryImage(image.id)}"), "Non-submit onboarding actions are explicitly typed");
assert(!app.includes("maxLength={1}") && !app.includes("maxLength=\"1\""), "Onboarding text inputs are not constrained to one character");
assert(app.includes("brandColorModes") && app.includes("LINEAR_GRADIENT") && app.includes("RADIAL_GRADIENT") && app.includes("IMAGE_OVERLAY") && app.includes("TRANSPARENT"), "Brand editor supports solid, gradient, overlay, and transparent color modes");
assert(app.includes("approvedBrandFonts") && app.includes("brandPresets") && app.includes("Modern bistro") && app.includes("Fine dining"), "Brand editor exposes approved fonts and curated presets");
assert(app.includes("normalizeBrandTheme") && app.includes("brandThemeBackground") && app.includes("contrastRatioForColors"), "Brand editor normalizes themes and exposes accessibility contrast checks");
assert(app.includes("normalizeHeroMedia") && app.includes("heroMediaModes") && app.includes("Video hero") && app.includes("Carousel"), "Hero media editor supports image, carousel, slideshow, and video modes");
assert(app.includes("sectionSettingsJson: {") && app.includes("brandTheme") && app.includes("heroMedia") && app.includes("brandPreviewMode"), "Branding saves advanced theme and hero media through section settings");
assert(app.includes("Save branding") && app.includes("Reset changes") && app.includes("Preview mode"), "Branding editor has explicit save, reset, and preview controls");
assert(app.includes("reducedMotionFallback") && app.includes("brandContrastStatus") && app.includes("5MB image limit"), "Branding editor surfaces accessibility and performance indicators");
assert(app.includes("Publish branding") && app.includes("Draft preview") && app.includes("Published preview") && app.includes("saveBrandingPublishState"), "Branding editor exposes explicit preview and publish controls");
assert(app.includes("brandPaletteColors") && app.includes("rgbColorString") && app.includes("hslColorString") && app.includes("Brand palette"), "Branding editor exposes palette, RGB, and HSL readouts");
assert(app.includes("moveHeroSlide") && app.includes("Move up") && app.includes("Move down") && app.includes("Published"), "Hero carousel editor supports slide ordering and publish state");
assert(onboardingWizard.includes("draftDirtyRef") && onboardingWizard.includes("serverRefreshPending") && onboardingWizard.includes("forceDraft"), "Onboarding wizard protects dirty drafts from server refreshes");
assert(!/key=\{.*JSON\.stringify/.test(onboardingWizard), "Onboarding wizard does not use JSON-stringified values as React keys");
assert(!/key=\{draft\./.test(onboardingWizard), "Onboarding wizard does not use editable draft values as React keys");
assert(!/defaultValue=\{draft\./.test(onboardingWizard), "Onboarding wizard draft inputs remain controlled instead of defaultValue based");
const updateDraftMatch = onboardingWizard.match(/function updateDraft[\s\S]*?\n  \}/);
assert(updateDraftMatch && !updateDraftMatch[0].includes("api("), "Draft field edits do not trigger per-character API writes");

if (failures.length) {
  console.error(`Onboarding test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("Onboarding test passed.");

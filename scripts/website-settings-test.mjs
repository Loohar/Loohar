import { readFileSync } from "node:fs";

const restaurantRoute = readFileSync("apps/api/src/routes/restaurant.js", "utf8");
const websiteService = readFileSync("apps/api/src/services/websiteService.js", "utf8");
const uploadsRoute = readFileSync("apps/api/src/routes/uploads.js", "utf8");
const app = readFileSync("apps/web/src/App.jsx", "utf8");
const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");

const checks = [];

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

assertCheck("Website settings model stores core public site fields", ["heroTitle", "heroSubtitle", "logoUrl", "heroImageUrl", "brandColor", "accentColor", "seoTitle", "seoDescription", "sectionSettingsJson"].every((field) => schema.includes(field)));
assertCheck("Website settings are ensured for every public bundle", websiteService.includes("ensureWebsiteSettings(restaurant)") && websiteService.includes("completeWebsiteSettings"));
assertCheck("Website image resolver prevents blank hero/logo images", websiteService.includes("resolveImage(websiteSettings?.heroImageUrl") && websiteService.includes("resolveImage(websiteSettings?.logoUrl"));
assertCheck("Website update route persists uploaded/text settings", restaurantRoute.includes("router.patch(\"/website\", updateWebsite)") && restaurantRoute.includes("restaurantWebsiteSettings.upsert"));
assertCheck("Logo upload writes website settings", uploadsRoute.includes("update: { logoUrl: upload.publicUrl }") && uploadsRoute.includes("action: \"website.logo.uploaded\""));
assertCheck("Hero upload writes website settings", uploadsRoute.includes("update: { heroImageUrl: upload.publicUrl }") && uploadsRoute.includes("action: \"website.hero.uploaded\""));
assertCheck("Frontend website editor uses live PATCH route", app.includes("api(`/api/restaurants/${restaurantId}/website`, { method: \"PATCH\""));
assertCheck("Frontend previews public site through path-based route", app.includes("publicPathForSlug(profile.slug"));

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

const failed = checks.filter((check) => !check.ok);
console.log(`Website settings test: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);

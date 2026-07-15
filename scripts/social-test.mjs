import { readFileSync } from "node:fs";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const restaurantRoute = readFileSync("apps/api/src/routes/restaurant.js", "utf8");
const websiteService = readFileSync("apps/api/src/services/websiteService.js", "utf8");
const publicRoute = readFileSync("apps/api/src/routes/public.js", "utf8");
const app = readFileSync("apps/web/src/App.jsx", "utf8");

const checks = [];

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

assertCheck("Social model stores enabled/sort metadata", ["enabled      Boolean    @default(true)", "sortOrder    Int        @default(0)", "updatedAt    DateTime   @updatedAt"].every((snippet) => schema.includes(snippet)));
assertCheck("Restaurant API supports food-business social platforms", ["yelp", "google", "google_business"].every((platform) => restaurantRoute.includes(platform)));
assertCheck("Restaurant API requires HTTPS social links", restaurantRoute.includes("function isValidHttpsUrl") && restaurantRoute.includes("Enter a valid https URL."));
assertCheck("Restaurant API can update social links", restaurantRoute.includes("async function updateSocialLink") && restaurantRoute.includes("router.patch(\"/social-links/:id\", updateSocialLink)"));
assertCheck("Public website service only loads enabled social links", websiteService.includes("socialLinks: { where: { enabled: true }"));
assertCheck("Public route removes disabled or non-HTTPS social links", publicRoute.includes("link.enabled !== false") && publicRoute.includes("isPublicHttpsUrl(link.url)"));
assertCheck("Frontend supports social visibility toggle", app.includes("Social link hidden.") && app.includes("Social link visible."));
assertCheck("Frontend public social links require enabled HTTPS URLs", app.includes("link.enabled !== false") && app.includes("/^https:\\/\\//i.test(link.url)"));
assertCheck("Frontend includes Yelp and Google labels", app.includes("yelp: \"Yelp\"") && app.includes("google_business: \"Google Business\""));

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

const failed = checks.filter((check) => !check.ok);
console.log(`Social test: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);

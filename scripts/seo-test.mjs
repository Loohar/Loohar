import { readFileSync } from "node:fs";

const publicRoutes = readFileSync("apps/api/src/routes/public.js", "utf8");
const app = readFileSync("apps/web/src/App.jsx", "utf8");
const domainService = readFileSync("apps/api/src/services/domainService.js", "utf8");
const sitemap = readFileSync("apps/web/public/sitemap.xml", "utf8");

const checks = [];

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

const seoSurface = `${publicRoutes}\n${app}`;
assertCheck("No fake aggregate rating structured data", !seoSurface.includes("aggregateRating"));
assertCheck("No hard-coded fake rating value", !/rating\s*:\s*4\.8|ratingValue\s*:\s*["']4\.8/.test(seoSurface));
assertCheck("No hard-coded fake review count", !/reviewCount\s*:\s*128|reviewCount\s*:\s*["']128/.test(seoSurface));

assertCheck("Static sitemap uses path-based URLs", !sitemap.includes("https://loohar.com/sites/") && sitemap.includes("https://loohar.com/demo-bistro"));
assertCheck("Per-restaurant sitemap endpoint exists", publicRoutes.includes("router.get(\"/restaurants/:slug/sitemap.xml\""));
assertCheck("Per-restaurant robots endpoint exists", publicRoutes.includes("router.get(\"/restaurants/:slug/robots.txt\""));
assertCheck("Public API routes include canonical route map", publicRoutes.includes("routes: {") && publicRoutes.includes("menu: `${domainInfo.canonicalUrl}/menu`"));
assertCheck("Canonical fallback is Loohar path URL", domainService.includes("function defaultTenantUrl") && domainService.includes("https://${tenantRootDomain()}/${slug}"));
assertCheck("Public SEO applies canonical link", app.includes("setLinkTag(\"canonical\", canonicalUrl)") && app.includes("property: \"og:url\""));

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

const failed = checks.filter((check) => !check.ok);
console.log(`SEO test: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);

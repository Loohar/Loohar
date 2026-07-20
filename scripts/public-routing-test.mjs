import { readFileSync } from "node:fs";
import { RESERVED_PLATFORM_SLUGS, validatePublicSlug } from "../apps/shared/reservedSlugs.js";

const files = {
  app: readFileSync("apps/web/src/App.jsx", "utf8"),
  publicRoutes: readFileSync("apps/api/src/routes/public.js", "utf8"),
  domainService: readFileSync("apps/api/src/services/domainService.js", "utf8"),
  superAdmin: readFileSync("apps/api/src/routes/superAdmin.js", "utf8"),
  vercel: readFileSync("apps/web/vercel.json", "utf8")
};

const checks = [];

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

assertCheck("Reserved slugs include platform routes", ["admin", "api", "app", "restaurant", "driver", "customer", "sites", "features"].every((slug) => RESERVED_PLATFORM_SLUGS.includes(slug)));
assertCheck("Reserved admin slug rejected", validatePublicSlug("admin").ok === false);
assertCheck("Reserved features slug rejected", validatePublicSlug("features").ok === false);
assertCheck("Malformed slug rejected", validatePublicSlug("bad_slug").ok === false && validatePublicSlug("bad--slug").ok === false);
assertCheck("Restaurant slug accepted", validatePublicSlug("kathmandu-restaurant").ok === true);

assertCheck("Frontend resolves first segment as restaurant slug", files.app.includes("function isPathBasedPublicRestaurantPath") && files.app.includes("validatePublicSlug(first || \"\")"));
assertCheck("Frontend builds clean restaurant paths", files.app.includes("function publicPathForSlug") && files.app.includes("return target === \"home\" ? `/${safeSlug}` : `/${safeSlug}/${target}`;"));
assertCheck("Frontend uses new public restaurant API", files.app.includes("/api/public/restaurants/${slug}") && !files.app.includes("/api/public/sites/"));
assertCheck("Frontend reserves feature pages before tenant routes", files.app.includes('const isFeatureRoute = initialPath === "/features" || initialPath.startsWith("/features/");') && files.app.indexOf("if (isFeatureRoute)") < files.app.indexOf("if (isSiteRoute)"));
assertCheck("Tenant host routing excludes feature pages", files.app.includes('!initialPath.startsWith("/features")'));

assertCheck("API exposes path-based restaurant bundle", files.publicRoutes.includes("router.get(\"/restaurants/:slug\", sendWebsiteBundle);"));
assertCheck("API exposes path-based menu bundle", files.publicRoutes.includes("router.get(\"/restaurants/:slug/menu\", sendMenu);"));
assertCheck("API exposes path-based sitemap and robots", files.publicRoutes.includes("router.get(\"/restaurants/:slug/sitemap.xml\"") && files.publicRoutes.includes("router.get(\"/restaurants/:slug/robots.txt\""));
assertCheck("API keeps legacy sites routes only for compatibility", files.publicRoutes.includes("router.get(\"/sites/:slug\", sendWebsiteBundle);"));

assertCheck("Domain service canonical fallback is path-based", files.domainService.includes("return `https://${tenantRootDomain()}/${slug}"));
assertCheck("Super Admin validates reserved slugs", files.superAdmin.includes("validatePublicSlug(restaurantData.slug)") && files.superAdmin.includes("validatePublicSlug(data.slug)"));
assertCheck("Vercel redirects legacy sites URLs", files.vercel.includes("\"source\": \"/sites/:slug\"") && files.vercel.includes("\"destination\": \"/:slug\""));
assertCheck("Vercel rewrites per-restaurant sitemap and robots", files.vercel.includes("\"source\": \"/:slug/sitemap.xml\"") && files.vercel.includes("\"source\": \"/:slug/robots.txt\""));

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

const failed = checks.filter((check) => !check.ok);
console.log(`Public routing test: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);

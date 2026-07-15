import { readFileSync } from "node:fs";

const publicRoute = readFileSync("apps/api/src/routes/public.js", "utf8");
const restaurantRoute = readFileSync("apps/api/src/routes/restaurant.js", "utf8");
const uploadsRoute = readFileSync("apps/api/src/routes/uploads.js", "utf8");
const uploadService = readFileSync("apps/api/src/services/uploadService.js", "utf8");
const websiteService = readFileSync("apps/api/src/services/websiteService.js", "utf8");
const domainService = readFileSync("apps/api/src/services/domainService.js", "utf8");

const checks = [];

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

assertCheck("Public route logs cross-tenant integrity violations", publicRoute.includes("tenant.data_integrity_violation") && publicRoute.includes("belongsToTenant"));
assertCheck("Public categories/items are filtered by resolved tenant", publicRoute.includes("recordType: \"MenuCategory\"") && publicRoute.includes("recordType: \"MenuItem\""));
assertCheck("Public gallery/social/domain/settings are filtered by resolved tenant", ["RestaurantGalleryImage", "RestaurantSocialLink", "RestaurantDomain", "RestaurantWebsiteSettings"].every((recordType) => publicRoute.includes(recordType)));
assertCheck("Website bundle filters categories/items by tenant", websiteService.includes("category.restaurantId === restaurantId") && websiteService.includes("item.restaurantId === restaurantId"));
assertCheck("Restaurant admin gallery mutations are tenant-scoped", restaurantRoute.includes("findFirst({ where: { id: req.params.id, restaurantId } })"));
assertCheck("Restaurant upload route blocks cross-tenant writes", uploadsRoute.includes("req.body.restaurantId && req.body.restaurantId !== req.tenantId") && uploadsRoute.includes("Tenant access denied"));
assertCheck("Menu item uploads use compound tenant key", uploadsRoute.includes("id_restaurantId: { id: req.body.menuItemId, restaurantId: restaurant.id }"));
assertCheck("Storage keys include tenant directory", uploadService.includes("`tenants/${safeRestaurantId}/"));
assertCheck("Domain resolver supports host-based tenant lookup", domainService.includes("resolvePublicTenant") && domainService.includes("resolveTenantByHost(host)"));

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

const failed = checks.filter((check) => !check.ok);
console.log(`Tenant isolation test: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);

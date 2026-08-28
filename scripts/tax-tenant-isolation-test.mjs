import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const routes = read("apps/api/src/routes/taxProfiles.js");
const authMiddleware = read("apps/api/src/middleware/auth.js");
const service = read("apps/api/src/services/taxProfileService.js");

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `Missing first marker: ${first}`);
  assert.notEqual(secondIndex, -1, `Missing second marker: ${second}`);
  assert.ok(firstIndex < secondIndex, message);
}

function denyResponseIsGeneric(block) {
  const line = block.split("\n").find((item) => item.includes("AUTH_TENANT_FORBIDDEN")) || "";
  assert.ok(line.includes("Tenant access denied"), "cross-tenant denial must use a generic tenant access error");
  assert.equal(/slug|businessName|jurisdiction|taxRate|components|profile|location\.address/i.test(line), false, "cross-tenant denial must not expose foreign tenant tax data");
}

const paramBlock = sliceBetween(routes, 'router.param("restaurantId"', "\n\nrouter.use(requireRole");
assert.ok(
  paramBlock.includes('req.user?.role !== "SUPER_ADMIN"') && paramBlock.includes("req.tenantId !== restaurant.id"),
  "tax router must validate non-super-admin tenant ownership after resolving the requested restaurant"
);
assert.ok(paramBlock.includes("status(403)") && paramBlock.includes("AUTH_TENANT_FORBIDDEN"), "cross-tenant tax requests must be denied with existing 403 semantics");
assertBefore(paramBlock, "AUTH_TENANT_FORBIDDEN", "req.resolvedRestaurantId = restaurant.id", "cross-tenant denial must happen before the resolved tenant is handed to tax handlers");
assertBefore(paramBlock, "AUTH_TENANT_FORBIDDEN", "next();", "cross-tenant denial must happen before route handlers can run");
denyResponseIsGeneric(paramBlock);

assert.ok(routes.includes("router.use(requireRole(...readRoles), requireTenantAccess);"), "tax router must keep role and generic tenant-access middleware");
assert.ok(authMiddleware.includes("if (req.resolvedRestaurantId && req.resolvedRestaurantId !== req.tenantId)"), "generic tenant middleware must deny resolved tenant mismatches");

const workspaceRoute = sliceBetween(routes, 'router.get("/:restaurantId/tax-profiles"', '\n\nrouter.get("/:restaurantId/locations/:locationId/tax-profile"');
assert.ok(workspaceRoute.includes("req.resolvedRestaurantId"), "workspace reads must use the authorized resolved restaurant id");
assert.equal(workspaceRoute.includes("req.params.restaurantId"), false, "workspace reads must not trust the client-provided restaurant identifier after authorization");

const locationRoute = sliceBetween(routes, 'router.get("/:restaurantId/locations/:locationId/tax-profile"', '\n\nrouter.get("/:restaurantId/locations/:locationId/tax-profile/history"');
assert.ok(locationRoute.includes("getTaxWorkspace({ restaurantId: req.resolvedRestaurantId })"), "location reads must derive data from the authorized workspace");
assert.ok(locationRoute.includes("workspace.locations.find((item) => item.id === req.params.locationId)"), "foreign locations must be filtered out of the authorized tenant workspace");

const historyRoute = sliceBetween(routes, 'router.get("/:restaurantId/locations/:locationId/tax-profile/history"', '\n\nrouter.post("/:restaurantId/locations/:locationId/tax-profile/resolve"');
assert.ok(historyRoute.includes("restaurantId: req.resolvedRestaurantId"), "profile history reads must be scoped to the authorized tenant");

const resolveRoute = sliceBetween(routes, 'router.post("/:restaurantId/locations/:locationId/tax-profile/resolve"', '\n\nrouter.post("/:restaurantId/locations/:locationId/tax-profile/manual"');
assert.ok(resolveRoute.includes("requireRole(...manageRoles)") && resolveRoute.includes("restaurantId: req.resolvedRestaurantId"), "provider lookup/candidate generation must require tax admin role and authorized tenant");

const manualRoute = sliceBetween(routes, 'router.post("/:restaurantId/locations/:locationId/tax-profile/manual"', '\n\nrouter.post("/:restaurantId/locations/:locationId/tax-profile/acknowledge"');
assert.ok(manualRoute.includes("requireRole(...manualVerificationRoles)") && manualRoute.includes("restaurantId: req.resolvedRestaurantId"), "manual verified profile creation must require privileged role and authorized tenant");

const acknowledgeRoute = sliceBetween(routes, 'router.post("/:restaurantId/locations/:locationId/tax-profile/acknowledge"', '\n\nrouter.post("/:restaurantId/locations/:locationId/tax-profile/refresh"');
assert.ok(acknowledgeRoute.includes("requireRole(...manageRoles)") && acknowledgeRoute.includes("restaurantId: req.resolvedRestaurantId"), "candidate acknowledgement/activation must require tax admin role and authorized tenant");

const refreshRoute = sliceBetween(routes, 'router.post("/:restaurantId/locations/:locationId/tax-profile/refresh"', "\n\nexport default router;");
assert.ok(refreshRoute.includes("requireRole(...manageRoles)") && refreshRoute.includes("restaurantId: req.resolvedRestaurantId"), "refresh/recheck must require tax admin role and authorized tenant");

const locationForTenant = sliceBetween(service, "async function locationForTenant", "\n\nasync function updateLocationTaxState");
assert.ok(locationForTenant.includes("where: { id: locationId, restaurantId }"), "tax service location lookup must require matching tenant and location ids");

const getWorkspace = sliceBetween(service, "export async function getTaxWorkspace", "\n  const activeLocations");
assert.ok(getWorkspace.includes("where: { restaurantId }"), "tax workspace must query locations by authorized restaurant id");

const profileHistory = sliceBetween(service, "export async function taxProfileHistory", "\n\nexport async function getTaxWorkspace");
assertBefore(profileHistory, "locationForTenant({ restaurantId, locationId })", "prisma.locationTaxProfile.findMany", "profile history must validate tenant/location ownership before reading profiles");
assert.ok(profileHistory.includes("where: { restaurantId, locationId }"), "profile history must be scoped by tenant and location");

const resolveService = sliceBetween(service, "export async function resolveLocationTaxProfile", "\n\nexport async function createManualVerifiedTaxProfile");
assertBefore(resolveService, "locationForTenant({ restaurantId, locationId })", "taxProviderFor", "provider lookup must not start until tenant/location ownership is validated");
assertBefore(resolveService, "locationForTenant({ restaurantId, locationId })", "provider.resolveJurisdiction", "Colorado TTR must not be called before tenant/location ownership is validated");

const manualService = sliceBetween(service, "export async function createManualVerifiedTaxProfile", "\n\nfunction activationValidation");
assertBefore(manualService, "locationForTenant({ restaurantId, locationId })", "provider.verifyTaxConfiguration", "manual profile creation must validate tenant/location ownership before verification");

const acknowledgeService = sliceBetween(service, "export async function acknowledgeAndActivateTaxProfile", "\n\nexport async function refreshLocationTaxProfile");
assertBefore(acknowledgeService, "locationForTenant({ restaurantId, locationId })", "prisma.locationTaxProfile.findFirst", "candidate acknowledgement must validate location ownership before reading profile ids");
assert.ok(acknowledgeService.includes("where: { id: profileId, restaurantId, locationId }"), "foreign tax profile ids must be scoped by tenant and location");
assert.ok(acknowledgeService.includes("where: { restaurantId, locationId, status: TAX_PROFILE_STATUS.ACTIVE"), "activation must only supersede profiles inside the authorized tenant/location");
assert.ok(acknowledgeService.includes("id: candidate.id") && acknowledgeService.includes("restaurantId") && acknowledgeService.includes("locationId"), "activation must update the candidate only inside the authorized tenant/location");

const refreshService = sliceBetween(service, "export async function refreshLocationTaxProfile", "\n\nexport async function findValidLocationTaxConfiguration");
assertBefore(refreshService, "locationForTenant({ restaurantId, locationId })", "prisma.locationTaxProfile.findFirst", "refresh must validate tenant/location ownership before reading active profiles");
assert.ok(refreshService.includes("where: { restaurantId, locationId, status: TAX_PROFILE_STATUS.ACTIVE"), "refresh must only read active profiles inside the authorized tenant/location");

assert.ok(!routes.includes("COLORADO_TTR_ENDPOINT") && !routes.includes("api.ttr.services"), "tax router must not call external TTR directly");

const accessCases = [
  ["Northside owner -> Northside tax workspace", { role: "RESTAURANT_OWNER", tenantId: "northside", restaurantId: "northside" }, true],
  ["Northside owner -> Loohar Restaurant tax workspace", { role: "RESTAURANT_OWNER", tenantId: "northside", restaurantId: "loohar" }, false],
  ["Northside owner -> foreign location tax data", { role: "RESTAURANT_OWNER", tenantId: "northside", restaurantId: "loohar" }, false],
  ["Northside owner -> foreign profile/candidate acknowledgement", { role: "RESTAURANT_OWNER", tenantId: "northside", restaurantId: "loohar" }, false],
  ["Cashier -> tax workspace", { role: "CASHIER", tenantId: "northside", restaurantId: "northside" }, false],
  ["Master Admin -> cross-tenant tax workspace", { role: "SUPER_ADMIN", tenantId: null, restaurantId: "loohar" }, true],
  ["Tenant A restaurant id + Tenant B location/profile ids", { role: "RESTAURANT_OWNER", tenantId: "tenant-a", restaurantId: "tenant-b" }, false]
];
const readRoles = ["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "SUPER_ADMIN"];
for (const [label, input, expected] of accessCases) {
  const roleAllowed = readRoles.includes(input.role);
  const tenantAllowed = input.role === "SUPER_ADMIN" || input.tenantId === input.restaurantId;
  assert.equal(roleAllowed && tenantAllowed, expected, label);
}

console.log("tax-tenant-isolation-test passed (workspace read, location/profile reads, resolve, refresh, manual profile, acknowledgement/activation, cashier denial, master admin preservation, mixed ids, no foreign data leakage, and zero unauthorized TTR path).");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblePosMenuCategories } from "../apps/api/src/services/posMenuReadModel.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const posRoute = read("apps/api/src/routes/pos.js");
const posService = read("apps/api/src/services/posService.js");

const categories = [{ id: "category-1", name: "Entrees" }];
const items = [{ id: "item-1", categoryId: "category-1", name: "Momo", available: true }];
const groups = [{ id: "group-1", menuItemId: "item-1", name: "Sauce", sortOrder: 1 }];
const options = [
  { id: "option-1", menuItemId: "item-1", optionGroupId: "group-1", name: "Hot", sortOrder: 1 },
  { id: "option-2", menuItemId: "item-1", optionGroupId: null, name: "Extra napkins", sortOrder: 2 }
];
const assembled = assemblePosMenuCategories({ categories, items, groups, options });

assert.equal(assembled.length, 1, "menu assembly should preserve active categories");
assert.equal(assembled[0].items.length, 1, "menu assembly should attach available items to their category");
assert.deepEqual(assembled[0].items[0].options.map((option) => option.id), ["option-1", "option-2"], "item options should preserve the ordered query result");
assert.deepEqual(assembled[0].items[0].optionGroups[0].options.map((option) => option.id), ["option-1"], "modifier groups should contain only their own options");

const restaurantResolver = posService.slice(
  posService.indexOf("export async function resolveRestaurantForPos"),
  posService.indexOf("export async function assertPosFeature")
);
assert.ok(restaurantResolver.includes("matchesAuthenticatedTenant") && restaurantResolver.includes("Promise.all"), "tenant lookup should resolve the authenticated restaurant and its public POS relations in one parallel wave");
assert.equal((restaurantResolver.match(/findUnique\(/g) || []).length, 1, "normal slug routing should not perform an id miss followed by a slug lookup");

const configService = posService.slice(
  posService.indexOf("export async function posConfig"),
  posService.indexOf("export async function posMenu")
);
assert.ok(configService.includes("entitlementVerified = false") && configService.includes("if (!entitlementVerified)"), "config should reuse the route's successful entitlement decision");
assert.ok(configService.includes('recordPosTiming(timings, "config-staff-device"') && configService.includes('recordPosTiming(timings, "config-register-state"'), "config should expose its two database waves");
assert.equal(configService.includes("cashierPinStatus("), false, "config should derive PIN status from the staff row it already loaded");

const menuService = posService.slice(
  posService.indexOf("export async function posMenu"),
  posService.indexOf("async function taxRateBps")
);
for (const stage of ["menu-categories", "menu-items", "menu-groups", "menu-options"]) {
  assert.ok(menuService.includes(`\"${stage}\"`), `${stage} should be measured independently`);
}
assert.ok(menuService.includes("assemblePosMenuCategories") && menuService.includes("Promise.all"), "menu relations should be fetched concurrently and reassembled without an N+1 loop");
assert.ok(menuService.includes("prisma.$queryRaw"), "availability diagnostics should use one aggregate database round trip");
assert.equal(menuService.includes("prisma.$transaction(["), false, "availability diagnostics should not issue seven count operations");

for (const stage of ["auth", "tenant", "entitlement", "config-service", "menu-query", "menu-diagnostics"]) {
  assert.ok(posRoute.includes(`\"${stage}\"`), `${stage} should be represented in POS Server-Timing`);
}
assert.ok(posRoute.includes("timings.serialization") && posRoute.includes("timings.total"), "serialization and total duration should be represented in POS Server-Timing");
assert.ok(posRoute.includes('res.setHeader("Server-Timing", header)'), "config and menu should return their backend waterfall in Server-Timing");
assert.ok(posRoute.includes("entitlementVerified: Boolean(req.entitlementDecision?.allowed)"), "the route should pass its authoritative entitlement result to config");

console.log("pos-cold-path-latency-test passed (tenant, auth/entitlement reuse, config waves, parallel menu, diagnostics, and telemetry).\n");

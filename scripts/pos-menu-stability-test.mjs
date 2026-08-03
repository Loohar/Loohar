import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const posRoutes = readFileSync(join(root, "apps/api/src/routes/pos.js"), "utf8");
const posService = readFileSync(join(root, "apps/api/src/services/posService.js"), "utf8");
const failures = [];

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function assertCheck(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

if (mode === "all" || mode === "state") {
  assertCheck(includesAll(app, [
    "const POS_MENU_STATUS",
    "IDLE",
    "INITIAL_LOADING",
    "SUCCESS",
    "EMPTY",
    "REFRESHING",
    "STALE",
    "ERROR",
    "ENTITLEMENT_DENIED",
    "posMenuState",
    "lastSuccessfulCategories",
    "lastSuccessfulItemCount"
  ]), "POS menu uses an explicit state model with last-successful menu preservation");
  assertCheck(!app.includes("setMenuCategories(menuPayload.categories || [])"), "POS menu is not overwritten directly by a late empty payload");
}

if (mode === "all" || mode === "race") {
  assertCheck(includesAll(app, [
    "posMenuSequenceRef",
    "acceptedPosMenuSequenceRef",
    "x-loohar-pos-request-id",
    "stale-response-rejected",
    "requestSequence < acceptedPosMenuSequenceRef.current",
    "POS_MENU_TENANT_MISMATCH"
  ]), "POS menu load rejects stale responses and tenant-mismatched payloads");
}

if (mode === "all" || mode === "refresh") {
  assertCheck(includesAll(app, [
    "POS_MENU_STATUS.REFRESHING",
    "POS_MENU_STATUS.STALE",
    "refreshError",
    "Showing the last synced POS menu",
    "hadSuccessfulMenu ? POS_MENU_STATUS.REFRESHING",
    "canKeepLastMenu"
  ]), "POS refresh preserves the visible menu during transient failures");
}

if (mode === "all" || mode === "availability") {
  assertCheck(includesAll(posRoutes, [
    "summarizePosMenu",
    "menuVersion",
    "availabilitySummary",
    "menuDiagnostics",
    "tenantId",
    "restaurantSlug",
    "locationId",
    "entitlement",
    "categories",
    "visibleItems"
  ]), "POS menu endpoint returns tenant, version, availability, entitlement, and category payload metadata");
  assertCheck(includesAll(app, [
    "normalizePosMenuPayload",
    "availabilitySummary?.visibleItems",
    "menuDiagnostics",
    "menuVersion",
    "tenantId",
    "locationId"
  ]), "Frontend normalizes live menu metadata before accepting a POS response");
  assertCheck(includesAll(posService, [
    "posMenuAvailabilityDiagnostics",
    "totalItems",
    "availableItemsTotal",
    "MENU_ITEMS_NOT_PUBLISHED_TO_POS"
  ]), "POS menu service returns diagnostics for hidden/unavailable menu items");
}

if (failures.length) {
  console.error(`pos-menu-stability-test (${mode}) failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`pos-menu-stability-test (${mode}) passed.`);

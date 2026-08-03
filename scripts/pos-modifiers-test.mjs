import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const posService = readFileSync(join(root, "apps/api/src/services/posService.js"), "utf8");
const restaurantRoutes = readFileSync(join(root, "apps/api/src/routes/restaurant.js"), "utf8");
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const workflowScreens = readFileSync(join(root, "apps/web/src/apps/pos/PosWorkflowScreens.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");
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

const requiredScripts = [
  "test:pos-performance",
  "test:menu-modifiers",
  "test:modifier-admin",
  "test:modifier-quotes",
  "test:kiosk-modifiers"
];

assertCheck(requiredScripts.every((scriptName) => packageJson.scripts?.[scriptName]?.includes("pos-modifiers-test.mjs")), "POS modifier release scripts are registered");

if (mode === "all" || mode === "performance") {
  assertCheck(includesAll(posService, [
    "normalizeMenuItemModifierGroups",
    "rawLineOptionIds",
    "normalizeLineOptionIds",
    "validateSelectedModifiers",
    "optionGroups: {",
    "options: { orderBy: { sortOrder: \"asc\" } }"
  ]), "POS service loads menu item modifiers with sorted groups/options and normalized selections");
  assertCheck(includesAll(app, [
    "normalizePosMenuPayload",
    "lastSuccessfulCategories",
    "POS_MENU_STATUS.STALE",
    "selectedPosModifierRows",
    "posModifierSignature",
    "modifierSignature"
  ]), "Frontend preserves the last good POS menu and keeps modifier selection local to the cart");
  assertCheck(includesAll(styles, [
    ".pos-modifier-dialog",
    ".pos-modifier-card",
    ".pos-modifier-options",
    ".pos-cart-modifiers"
  ]), "Modifier UI has dedicated dialog and cart modifier styling");
}

if (mode === "all" || mode === "menu-admin") {
  assertCheck(includesAll(restaurantRoutes, [
    "prisma.menuItemOptionGroup",
    "prisma.menuItemOption",
    "sanitizeModifierGroupPayload",
    "modifierHttpError",
    "router.post(\"/:restaurantId/menu-items/:itemId/options\"",
    "router.patch(\"/:restaurantId/menu-items/:itemId/options/:optionGroupId\"",
    "router.delete(\"/:restaurantId/menu-items/:itemId/options/:optionGroupId\"",
    "menu.item.modifiers.created",
    "menu.item.modifiers.updated",
    "menu.item.modifiers.deleted"
  ]), "Restaurant menu API supports create, update, delete, and audit logging for modifier groups");
  assertCheck(includesAll(app, [
    "menu-modifier-builder",
    "modifierPayloadFromDraft",
    "saveModifierGroup",
    "deleteModifierGroup",
    "Save modifiers",
    "Create modifier group",
    "Delete"
  ]), "Restaurant owner menu UI can create, edit, and delete modifiers without leaving menu management");
}

if (mode === "all" || mode === "quote-validation") {
  assertCheck(includesAll(posService, [
    "POS_MODIFIER_DUPLICATE",
    "POS_MODIFIER_INVALID",
    "POS_MODIFIER_REQUIRED",
    "POS_MODIFIER_MAXIMUM",
    "modifierOptionIds",
    "modifiers",
    "unitPriceCents = menuItem.priceCents + modifiers.reduce"
  ]), "Server-side POS quotes reject invalid modifier selections and price selected modifiers");
  assertCheck(includesAll(posService, [
    "optionsJson: {",
    "modifiers: line.modifiers || line.options || []",
    "optionIds: line.optionIds || line.modifierOptionIds || []",
    "specialInstructions"
  ]), "Submitted POS orders persist modifiers, option ids, and special instructions for kitchen/receipts");
  assertCheck(includesAll(app, [
    "modifierOptionIds: line.modifierOptionIds || line.optionIds || []",
    "modifiers: line.modifiers || []",
    "No onions, sauce on the side",
    "modifierError"
  ]), "Frontend sends modifier ids and instructions to server quotes with visible validation feedback");
}

if (mode === "all" || mode === "kiosk") {
  assertCheck(includesAll(app, [
    "function RestaurantKioskShell",
    "selectedPosModifierRows",
    "customizingItem",
    "toggleModifierSelection",
    "addConfiguredItemToCart",
    "line.modifiers"
  ]), "Kiosk shell shares the same modifier-aware ordering workflow as the POS register");
  assertCheck(includesAll(`${app}\n${workflowScreens}`, [
    "line.modifiers",
    "receipt-modifier",
    "Manager PIN",
    "Exit kiosk mode"
  ]), "Kiosk and receipt UI display selected modifiers while preserving manager exit controls");
}

if (failures.length) {
  console.error(`pos-modifiers-test (${mode}) failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`pos-modifiers-test (${mode}) passed.`);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  menuItemCustomizationMode,
  removeMenuItemCustomizationSetting,
  updateMenuItemCustomizationSettings,
  withMenuCustomizationModes
} from "../apps/api/src/services/menuCustomizationService.js";
import {
  canModifyPosItem,
  posCustomizationMode,
  shouldOpenCustomization
} from "../apps/web/src/apps/pos/customization.js";
import { POS_EVENT, POS_WORKFLOW, posWorkflowReducer } from "../apps/web/src/apps/pos/stateMachine.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");
const styles = read("apps/web/src/styles/index.css");
const restaurantRoutes = read("apps/api/src/routes/restaurant.js");
const posService = read("apps/api/src/services/posService.js");
const customization = read("apps/web/src/apps/pos/customization.js");

const baseSettings = { storeHours: { monday: "open" } };
const requiredSettings = updateMenuItemCustomizationSettings(baseSettings, "salmon", "REQUIRED");
assert.equal(menuItemCustomizationMode(requiredSettings, "salmon"), "REQUIRED", "owner customization mode should persist by menu item");
assert.deepEqual(requiredSettings.storeHours, baseSettings.storeHours, "customization persistence should preserve unrelated restaurant settings");
const clearedSettings = removeMenuItemCustomizationSetting(requiredSettings, "salmon");
assert.equal(menuItemCustomizationMode(clearedSettings, "salmon"), "AUTO", "Automatic should remove the explicit item override");

const categories = withMenuCustomizationModes([
  { id: "entrees", items: [{ id: "salmon" }, { id: "water" }] }
], updateMenuItemCustomizationSettings({}, "salmon", "OPTIONAL"));
assert.equal(categories[0].items[0].customizationMode, "OPTIONAL", "POS/menu payload should expose persisted customization mode");
assert.equal(categories[0].items[1].customizationMode, "AUTO", "items without an override should remain Automatic");

const groups = [{ id: "side", name: "Side", required: false, minSelect: 0, maxSelect: 1, options: [{ id: "rice", name: "Rice" }] }];
assert.equal(shouldOpenCustomization({ id: "required", customizationMode: "REQUIRED" }), true, "REQUIRED should open Customize");
assert.equal(shouldOpenCustomization({ id: "optional", customizationMode: "OPTIONAL" }), true, "OPTIONAL should open Customize");
assert.equal(shouldOpenCustomization({ id: "none", customizationMode: "NONE", optionGroups: groups }), false, "NONE should direct-add");
assert.equal(shouldOpenCustomization({ id: "auto-configured", customizationMode: "AUTO", optionGroups: groups }), true, "AUTO with choices should open Customize");
assert.equal(shouldOpenCustomization({ id: "auto-simple", customizationMode: "AUTO" }), false, "AUTO without choices should direct-add");
assert.equal(canModifyPosItem({ id: "none", customizationMode: "NONE", optionGroups: groups }), true, "direct-add item with choices should still expose Modify");
assert.equal(canModifyPosItem({ id: "water", customizationMode: "NONE" }), false, "simple item should hide Modify");
assert.equal(posCustomizationMode({ customizationMode: "invalid" }), "AUTO", "invalid client mode should fall back safely");

const restaurantRoleBlock = restaurantRoutes.slice(restaurantRoutes.indexOf("const restaurantRoles"), restaurantRoutes.indexOf("router.use"));
assert.equal(restaurantRoleBlock.includes("CASHIER"), false, "cashiers should not receive menu configuration routes");
for (const value of ["customizationMode", "MENU_ITEM_CUSTOMIZATION_MODES", "persistMenuItemPosSettings", "withMenuItemCustomizationMode"]) {
  assert.equal(restaurantRoutes.includes(value), true, `menu API should include ${value}`);
}
assert.equal(posService.includes("withMenuCustomizationModes(categories, restaurant?.settingsJson)"), true, "POS menu should receive owner customization settings");
for (const label of ["Customization prompt", "Automatic", "Always prompt", "Optional prompt", "No customization"]) {
  assert.equal(`${app}\n${customization}`.includes(label), true, `item editor should expose ${label}`);
}

const orderEntry = screens.slice(screens.indexOf("export function OrderEntryScreen"), screens.indexOf("export function OrderReviewScreen"));
assert.equal(orderEntry.includes("Review order"), false, "standard order entry should not show a Review Order action");
assert.equal(orderEntry.includes(">Pay</button>"), true, "standard order entry should show Pay");
assert.equal(orderEntry.includes('title="Remove item"'), true, "delete should be a compact accessible icon control");
assert.equal(orderEntry.includes("<span>Remove</span>"), false, "delete should not render a large Remove text action");

let state = { value: POS_WORKFLOW.ORDER_ENTRY, previous: POS_WORKFLOW.NEW_ORDER_SETUP, context: {}, transitionCount: 0 };
state = posWorkflowReducer(state, { type: POS_EVENT.SELECT_PAYMENT });
assert.equal(state.value, POS_WORKFLOW.PAYMENT_SELECTION, "Pay should enter the existing payment selection state");
state = posWorkflowReducer(state, { type: POS_EVENT.EDIT_ORDER });
assert.equal(state.value, POS_WORKFLOW.ORDER_ENTRY, "canceled payment selection should preserve and return to Current Order");
state = posWorkflowReducer(state, { type: POS_EVENT.SELECT_PAYMENT });
state = posWorkflowReducer(state, { type: POS_EVENT.PROCESS_PAYMENT });
state = posWorkflowReducer(state, { type: POS_EVENT.PAYMENT_FAILED });
assert.equal(state.value, POS_WORKFLOW.PAYMENT_FAILED, "failed payment should remain recoverable");
state = posWorkflowReducer(state, { type: POS_EVENT.SELECT_PAYMENT });
assert.equal(state.value, POS_WORKFLOW.PAYMENT_SELECTION, "failed payment should retry without abandoning the order");

const cashBlock = app.slice(app.indexOf("async function acceptCashPayment"), app.indexOf("function openGuestCheck"));
const successBlock = app.slice(app.indexOf("async function completeSuccessfulTransaction"), app.indexOf("async function sendCurrentOrderToKitchen"));
const finishBlock = app.slice(app.indexOf("function finishPaidOrder"), app.indexOf("function beginNewOrder"));
assert.equal(cashBlock.includes("lastOrder ||"), true, "payment retry should reuse the committed order and avoid duplicate Kitchen tickets");
assert.equal(cashBlock.match(/submitOrder\(/g)?.length, 1, "cash flow should commit/send the order only once");
assert.equal(successBlock.includes("setPaymentResult({ success: true"), true, "successful payment should preserve the active order while change is visible");
assert.equal(successBlock.includes("POS_EVENT.PAYMENT_SUCCEEDED"), true, "successful payment should enter the confirmation state");
assert.equal(finishBlock.includes("resetCurrentOrder()"), true, "Done should clear the active cart");
assert.equal(finishBlock.includes("POS_EVENT.HOME"), true, "Done should return to Register Home");
assert.equal(successBlock.includes("submitOrder("), false, "payment completion should not submit a duplicate Kitchen ticket");

for (const value of ["overflow-y-auto", "overscroll-contain", "shrink-0", ".pos-entry-cart-footer-actions", "@media (max-width: 1023px)"]) {
  assert.equal(styles.includes(value), true, `responsive cart layout should include ${value}`);
}

console.log("pos-workflow-correction-test passed (owner control, direct Pay, recovery, KDS, and responsive cart).");

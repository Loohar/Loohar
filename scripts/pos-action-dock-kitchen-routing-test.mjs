import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  menuItemSendToKitchen,
  updateMenuItemKitchenSettings,
  withMenuItemCustomizationMode
} from "../apps/api/src/services/menuCustomizationService.js";
import {
  emitKitchenTicketCreated,
  kitchenEligibleOrderItems,
  serializeKitchenOrder
} from "../apps/api/src/services/realtimeService.js";
import { nextPosCartLineSelectionAfterRemoval } from "../apps/web/src/apps/pos/cart.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");
const styles = read("apps/web/src/styles/index.css");
const restaurantRoutes = read("apps/api/src/routes/restaurant.js");
const posService = read("apps/api/src/services/posService.js");
const kitchenRoutes = read("apps/api/src/routes/kitchen.js");
const workflow = read("apps/api/src/services/orderWorkflowService.js");

const cartLines = [
  { cartLineId: "bowl", menuItemId: "bowl" },
  { cartLineId: "water", menuItemId: "water" },
  { cartLineId: "chips", menuItemId: "chips" }
];
assert.equal(nextPosCartLineSelectionAfterRemoval(cartLines, "water", "water"), "chips", "deleting the selected line should select its next neighbor");
assert.equal(nextPosCartLineSelectionAfterRemoval(cartLines, "chips", "chips"), "water", "deleting the last selected line should select its previous neighbor");
assert.equal(nextPosCartLineSelectionAfterRemoval(cartLines, "water", "bowl"), "bowl", "deleting another line should preserve the active selection");
assert.equal(nextPosCartLineSelectionAfterRemoval(cartLines, "water", "missing"), "", "stale selections should clear safely");

const baseSettings = { storeHours: { monday: "open" } };
const packagedSettings = updateMenuItemKitchenSettings(baseSettings, "water", false);
assert.equal(menuItemSendToKitchen(packagedSettings, "water"), false, "owner configuration should exclude a packaged item from Kitchen");
assert.equal(menuItemSendToKitchen(packagedSettings, "bowl"), true, "unconfigured items should preserve existing Kitchen behavior");
assert.deepEqual(packagedSettings.storeHours, baseSettings.storeHours, "Kitchen configuration should preserve unrelated restaurant settings");
assert.equal(withMenuItemCustomizationMode({ id: "water" }, packagedSettings).sendToKitchen, false, "menu payloads should expose Kitchen eligibility");
assert.equal(menuItemSendToKitchen(updateMenuItemKitchenSettings(packagedSettings, "water", true), "water"), true, "re-enabling Kitchen should remove the false override");

const kitchenItem = { id: "order-bowl", menuItemId: "bowl", name: "Tandoori Chicken Bowl", quantity: 1, unitPriceCents: 1499, optionsJson: { sendToKitchen: true } };
const packagedItem = { id: "order-water", menuItemId: "water", name: "Bottled Water", quantity: 2, unitPriceCents: 299, optionsJson: { sendToKitchen: false } };
const legacyItem = { id: "order-legacy", menuItemId: "legacy", name: "Legacy item", quantity: 1, unitPriceCents: 500, optionsJson: {} };
assert.deepEqual(kitchenEligibleOrderItems([kitchenItem, packagedItem, legacyItem]).map((item) => item.id), ["order-bowl", "order-legacy"], "KDS should include eligible and legacy-default lines but exclude configured packaged lines");

const mixedOrder = {
  id: "order-1",
  restaurantId: "restaurant-1",
  locationId: "location-1",
  orderNumber: "POS-1",
  type: "WALK_IN",
  status: "PENDING",
  subtotalCents: 2097,
  discountCents: 0,
  deliveryFeeCents: 0,
  taxCents: 173,
  tipCents: 0,
  totalCents: 2270,
  createdAt: new Date("2026-08-10T12:00:00.000Z"),
  updatedAt: new Date("2026-08-10T12:00:00.000Z"),
  items: [kitchenItem, packagedItem],
  statusHistory: []
};
const ticket = serializeKitchenOrder(mixedOrder);
assert.deepEqual(ticket.items.map((item) => item.id), ["order-bowl"], "mixed Kitchen tickets should contain only eligible lines");
assert.equal(ticket.totalCents, mixedOrder.totalCents, "KDS filtering should not recalculate or change the paid order total");
assert.equal(mixedOrder.items.length, 2, "KDS serialization should not mutate the customer order");
assert.equal(emitKitchenTicketCreated({ ...mixedOrder, items: [packagedItem] }), null, "packaged-only orders should not emit empty Kitchen tickets");
assert.deepEqual(emitKitchenTicketCreated(mixedOrder)?.ticket.items.map((item) => item.id), ["order-bowl"], "realtime Kitchen events should carry only eligible lines");

const orderEntry = screens.slice(screens.indexOf("export function OrderEntryScreen"), screens.indexOf("export function OrderReviewScreen"));
for (const marker of ["selectedCartLineId", "pos-entry-action-dock", "selectedLine ?", "aria-selected", "runLineAction", "Modify", "Repeat", "Delete"]) {
  assert.equal(orderEntry.includes(marker), true, `order entry should include ${marker}`);
}
assert.ok(orderEntry.indexOf("pos-entry-menu-scroll") < orderEntry.indexOf("pos-entry-action-dock"), "the action dock should sit after the scrollable menu region");
for (const marker of [".pos-entry-menu-scroll", "overflow-y-auto", ".pos-entry-action-dock", "shrink-0", ".pos-entry-cart-lines", ".pos-entry-cart-footer", "grid-cols-2"]) {
  assert.equal(styles.includes(marker), true, `responsive POS styles should include ${marker}`);
}
assert.ok(app.includes("nextPosCartLineSelectionAfterRemoval") && app.includes("setSelectedCartLineId"), "cart deletion should update selection through the tested helper");
assert.ok(app.includes("replacePosCartLineConfiguration") && app.includes("void calculateQuote(updatedCart)"), "Modify should update the same line and refresh its quote");

for (const marker of ["sendToKitchen", "Kitchen preparation", "Enable for items that require kitchen or bar preparation."]) {
  assert.equal(`${app}\n${restaurantRoutes}`.includes(marker), true, `Menu/Catalog configuration should expose ${marker}`);
}
assert.equal(restaurantRoutes.slice(restaurantRoutes.indexOf("const restaurantRoles"), restaurantRoutes.indexOf("router.use")).includes("CASHIER"), false, "cashiers should not receive Menu/Catalog configuration routes");
assert.ok(posService.includes("menuItemSendToKitchen(orderConfiguration.settingsJson, menuItem.id)"), "quote creation should resolve Kitchen eligibility on the server");
assert.ok(posService.includes("sendToKitchen: line.sendToKitchen !== false"), "order items should snapshot Kitchen eligibility at commit");
assert.ok(posService.includes("kitchenLineItems.length ? await tx.posReceipt.create"), "packaged-only orders should not create an empty persisted Kitchen ticket");
assert.equal(posService.match(/emitKitchenTicketCreated\(result\.order\)/g)?.length, 1, "the post-commit path should emit at most one Kitchen-created event");
assert.ok(kitchenRoutes.includes("orders.map(kdsOrder).filter((order) => order.items.length > 0)"), "Kitchen reconciliation should omit packaged-only orders");
assert.ok(workflow.includes('kitchenOnly: receiptType === "KITCHEN_TICKET"'), "printed Kitchen tickets should filter lines while customer receipts keep all items");
assert.ok(posService.includes("subtotalCents = normalizedItems.reduce"), "payment totals should continue to include every quoted line");

console.log("pos-action-dock-kitchen-routing-test passed (dock selection, owner metadata, mixed KDS, and packaged-only suppression).");

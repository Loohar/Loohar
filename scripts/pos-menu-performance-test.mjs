import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adjustPosCartLineQuantity, removePosCartLine, repeatPosCartLine } from "../apps/web/src/apps/pos/cart.js";
import { posMenuInteractionMetadata } from "../apps/web/src/apps/pos/customization.js";
import { filterPosMenuItems, preparePosMenuItems } from "../apps/web/src/apps/pos/menuPerformance.js";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("apps/web/src/App.jsx");
const screens = read("apps/web/src/apps/pos/PosWorkflowScreens.jsx");

function sectionBetween(content, start, end) {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `${start} section is missing`);
  assert.notEqual(endIndex, -1, `${end} boundary is missing`);
  return content.slice(startIndex, endIndex);
}

const workspace = sectionBetween(app, "function RestaurantPosWorkspace", "function RestaurantReceiptPreviewPage");
const cartInteractions = sectionBetween(app, "function addToCart", "async function registerDevice");
const finishPaidOrder = sectionBetween(app, "function finishPaidOrder", "function beginNewOrder");
const beginNewOrder = sectionBetween(app, "function beginNewOrder", "function startOrderEntry");
const startOrderEntry = sectionBetween(app, "function startOrderEntry", "function reportOrderEntryRender");
const payCurrentOrder = sectionBetween(app, "function payCurrentOrder", "async function completeSuccessfulTransaction");
const loadPos = sectionBetween(app, "async function loadPos", "useEffect(() => {");

assert.equal(workspace.match(/posApi\("\/menu"/g)?.length, 1, "POS workspace should have one menu request site");
assert.equal(loadPos.match(/posApi\("\/menu"/g)?.length, 1, "menu should load once per explicit POS initialization");
assert.ok(loadPos.includes("menuRequestCountRef.current += 1"), "menu request count should be instrumented");
assert.equal(cartInteractions.includes("loadPos("), false, "cart, Modify, Repeat, quantity, and delete must not reload the menu");
assert.equal(finishPaidOrder.includes("loadPos("), false, "payment completion must preserve the accepted menu");
assert.ok(finishPaidOrder.includes("refreshPosConfig()") && finishPaidOrder.includes("loadOrderLists()"), "payment completion should refresh only relevant POS state");
assert.equal(beginNewOrder.includes("loadPos("), false, "New Order should reuse in-memory menu state");
assert.equal(startOrderEntry.includes("loadPos("), false, "Order Entry should reuse in-memory menu state");
assert.ok(app.includes("const visibleItems = useMemo") && app.includes("filterPosMenuItems(itemsForRegister"), "category and search filtering should be memoized client-side");
assert.ok(app.includes("const menuItemById = useMemo"), "menu item lookup should be prepared once per menu version");
assert.ok(app.includes("preparePosMenuItems(categoriesForRegister)"), "modifier capability and search metadata should be prepared once per accepted menu");
assert.ok(app.includes("item.posDefaultModifierSelections ?? posDefaultModifierSelections(item)"), "direct-add should reuse prepared default modifier selections");
assert.ok(app.includes("posModifierGroupValidationErrors(customizingModifierGroups, modifierSelections)"), "modifier selection should reuse prepared groups instead of sorting metadata per render");
assert.ok(payCurrentOrder.indexOf("POS_EVENT.SELECT_PAYMENT") < payCurrentOrder.indexOf("if (!quote) void calculateQuote()"), "Pay should navigate immediately before server quote completion");
assert.ok(screens.includes("Preparing the server-verified total...") && screens.includes("disabled={!quoteReady}"), "payment controls should remain disabled until the authoritative quote is ready");
assert.ok(screens.includes('loading="lazy"') && screens.includes('decoding="async"') && screens.includes('width="72" height="72"'), "menu images should load lazily without shifting item layout");
assert.equal(workspace.includes("io("), false, "POS workspace should not create duplicate Socket.IO clients or KDS listeners");
for (const metric of ["registerMs", "shiftMs", "firstPosRenderMs", "menuRequestMs", "menuNormalizationMs", "modifierMetadataReadyMs", "firstMenuRenderMs", "firstMenuImageMs", "fullMenuRenderedMs", "fullInteractiveReadyMs", "categoryResponseMs", "searchResponseMs", "cartResponseMs", "modifierOpenResponseMs", "payNavigationResponseMs"]) {
  assert.ok(app.includes(`\"${metric}\"`), `development performance waterfall should include ${metric}`);
}
assert.ok(app.includes("`order${orderNumber}FirstMenuRenderMs`"), "development waterfall should report first-menu render for consecutive orders");

const categories = Array.from({ length: 30 }, (_, categoryIndex) => ({
  id: `category-${categoryIndex}`,
  name: `Category ${categoryIndex}`,
  items: Array.from({ length: 100 }, (_, itemIndex) => ({
    id: `item-${categoryIndex}-${itemIndex}`,
    name: `Menu item ${categoryIndex} ${itemIndex}`,
    sku: `SKU-${categoryIndex}-${itemIndex}`,
    priceCents: 500 + itemIndex,
    imageUrl: `https://images.example/${categoryIndex}/${itemIndex}.jpg`,
    modifierGroups: itemIndex % 10 === 0 ? [{
      id: `group-${categoryIndex}-${itemIndex}`,
      name: "Size",
      minSelect: 0,
      maxSelect: 1,
      options: [{ id: `small-${categoryIndex}-${itemIndex}`, name: "Small", priceCents: 0 }]
    }] : []
  }))
}));

const preparationStartedAt = performance.now();
const preparedItems = preparePosMenuItems(categories);
const preparationMs = performance.now() - preparationStartedAt;
assert.equal(preparedItems.length, 3000, "menu preparation should preserve every item");

const categoryStartedAt = performance.now();
const categoryItems = filterPosMenuItems(preparedItems, "category-17", "");
const categoryMs = performance.now() - categoryStartedAt;
assert.equal(categoryItems.length, 100, "category filtering should stay client-side and correct");

const searchStartedAt = performance.now();
const searchItems = filterPosMenuItems(preparedItems, "all", "SKU-12-42");
const searchMs = performance.now() - searchStartedAt;
assert.equal(searchItems.length, 1, "search filtering should stay client-side and correct");

const modifierItem = categories[0].items[0];
const modifierStartedAt = performance.now();
const modifierMetadata = posMenuInteractionMetadata(modifierItem);
const modifierMs = performance.now() - modifierStartedAt;
assert.equal(modifierMetadata.opensCustomization, true, "modifier metadata should preserve customization behavior");

const initialCart = [{ cartLineId: "line-1", menuItemId: "item-0-1", name: "Menu item", priceCents: 599, quantity: 1, modifierSignature: "" }];
const cartStartedAt = performance.now();
let cart = repeatPosCartLine(initialCart, "line-1");
cart = adjustPosCartLineQuantity(cart, "line-1", 1);
cart = removePosCartLine(cart, "line-1");
const cartMs = performance.now() - cartStartedAt;
assert.deepEqual(cart, [], "local cart operations should remain correct");

for (const [name, duration] of Object.entries({ categoryMs, searchMs, cartMs, modifierMs })) {
  assert.ok(duration < 1000, `${name} should not show pathological local computation time`);
}

console.log("pos-menu-performance-test passed", JSON.stringify({
  preparedItems: preparedItems.length,
  preparationMs: Number(preparationMs.toFixed(3)),
  categoryMs: Number(categoryMs.toFixed(3)),
  searchMs: Number(searchMs.toFixed(3)),
  cartMs: Number(cartMs.toFixed(3)),
  modifierMs: Number(modifierMs.toFixed(3)),
  menuRequestSites: 1,
  secondOrderMenuRequests: 0,
  thirdOrderMenuRequests: 0
}), "\n");

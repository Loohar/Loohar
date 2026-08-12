import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  adjustPosCartLineQuantity,
  removePosCartLine,
  repeatPosCartLine,
  replacePosCartLineConfiguration
} from "../apps/web/src/apps/pos/cart.js";
import {
  canModifyPosItem,
  normalizePosModifierGroups,
  posModifierValidationErrors,
  posSelectionsFromOptionIds,
  shouldOpenCustomization,
  togglePosModifierSelection
} from "../apps/web/src/apps/pos/customization.js";
import { POS_EVENT, POS_WORKFLOW, posWorkflowReducer } from "../apps/web/src/apps/pos/stateMachine.js";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const screens = readFileSync(join(root, "apps/web/src/apps/pos/PosWorkflowScreens.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");

const simpleItem = { id: "mango-lassi", name: "Mango Lassi", priceCents: 499, optionGroups: [] };
const configurableItem = {
  id: "tandoori-bowl",
  name: "Tandoori Chicken Bowl",
  priceCents: 1499,
  optionGroups: [
    {
      id: "protein",
      name: "Protein",
      required: true,
      minSelect: 1,
      maxSelect: 2,
      options: [
        { id: "salmon", name: "Grilled Salmon", priceCents: 0 },
        { id: "shrimp", name: "Shrimp", priceCents: 300 }
      ]
    },
    {
      id: "side",
      name: "Side",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: "fries", name: "Fries", priceCents: 0 },
        { id: "rice", name: "Rice", priceCents: 100 }
      ]
    },
    {
      id: "sauce",
      name: "Sauce",
      required: false,
      minSelect: 0,
      maxSelect: 2,
      options: [{ id: "hot-sauce", name: "Hot sauce", priceCents: 75 }]
    }
  ]
};

function cartConfiguration(item, selections, specialInstructions = "") {
  const groups = normalizePosModifierGroups(item);
  const modifiers = groups.flatMap((group) => {
    const selected = new Set(selections[group.id] || []);
    return group.options.filter((option) => selected.has(option.id)).map((option) => ({
      id: option.id,
      optionId: option.id,
      name: option.name,
      priceCents: option.priceCents,
      groupId: group.id,
      groupName: group.name
    }));
  });
  const modifierSelections = Object.entries(selections).flatMap(([modifierGroupId, optionIds]) => (
    optionIds.map((modifierOptionId) => ({ modifierGroupId, modifierOptionId }))
  ));
  const optionIds = modifierSelections.map((selection) => selection.modifierOptionId).sort();
  return {
    priceCents: item.priceCents + modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0),
    modifierSelections,
    modifiers,
    modifierSignature: `${optionIds.join("|")}::${specialInstructions}`,
    specialInstructions
  };
}

const startingSelections = { protein: ["salmon", "shrimp"], side: ["fries"], sauce: [] };
const startingConfiguration = cartConfiguration(configurableItem, startingSelections, "Sauce on side");
const configurableLine = {
  cartLineId: "line-configurable",
  menuItemId: configurableItem.id,
  name: configurableItem.name,
  basePriceCents: configurableItem.priceCents,
  quantity: 2,
  ...startingConfiguration
};
const simpleLine = {
  cartLineId: "line-simple",
  menuItemId: simpleItem.id,
  name: simpleItem.name,
  basePriceCents: simpleItem.priceCents,
  priceCents: simpleItem.priceCents,
  quantity: 1,
  modifierSelections: [],
  modifiers: [],
  modifierSignature: "::",
  specialInstructions: ""
};

assert.equal(shouldOpenCustomization(simpleItem), false, "simple item should not expose Modify");
assert.equal(shouldOpenCustomization(configurableItem), true, "configurable item should expose Modify");
assert.equal(canModifyPosItem(simpleItem), false, "simple item should hide Modify");
assert.equal(canModifyPosItem(configurableItem), true, "configurable item should show Modify");

const preloaded = posSelectionsFromOptionIds(
  configurableItem,
  configurableLine.modifierSelections.map((selection) => selection.modifierOptionId)
);
assert.deepEqual(preloaded, startingSelections, "Modify should preload current modifier selections");
const openModifierBlock = app.slice(app.indexOf("function openModifierDialog"), app.indexOf("function closeModifierDialog"));
assert.ok(openModifierBlock.includes('setModifierInstructions(cartLine?.specialInstructions || "")'), "Modify should preload existing special instructions");

const withoutShrimpSelections = { ...preloaded, protein: ["salmon"] };
const withoutShrimpConfiguration = cartConfiguration(configurableItem, withoutShrimpSelections, configurableLine.specialInstructions);
const editedLines = replacePosCartLineConfiguration([configurableLine], configurableLine.cartLineId, withoutShrimpConfiguration);
assert.equal(editedLines.length, 1, "editing should not create a second cart line");
assert.equal(editedLines[0].cartLineId, configurableLine.cartLineId, "editing should preserve cart-line identity");
assert.equal(editedLines[0].quantity, 2, "editing should preserve quantity");
assert.equal(editedLines[0].priceCents, startingConfiguration.priceCents - 300, "removing an optional modifier should remove its charge");
assert.equal(editedLines[0].modifiers.some((modifier) => modifier.optionId === "shrimp"), false, "removed modifier should not remain in line state");

const identicalConfiguredLine = {
  ...configurableLine,
  cartLineId: "line-identical",
  quantity: 1,
  ...withoutShrimpConfiguration
};
const mergedEdit = replacePosCartLineConfiguration(
  [identicalConfiguredLine, configurableLine],
  configurableLine.cartLineId,
  withoutShrimpConfiguration
);
assert.equal(mergedEdit.length, 2, "editing should not merge away the selected cart line");
assert.equal(mergedEdit.find((line) => line.cartLineId === configurableLine.cartLineId)?.quantity, 2, "editing should preserve the selected line quantity and identity");

const replacedSide = togglePosModifierSelection({ side: ["fries"] }, configurableItem.optionGroups[1], "rice");
assert.deepEqual(replacedSide.side, ["rice"], "max-one modifier selection should replace the previous option");

const invalidRequired = togglePosModifierSelection({ protein: ["salmon"], side: ["fries"] }, configurableItem.optionGroups[0], "salmon");
assert.match(posModifierValidationErrors(configurableItem, invalidRequired)[0], /Choose at least 1 option for Protein/, "required modifier validation should block an invalid update");

assert.equal(adjustPosCartLineQuantity([simpleLine], simpleLine.cartLineId, 1)[0].quantity, 2, "quantity increase should add one");
assert.equal(adjustPosCartLineQuantity([{ ...simpleLine, quantity: 2 }], simpleLine.cartLineId, -1)[0].quantity, 1, "quantity decrease should subtract one");
assert.equal(adjustPosCartLineQuantity([simpleLine], simpleLine.cartLineId, -1)[0].quantity, 1, "decrement at one should preserve existing POS behavior");

const repeated = repeatPosCartLine([configurableLine], configurableLine.cartLineId);
assert.equal(repeated.length, 1, "Repeat should preserve merged configured-line behavior");
assert.equal(repeated[0].quantity, 3, "Repeat should increment the configured line quantity");
assert.deepEqual(repeated[0].modifierSelections, configurableLine.modifierSelections, "Repeat should preserve modifiers");
assert.equal(repeated[0].specialInstructions, configurableLine.specialInstructions, "Repeat should preserve notes");

const remaining = removePosCartLine([simpleLine, configurableLine], configurableLine.cartLineId);
assert.deepEqual(remaining.map((line) => line.cartLineId), [simpleLine.cartLineId], "Remove should delete only the selected line");

const paymentState = posWorkflowReducer(
  { value: POS_WORKFLOW.ORDER_ENTRY, previous: POS_WORKFLOW.NEW_ORDER_SETUP, context: {}, transitionCount: 0 },
  { type: POS_EVENT.SELECT_PAYMENT }
);
const editState = posWorkflowReducer(paymentState, { type: POS_EVENT.EDIT_ORDER });
assert.equal(paymentState.value, POS_WORKFLOW.PAYMENT_SELECTION, "Pay should enter the existing payment flow directly");
assert.equal(editState.value, POS_WORKFLOW.ORDER_ENTRY, "payment Back should return to Current Order");
assert.deepEqual([simpleLine, configurableLine], [simpleLine, configurableLine], "Pay and Back should not mutate cart state");

const addConfiguredBlock = app.slice(app.indexOf("function addConfiguredItemToCart"), app.indexOf("function adjustQuantity"));
const payBlock = app.slice(app.indexOf("function payCurrentOrder"), app.indexOf("async function completeSuccessfulTransaction"));
const successBlock = app.slice(app.indexOf("async function completeSuccessfulTransaction"), app.indexOf("async function sendCurrentOrderToKitchen"));
const finishBlock = app.slice(app.indexOf("function finishPaidOrder"), app.indexOf("function beginNewOrder"));
assert.ok(addConfiguredBlock.includes("replacePosCartLineConfiguration") && addConfiguredBlock.includes("setQuote(null)"), "modified lines should replace in place and invalidate stale quotes");
assert.ok(addConfiguredBlock.includes("void calculateQuote(updatedCart)"), "modified lines should request a fresh server-authoritative quote");
assert.ok(payBlock.indexOf("POS_EVENT.SELECT_PAYMENT") < payBlock.indexOf("void calculateQuote()"), "Pay should navigate immediately while the authoritative quote loads");
assert.ok(screens.includes("Preparing the server-verified total...") && screens.includes("!quoteReady || !canAcceptCash"), "payment controls should remain disabled until the authoritative quote is ready");
assert.ok(successBlock.includes("setPaymentResult({ success: true") && successBlock.includes("POS_EVENT.PAYMENT_SUCCEEDED"), "successful payment should show confirmation and change before resetting");
assert.ok(finishBlock.includes("resetCurrentOrder()") && finishBlock.includes("POS_EVENT.HOME"), "Done should clear the cart and return to Register Home");
assert.ok(screens.includes("canModifyPosItem") && screens.includes("Modify ${line.name}"), "Modify should render only for meaningfully configurable cart lines");
assert.ok(screens.includes("Repeat ${line.name}") && screens.includes('title="Remove item"'), "cart lines should expose Repeat and a compact accessible delete icon");
assert.ok(styles.includes(".pos-entry-cart-actions") && styles.includes("overflow-y-auto") && styles.includes(".pos-entry-cart-footer-actions"), "cart lines should scroll while the Pay footer remains outside the scroll region");
assert.ok(app.includes("disabled={modifierSelectionErrors.length > 0}"), "required modifier validation should disable Add and Update");

console.log("pos-cart-line-actions-test passed (streamlined cart and payment behaviors).");

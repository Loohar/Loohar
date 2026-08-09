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
assert.equal(mergedEdit.length, 1, "editing to an identical configuration should preserve merged-line behavior");
assert.equal(mergedEdit[0].quantity, 3, "merged edit should preserve the quantities of both configured lines");

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

const reviewState = posWorkflowReducer(
  { value: POS_WORKFLOW.ORDER_ENTRY, previous: POS_WORKFLOW.NEW_ORDER_SETUP, context: {}, transitionCount: 0 },
  { type: POS_EVENT.REVIEW_ORDER }
);
const editState = posWorkflowReducer(reviewState, { type: POS_EVENT.EDIT_ORDER });
assert.equal(reviewState.value, POS_WORKFLOW.ORDER_REVIEW, "Review should enter order review");
assert.equal(editState.value, POS_WORKFLOW.ORDER_ENTRY, "Back/Edit should return to order entry");
assert.deepEqual([simpleLine, configurableLine], [simpleLine, configurableLine], "Review and Back should not mutate cart state");

const addConfiguredBlock = app.slice(app.indexOf("function addConfiguredItemToCart"), app.indexOf("function adjustQuantity"));
const reviewBlock = app.slice(app.indexOf("async function reviewCurrentOrder"), app.indexOf("async function sendCurrentOrderToKitchen"));
const reviewWorkflowBlock = app.slice(app.indexOf("case POS_WORKFLOW.ORDER_REVIEW"), app.indexOf("case POS_WORKFLOW.PAYMENT_SELECTION"));
assert.ok(addConfiguredBlock.includes("replacePosCartLineConfiguration") && addConfiguredBlock.includes("setQuote(null)"), "modified lines should replace in place and invalidate stale quotes");
assert.ok(reviewBlock.includes("await calculateQuote()"), "review should request a fresh server-authoritative quote");
assert.ok(reviewWorkflowBlock.includes("POS_EVENT.EDIT_ORDER") && !reviewWorkflowBlock.includes("setCart("), "Review Back/Edit should preserve the current cart");
assert.ok(screens.includes("canModify ?") && screens.includes("Modify ${line.name}"), "Modify should render only for configurable cart lines");
assert.ok(screens.includes("Repeat ${line.name}") && screens.includes("Remove ${line.name}"), "cart lines should expose obvious Repeat and Remove actions");
assert.ok(styles.includes(".pos-entry-cart-actions") && styles.includes("grid-cols-[minmax(0,1fr)_auto]"), "phone actions should wrap into a secondary row without horizontal scrolling");

console.log("pos-cart-line-actions-test passed (18 focused behaviors).");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizePosModifierGroups,
  posModifierConfigurationError,
  shouldOpenCustomization
} from "../apps/web/src/apps/pos/customization.js";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const workflowScreens = readFileSync(join(root, "apps/web/src/apps/pos/PosWorkflowScreens.jsx"), "utf8");

function option(id, name, extra = {}) {
  return { id, name, priceCents: 0, available: true, ...extra };
}

const simpleItem = {
  id: "bottled-water",
  name: "Bottled Water",
  priceCents: 249,
  optionGroups: [],
  options: []
};

const optionalItem = {
  id: "latte",
  name: "Latte",
  priceCents: 525,
  optionGroups: [
    {
      id: "milk",
      menuItemId: "latte",
      name: "Milk",
      required: false,
      minSelect: 0,
      maxSelect: 1,
      options: [option("oat", "Oat milk", { priceCents: 75 })]
    }
  ]
};

const requiredItem = {
  id: "rice-bowl",
  name: "Rice Bowl",
  priceCents: 1295,
  optionGroups: [
    {
      id: "protein",
      menuItemId: "rice-bowl",
      name: "Protein",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      options: [option("chicken", "Chicken")]
    }
  ]
};

const emptyOptionalGroupItem = {
  id: "packaged-chips",
  name: "Packaged Chips",
  priceCents: 299,
  optionGroups: [
    {
      id: "empty",
      menuItemId: "packaged-chips",
      name: "Placeholder",
      required: false,
      options: []
    }
  ]
};

const emptyRequiredGroupItem = {
  id: "misconfigured-bowl",
  name: "Misconfigured Bowl",
  priceCents: 1295,
  optionGroups: [
    {
      id: "required-empty",
      menuItemId: "misconfigured-bowl",
      name: "Protein",
      required: true,
      minSelect: 1,
      options: [{ id: "stale-option", name: "Stale option", available: false }]
    }
  ]
};

const unrelatedModifierItem = {
  id: "sparkling-water",
  name: "Sparkling Water",
  priceCents: 349,
  optionGroups: [
    {
      id: "protein",
      menuItemId: "rice-bowl",
      name: "Protein",
      required: true,
      minSelect: 1,
      options: [option("tofu", "Tofu", { menuItemId: "rice-bowl" })]
    }
  ]
};

const explicitItem = {
  id: "chef-special",
  name: "Chef Special",
  priceCents: 1895,
  requiresCustomization: true,
  optionGroups: []
};

assert.equal(shouldOpenCustomization(simpleItem), false, "item with no modifiers should bypass customization");
assert.equal(normalizePosModifierGroups(simpleItem).length, 0, "simple item should have zero meaningful groups");

assert.equal(shouldOpenCustomization(optionalItem), true, "optional active modifiers should open customization");
assert.equal(shouldOpenCustomization(requiredItem), true, "required active modifiers should open customization");
assert.equal(normalizePosModifierGroups(requiredItem)[0].options[0].id, "chicken", "configurable item should preserve selectable modifier options");

assert.equal(shouldOpenCustomization(emptyOptionalGroupItem), false, "empty optional group should not open a useless customization modal");
assert.equal(posModifierConfigurationError(emptyOptionalGroupItem), "", "empty optional group should remain a direct-add item");
assert.equal(shouldOpenCustomization(emptyRequiredGroupItem), false, "empty required group should not open a useless customization modal");
assert.match(posModifierConfigurationError(emptyRequiredGroupItem), /has no selectable options/, "empty required group should surface a configuration error");

assert.equal(shouldOpenCustomization(unrelatedModifierItem), false, "item should not inherit another item's modifier group");
assert.equal(normalizePosModifierGroups(unrelatedModifierItem).length, 0, "unrelated item-specific groups should be ignored");

assert.equal(shouldOpenCustomization(explicitItem), true, "explicit item configuration can require customization");

const addToCartBlock = app.slice(app.indexOf("function addToCart(item)"), app.indexOf("function openModifierDialog(item)"));
assert.ok(addToCartBlock.includes("posModifierConfigurationError(item)"), "POS tap path should guard invalid required modifier configuration");
assert.ok(addToCartBlock.includes("shouldOpenCustomization(item)"), "POS tap path should use the canonical customization decision");
assert.ok(addToCartBlock.includes("addConfiguredItemToCart(item)"), "simple POS item should direct-add through the existing cart path");

assert.ok(app.includes("quantity: 1"), "new direct-add line should add exactly one item");
assert.ok(app.includes("quantity: line.quantity + 1"), "repeated direct-add should increment existing quantity");
assert.ok(app.includes("modifierSelections: modifierSelectionsPayload"), "configured item should preserve selected modifiers");
assert.ok(app.includes("selectedPosModifierRows(item, selections)"), "configured item should preserve modifier row details");
assert.ok(app.includes("modifierSignature: signature"), "cart should keep modifier-aware line signatures");
assert.ok(app.includes("modifierSelections: canonicalPosLineModifierSelections(line)"), "review/order quote payload should include canonical modifier selections");
assert.ok(workflowScreens.includes("shouldOpenCustomization(item)"), "customize badge should use the same decision as item taps");
assert.ok(workflowScreens.includes("Review order"), "review order action should remain available after direct-add");

console.log("pos-simple-items-test passed.");

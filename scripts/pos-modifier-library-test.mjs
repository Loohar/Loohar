import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizePosModifierGroups,
  posDefaultModifierSelections,
  posModifierValidationErrors,
  posSelectionsFromOptionIds,
  shouldOpenCustomization,
  togglePosModifierSelection
} from "../apps/web/src/apps/pos/customization.js";
import { replacePosCartLineConfiguration } from "../apps/web/src/apps/pos/cart.js";
import { validateSelectedModifiers } from "../apps/api/src/services/posService.js";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const restaurantRoutes = readFileSync(join(root, "apps/api/src/routes/restaurant.js"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");

const option = (id, name, priceCents = 0, extra = {}) => ({ id, name, priceCents, ...extra });
const group = (id, name, options, extra = {}) => ({
  id,
  name,
  required: false,
  minSelect: 0,
  maxSelect: 1,
  sortOrder: 0,
  options,
  ...extra
});
const canonical = (modifierGroupId, modifierOptionId) => ({ modifierGroupId, modifierOptionId });

const preparedFood = {
  id: "tandoori-bowl",
  name: "Tandoori Chicken Bowl",
  priceCents: 1499,
  optionGroups: [
    group("protein", "Protein", [
      option("chicken", "Chicken", 0, { isDefault: true }),
      option("lamb", "Lamb", 200),
      option("paneer", "Paneer", 100)
    ], { required: true, minSelect: 1, maxSelect: 1 }),
    group("cheese", "Cheese", [
      option("cheddar", "Cheddar", 75),
      option("extra-cheese", "Extra cheese", 125)
    ], { maxSelect: 2 }),
    group("veggies", "Veggies", [
      option("lettuce", "Lettuce", 0, { isDefault: true }),
      option("tomato", "Tomato", 0, { isDefault: true }),
      option("onion", "Onion"),
      option("jalapeno", "Jalapeno")
    ], { maxSelect: 3 }),
    group("condiments", "Condiments", [
      option("hot-sauce", "Hot sauce"),
      option("garlic-sauce", "Garlic sauce"),
      option("sauce-side", "Sauce on side")
    ], { maxSelect: 3 })
  ]
};

const barDrink = {
  id: "whiskey",
  name: "Whiskey",
  priceCents: 800,
  optionGroups: [
    group("pour-size", "Pour Size", [
      option("single", "Single", 0, { isDefault: true }),
      option("double", "Double", 400)
    ], { required: true, minSelect: 1, maxSelect: 1 }),
    group("mixer", "Mixer", [
      option("coke", "Coke"),
      option("ginger-ale", "Ginger Ale"),
      option("soda-water", "Soda Water")
    ], { maxSelect: 1 }),
    group("garnish", "Garnish", [
      option("lime", "Lime"),
      option("lemon", "Lemon"),
      option("orange", "Orange"),
      option("cherry", "Cherry")
    ], { maxSelect: 4 }),
    group("ice", "Ice", [
      option("no-ice", "No ice"),
      option("light-ice", "Light ice"),
      option("regular-ice", "Regular ice")
    ], { maxSelect: 1 })
  ]
};

const packagedItem = {
  id: "bottled-water",
  name: "Bottled Water",
  priceCents: 249,
  optionGroups: []
};

const explicitPackagedItem = {
  ...packagedItem,
  id: "chips-salsa-pack",
  name: "Packaged Chips",
  optionGroups: [group("dip", "Dip", [option("salsa", "Salsa", 50)], { maxSelect: 1 })]
};

assert.equal(shouldOpenCustomization(packagedItem), false, "packaged item with no assigned groups should direct-add");
assert.equal(shouldOpenCustomization(explicitPackagedItem), true, "packaged item with an explicit group should open modifiers");
assert.equal(shouldOpenCustomization(preparedFood), true, "prepared food with assigned groups should open modifiers");
assert.equal(shouldOpenCustomization(barDrink), true, "bar item with assigned groups should open modifiers");
assert.deepEqual(posDefaultModifierSelections(preparedFood), {
  protein: ["chicken"],
  cheese: [],
  veggies: ["lettuce", "tomato"],
  condiments: []
}, "defaults should come from assigned options");

assert.deepEqual(
  togglePosModifierSelection({ veggies: ["lettuce", "tomato", "onion"] }, preparedFood.optionGroups[2], "jalapeno").veggies,
  ["lettuce", "tomato", "onion"],
  "multi-select groups should enforce maximum selections locally"
);
assert.deepEqual(
  togglePosModifierSelection({ pour: ["single"] }, { id: "pour", maxSelect: 1 }, "double").pour,
  ["double"],
  "single-select groups should replace the current option"
);
assert.match(
  posModifierValidationErrors(preparedFood, { protein: [], veggies: ["lettuce"], cheese: [], condiments: [] })[0],
  /Choose at least 1 option for Protein/,
  "required single-select validation should block save"
);

const preparedSelection = validateSelectedModifiers(preparedFood, {
  modifierSelections: [
    canonical("protein", "lamb"),
    canonical("cheese", "cheddar"),
    canonical("veggies", "lettuce"),
    canonical("condiments", "sauce-side")
  ]
});
assert.equal(
  preparedSelection.modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0),
  275,
  "prepared food modifier price deltas should total once"
);

const barSelection = validateSelectedModifiers(barDrink, {
  modifierSelections: [canonical("pour-size", "double"), canonical("garnish", "orange")]
});
assert.equal(barSelection.modifiers.find((modifier) => modifier.optionId === "double").priceCents, 400, "bar double pour should carry its price delta");

assert.throws(
  () => validateSelectedModifiers(preparedFood, {
    modifierSelections: [
      canonical("protein", "lamb"),
      canonical("veggies", "lettuce"),
      canonical("veggies", "tomato"),
      canonical("veggies", "onion"),
      canonical("veggies", "jalapeno")
    ]
  }),
  (error) => error?.code === "POS_MODIFIER_MAXIMUM",
  "server validation should reject too many selected modifiers"
);

const originalLine = {
  cartLineId: "line-1",
  menuItemId: preparedFood.id,
  quantity: 2,
  priceCents: preparedFood.priceCents + 275,
  modifierSelections: [canonical("protein", "lamb"), canonical("cheese", "cheddar")],
  modifiers: preparedSelection.modifiers,
  specialInstructions: "Sauce on side"
};
const nextSelections = posSelectionsFromOptionIds(preparedFood, ["paneer", "lettuce"]);
const nextModifiers = normalizePosModifierGroups(preparedFood).flatMap((modifierGroup) => {
  const selected = new Set(nextSelections[modifierGroup.id] || []);
  return modifierGroup.options.filter((modifierOption) => selected.has(modifierOption.id)).map((modifierOption) => ({
    id: modifierOption.id,
    optionId: modifierOption.id,
    name: modifierOption.name,
    priceCents: modifierOption.priceCents,
    groupId: modifierGroup.id,
    groupName: modifierGroup.name
  }));
});
const updated = replacePosCartLineConfiguration([originalLine], originalLine.cartLineId, {
  priceCents: preparedFood.priceCents + nextModifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0),
  modifierSelections: [canonical("protein", "paneer"), canonical("veggies", "lettuce")],
  modifiers: nextModifiers,
  modifierSignature: "paneer|lettuce::No onion",
  specialInstructions: "No onion"
});
assert.equal(updated.length, 1, "Modify should update the same cart line");
assert.equal(updated[0].cartLineId, originalLine.cartLineId, "Modify should preserve cart-line identity");
assert.equal(updated[0].quantity, 2, "Modify should preserve quantity");
assert.equal(updated[0].priceCents, 1599, "Modify should recalculate one unit price without double-applying quantity");
assert.equal(updated[0].specialInstructions, "No onion", "Modify should update notes");

assert.ok(restaurantRoutes.includes("modifierGroupLibrary"), "API should persist a restaurant-scoped reusable modifier library");
assert.ok(restaurantRoutes.includes("assignModifierLibraryGroupToItem"), "API should assign reusable modifier groups to menu items");
assert.ok(restaurantRoutes.includes("settingsWithModifierLibraryAssignment"), "API should track item assignments without changing the POS runtime schema");
assert.ok(restaurantRoutes.includes("restaurantIdFor(req)"), "modifier library routes should use the tenant-scoped restaurant resolver");
assert.ok(app.includes("Reusable modifier library"), "Menu admin should expose reusable modifier groups");
assert.ok(app.includes("assignModifierLibraryGroup(item, group)"), "Menu admin should apply reusable groups to individual items");
assert.ok(app.includes("default") && app.includes("disabled"), "Option editor should expose default and disabled option flags");
assert.ok(styles.includes(".menu-modifier-assign"), "Reusable group assignment controls should have dedicated styling");
assert.ok(styles.includes(".pos-modifier-group-error"), "Modifier dialog should show inline group validation");
assert.ok(styles.includes(".pos-modifier-option:disabled"), "Modifier dialog should visually disable maxed-out choices");

console.log("pos-modifier-library-test passed (prepared, bar, packaged, defaults, min/max, price, modify, admin library).");

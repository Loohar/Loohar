import assert from "node:assert/strict";
import { validateSelectedModifiers } from "../apps/api/src/services/posService.js";

const menuItem = {
  id: "item-1",
  name: "Test entree",
  options: [],
  optionGroups: [
    {
      id: "protein",
      name: "Protein",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 0,
      options: [
        { id: "chicken", name: "Chicken", priceCents: 0, sortOrder: 0, available: true },
        { id: "beef", name: "Beef", priceCents: 250, sortOrder: 1, available: true }
      ]
    },
    {
      id: "sauce",
      name: "Sauce",
      required: false,
      minSelect: 0,
      maxSelect: 2,
      sortOrder: 1,
      options: [
        { id: "ranch", name: "Ranch", priceCents: 75, sortOrder: 0, available: true },
        { id: "hot", name: "Hot", priceCents: 75, sortOrder: 1, available: true }
      ]
    }
  ]
};

const canonical = (modifierGroupId, modifierOptionId) => ({ modifierGroupId, modifierOptionId });

const single = validateSelectedModifiers(menuItem, {
  modifierSelections: [canonical("protein", "chicken")]
});
assert.deepEqual(single.optionIds, ["chicken"], "canonical modifier selection should be accepted once");

const mirroredAliases = validateSelectedModifiers(menuItem, {
  modifierSelections: [canonical("protein", "chicken")],
  modifierOptionIds: ["chicken"],
  optionIds: ["chicken"]
});
assert.deepEqual(mirroredAliases.optionIds, ["chicken"], "canonical modifier selections should win over mirrored aliases");

assert.throws(
  () => validateSelectedModifiers(menuItem, {
    modifierSelections: [canonical("protein", "chicken"), canonical("protein", "chicken")]
  }),
  (error) => error?.status === 400 && error?.code === "POS_MODIFIER_DUPLICATE",
  "a true duplicate in the canonical source should be rejected"
);

const requiredGroup = validateSelectedModifiers(menuItem, {
  modifierSelections: [canonical("protein", "beef")]
});
assert.equal(requiredGroup.modifiers[0].name, "Beef", "a valid required group selection should succeed");

const multipleDistinct = validateSelectedModifiers(menuItem, {
  modifierSelections: [
    canonical("protein", "chicken"),
    canonical("sauce", "ranch"),
    canonical("sauce", "hot")
  ]
});
assert.equal(multipleDistinct.modifiers.length, 3, "multiple distinct modifiers should succeed");

const priced = validateSelectedModifiers(menuItem, {
  modifierSelections: [canonical("protein", "beef"), canonical("sauce", "ranch")]
});
assert.equal(
  priced.modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0),
  325,
  "modifier prices should be included exactly once"
);

assert.throws(
  () => validateSelectedModifiers(menuItem, {
    modifierSelections: [{ modifierGroupId: "protein" }]
  }),
  (error) => error?.status === 400 && error?.code === "POS_MODIFIER_INVALID",
  "malformed canonical modifier selections should be rejected"
);

console.log("POS modifier payload regression tests passed (7 cases).");

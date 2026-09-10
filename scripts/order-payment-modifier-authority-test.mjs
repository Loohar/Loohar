import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalQuoteItem, publicModifierSelectionsForLine } from "../apps/api/src/modules/orderPayments/quoteService.js";

const root = process.cwd();
const read = (filePath) => readFileSync(join(root, filePath), "utf8");

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
const option = (id, name, priceCents, extra = {}) => ({ id, name, priceCents, sortOrder: 0, ...extra });
const selection = (modifierGroupId, modifierOptionId, extra = {}) => ({ modifierGroupId, modifierOptionId, ...extra });

const entree = {
  id: "entree-1",
  restaurantId: "tenant-a",
  name: "Server Burger",
  priceCents: 1000,
  options: [],
  optionGroups: [
    group("protein", "Protein", [
      option("chicken", "Chicken", 0),
      option("beef", "Beef", 250)
    ], { required: true, minSelect: 1, maxSelect: 1 }),
    group("sauce", "Sauce", [
      option("ranch", "Ranch", 75),
      option("hot", "Hot", 90),
      option("bbq", "BBQ", 80)
    ], { maxSelect: 2 })
  ]
};

const otherItemOption = selection("dessert-topping", "sprinkles");
const crossTenantOption = selection("foreign-group", "tenant-b-option");

function quote(line) {
  return canonicalQuoteItem({ menuItem: entree, item: { menuItemId: entree.id, quantity: 1, ...line } });
}

const valid = quote({
  modifierSelections: [selection("protein", "beef")]
});
assert.equal(valid.name, "Server Burger", "item name must come from the DB menu item");
assert.equal(valid.baseUnitPriceCents, 1000, "base item price must come from the DB menu item");
assert.equal(valid.optionsTotalCents, 250, "valid modifier should use DB option price");
assert.equal(valid.options[0].name, "Beef", "valid modifier should use DB option name");
assert.deepEqual(valid.modifierSelections, [selection("protein", "beef")], "canonical modifier selections should be persisted");

const lowPriceTamper = quote({
  modifierSelections: [selection("protein", "beef", { name: "Almost free", priceCents: 1 })],
  priceCents: 1,
  subtotalCents: 1,
  totalCents: 1
});
assert.equal(lowPriceTamper.optionsTotalCents, 250, "low client option price must be ignored");
assert.equal(lowPriceTamper.unitPriceCents, 1250, "client item/total prices must not affect unit price");
assert.equal(lowPriceTamper.options[0].name, "Beef", "tampered option name must be replaced with DB option name");

const negativePriceTamper = quote({
  modifierSelections: [selection("protein", "beef", { priceCents: -10000 })]
});
assert.equal(negativePriceTamper.optionsTotalCents, 250, "negative client option price must be ignored");

const highPriceTamper = quote({
  modifierSelections: [selection("protein", "beef", { priceCents: 999999 })]
});
assert.equal(highPriceTamper.optionsTotalCents, 250, "high client option price must be ignored");

const legacyWithIds = quote({
  options: [{ group: "Protein", name: "Free", priceCents: -1, optionId: "beef", groupId: "protein" }]
});
assert.equal(legacyWithIds.optionsTotalCents, 250, "legacy option payload with IDs must still use DB price");
assert.equal(legacyWithIds.options[0].name, "Beef", "legacy option payload with IDs must still use DB name");

assert.deepEqual(
  publicModifierSelectionsForLine({ optionIds: ["beef"] }),
  [{ modifierGroupId: null, modifierOptionId: "beef" }],
  "legacy ID arrays should normalize into canonical modifier selections"
);

assert.throws(
  () => quote({ modifierSelections: [selection("protein", "missing-option")] }),
  (error) => error?.status === 400 && error?.code === "ORDER_MODIFIER_INVALID" && !String(error.message).includes("missing-option"),
  "unknown option IDs should be rejected without echoing the ID"
);

assert.throws(
  () => quote({ modifierSelections: [otherItemOption] }),
  (error) => error?.status === 400 && error?.code === "ORDER_MODIFIER_INVALID",
  "option from another item should be rejected"
);

assert.throws(
  () => quote({ modifierSelections: [selection("sauce", "beef")] }),
  (error) => error?.status === 400 && error?.code === "ORDER_MODIFIER_INVALID",
  "option submitted under the wrong group should be rejected"
);

assert.throws(
  () => quote({ modifierSelections: [crossTenantOption] }),
  (error) => error?.status === 400 && error?.code === "ORDER_MODIFIER_INVALID",
  "cross-tenant option should be rejected because it is not on the tenant-scoped item"
);

assert.throws(
  () => quote({ modifierSelections: [] }),
  (error) => error?.status === 400 && error?.code === "ORDER_MODIFIER_REQUIRED",
  "required modifier group should be enforced"
);

assert.throws(
  () => quote({
    modifierSelections: [
      selection("protein", "chicken"),
      selection("sauce", "ranch"),
      selection("sauce", "hot"),
      selection("sauce", "bbq")
    ]
  }),
  (error) => error?.status === 400 && error?.code === "ORDER_MODIFIER_MAXIMUM",
  "maximum selections should be enforced"
);

assert.throws(
  () => quote({
    modifierSelections: [selection("protein", "beef"), selection("protein", "beef")]
  }),
  (error) => error?.status === 400 && error?.code === "ORDER_MODIFIER_DUPLICATE",
  "duplicate modifier option should be rejected"
);

const routeSchema = read("apps/api/src/routes/orderPayments.js");
assert.match(routeSchema, /modifierSelections: z\.array\(modifierSelectionSchema\)/, "public route schema should accept canonical modifier selections");
assert.match(routeSchema, /priceCents: z\.number\(\)\.int\(\)\.optional\(\)/, "legacy modifier price is syntactically accepted only for compatibility");

const quoteService = read("apps/api/src/modules/orderPayments/quoteService.js");
assert.ok(quoteService.includes("validateSelectedModifiers"), "quote service must use shared server-side modifier validation");
assert.ok(!quoteService.includes("selectedOptions.reduce"), "quote service must not sum client-selected option prices");

const orderPaymentService = read("apps/api/src/modules/orderPayments/orderPaymentService.js");
assert.ok(orderPaymentService.includes("const quote = await calculateOrderQuote"), "checkout creation must recalculate the canonical quote");
assert.ok(orderPaymentService.includes("amount: quote.totalCents"), "PaymentIntent amount must derive from canonical quote total");
assert.ok(orderPaymentService.includes("modifierSelections: item.modifierSelections || []"), "order snapshot must persist canonical modifier selections");

const app = read("apps/web/src/App.jsx");
assert.ok(app.includes("modifierOptionId: modifier.modifierOptionId"), "customer frontend should submit modifier option IDs");
assert.ok(!app.includes("options: item.selectedModifiers || []"), "customer frontend should not submit modifier prices as the checkout authority");

assert.equal(existsSync(join(root, "apps/api/prisma/migrations")), true, "repository migration directory should exist");

console.log("order-payment-modifier-authority-test passed.");

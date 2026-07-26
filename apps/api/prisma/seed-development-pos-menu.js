import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REQUIRED_CLASSIFICATION = "INTERNAL_DEVELOPMENT";
const DEVELOPMENT_SLUG = process.env.DEVELOPMENT_POS_SLUG || "development-restaurant";
const DEVELOPMENT_RESTAURANT_ID = process.env.DEVELOPMENT_POS_RESTAURANT_ID || "";
const ALLOW_PRODUCTION_SEED = process.env.ALLOW_PRODUCTION_DEVELOPMENT_POS_MENU_SEED === "true";

const categories = [
  "Appetizers",
  "Soups",
  "Salads",
  "Noodles",
  "Rice",
  "Vegetarian",
  "Chicken",
  "Lamb",
  "Seafood",
  "Tandoor",
  "Breads",
  "Wraps",
  "Bowls",
  "Kids",
  "Desserts",
  "Hot Drinks",
  "Cold Drinks",
  "Specials"
];

const image = (query) => `https://images.unsplash.com/featured/900x700?${encodeURIComponent(query)}`;

const modifierTemplates = {
  spice: {
    name: "Spice Level",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      ["Mild", 0],
      ["Medium", 0],
      ["Hot", 0],
      ["Extra Hot", 50]
    ]
  },
  size: {
    name: "Size",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      ["Small", -200],
      ["Regular", 0],
      ["Large", 300]
    ]
  },
  protein: {
    name: "Protein Choice",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      ["Chicken", 0],
      ["Lamb", 300],
      ["Paneer", 100],
      ["Tofu", 0]
    ]
  },
  addOns: {
    name: "Add-ons",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    options: [
      ["Extra Cheese", 150],
      ["Extra Chicken", 300],
      ["Extra Lamb", 400],
      ["Extra Paneer", 250],
      ["Avocado", 200],
      ["Jalapeno", 75],
      ["Extra Sauce", 75]
    ]
  },
  removals: {
    name: "Remove Ingredients",
    required: false,
    minSelect: 0,
    maxSelect: 5,
    options: [
      ["No Onion", 0],
      ["No Tomato", 0],
      ["No Cilantro", 0],
      ["No Dairy", 0],
      ["No Egg", 0]
    ]
  },
  side: {
    name: "Side Choice",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      ["Basmati Rice", 0],
      ["Brown Rice", 100],
      ["Fries", 150],
      ["Salad", 150],
      ["Plain Naan", 200],
      ["Garlic Naan", 300]
    ]
  },
  drinkSize: {
    name: "Drink Size",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      ["Small", -100],
      ["Medium", 0],
      ["Large", 150]
    ]
  },
  preparation: {
    name: "Preparation",
    required: false,
    minSelect: 0,
    maxSelect: 2,
    options: [
      ["Regular", 0],
      ["Well Done", 0],
      ["Sauce on Side", 0],
      ["Cut in Half", 0]
    ]
  }
};

const items = [
  ["Appetizers", "Vegetable Samosa", 599, "Crisp pastry with spiced potato and peas.", ["spice", "addOns"], { isVegetarian: true, featured: true }],
  ["Appetizers", "Chicken Samosa", 699, "Golden pastry filled with seasoned chicken.", ["spice", "addOns"], { isSpicy: true }],
  ["Appetizers", "Garlic Naan Bites", 699, "Warm naan bites tossed with garlic butter and cilantro.", ["addOns", "preparation"], { isVegetarian: true, featured: true, imageUrl: image("garlic naan") }],
  ["Appetizers", "Vegetable Pakora", 649, "Assorted vegetables in chickpea batter.", ["spice", "addOns"], { isVegetarian: true, isVegan: true }],
  ["Appetizers", "Chicken 65", 999, "Crispy South Indian-style chicken bites.", ["spice", "preparation"], { isSpicy: true, recommended: true }],
  ["Soups", "Tomato Soup", 599, "Creamy tomato soup with toasted spices.", ["size"], { isVegetarian: true }],
  ["Soups", "Lentil Soup", 649, "Slow-cooked lentils with cumin and garlic.", ["size", "spice"], { isVegetarian: true, isVegan: true }],
  ["Soups", "Hot and Sour Soup", 749, "Tangy broth with vegetables and chili.", ["size", "spice"], { isSpicy: true }],
  ["Salads", "House Salad", 799, "Greens, cucumber, tomato, and house dressing.", ["addOns", "removals"], { isVegetarian: true }],
  ["Salads", "Chicken Tikka Salad", 1199, "Greens topped with warm chicken tikka.", ["spice", "removals"], { recommended: true }],
  ["Salads", "Cucumber Tomato Salad", 699, "Fresh cucumber, tomato, onion, and lemon.", ["removals"], { isVegetarian: true, isVegan: true }],
  ["Noodles", "Vegetable Chow Mein", 1199, "Stir-fried noodles with vegetables.", ["spice", "addOns", "removals"], { isVegetarian: true }],
  ["Noodles", "Chicken Chow Mein", 1299, "Noodles with chicken and market vegetables.", ["spice", "addOns", "removals"], {}],
  ["Rice", "Vegetable Fried Rice", 1099, "Wok-fried rice with vegetables.", ["spice", "addOns", "removals"], { isVegetarian: true }],
  ["Rice", "Lamb Biryani", 1699, "Aromatic basmati rice with tender lamb.", ["spice", "side"], { featured: true, imageUrl: image("lamb biryani") }],
  ["Rice", "Chicken Biryani", 1499, "Layered rice with chicken and warm spices.", ["spice", "side"], { recommended: true }],
  ["Rice", "Vegetable Biryani", 1299, "Vegetable biryani with saffron rice.", ["spice", "side"], { isVegetarian: true }],
  ["Vegetarian", "Paneer Tikka Masala", 1499, "Paneer in a creamy tomato masala.", ["spice", "side", "addOns"], { isVegetarian: true, featured: true }],
  ["Vegetarian", "Palak Paneer", 1399, "Paneer cooked with spinach and garlic.", ["spice", "side"], { isVegetarian: true }],
  ["Vegetarian", "Chana Masala", 1299, "Chickpeas in tomato and onion masala.", ["spice", "side"], { isVegetarian: true, isVegan: true }],
  ["Vegetarian", "Dal Tadka", 1199, "Yellow lentils finished with tempered spices.", ["spice", "side"], { isVegetarian: true, isVegan: true }],
  ["Vegetarian", "Vegetable Korma", 1399, "Vegetables in a mild cashew-style sauce.", ["spice", "side"], { isVegetarian: true }],
  ["Chicken", "Butter Chicken", 1599, "Chicken in a rich butter tomato sauce.", ["spice", "side", "addOns"], { featured: true, imageUrl: image("butter chicken") }],
  ["Chicken", "Chicken Tikka Masala", 1599, "Chicken tikka in creamy masala sauce.", ["spice", "side", "addOns"], { recommended: true }],
  ["Chicken", "Chicken Curry", 1499, "Classic chicken curry with house spices.", ["spice", "side"], {}],
  ["Chicken", "Chicken Korma", 1599, "Chicken in a mild creamy sauce.", ["spice", "side"], {}],
  ["Chicken", "Tandoori Chicken Bowl", 1499, "Spiced chicken, rice, cucumber salad, and mint chutney.", ["spice", "side", "removals"], { featured: true, recommended: true, imageUrl: image("tandoori chicken bowl") }],
  ["Lamb", "Lamb Curry", 1699, "Tender lamb simmered in curry sauce.", ["spice", "side"], {}],
  ["Lamb", "Lamb Korma", 1799, "Lamb in a mild creamy sauce.", ["spice", "side"], {}],
  ["Lamb", "Lamb Vindaloo", 1799, "Goan-style lamb curry with potatoes.", ["spice", "side"], { isSpicy: true }],
  ["Seafood", "Shrimp Curry", 1799, "Shrimp in a fragrant curry sauce.", ["spice", "side"], { recommended: true }],
  ["Seafood", "Fish Tikka", 1899, "Marinated fish cooked in the tandoor.", ["spice", "preparation"], { available: false }],
  ["Seafood", "Salmon Tandoori", 1999, "Salmon with tandoori spices.", ["spice", "preparation"], {}],
  ["Tandoor", "Chicken Tikka", 1599, "Boneless chicken from the tandoor.", ["spice", "side"], {}],
  ["Tandoor", "Tandoori Chicken", 1699, "Bone-in chicken roasted in the tandoor.", ["spice", "side"], { isSpicy: true }],
  ["Tandoor", "Paneer Tikka", 1499, "Paneer and vegetables from the tandoor.", ["spice", "side"], { isVegetarian: true }],
  ["Breads", "Plain Naan", 349, "Soft tandoor-baked flatbread.", ["preparation"], { isVegetarian: true }],
  ["Breads", "Garlic Naan", 449, "Naan with garlic and cilantro.", ["preparation", "addOns"], { isVegetarian: true, recommended: true }],
  ["Breads", "Cheese Naan", 549, "Naan stuffed with cheese.", ["preparation"], { isVegetarian: true }],
  ["Wraps", "Paneer Tikka Wrap", 1299, "Paneer, peppers, onions, and masala sauce.", ["spice", "removals", "addOns"], { isVegetarian: true, recommended: true, imageUrl: image("paneer wrap") }],
  ["Wraps", "Chicken Tikka Wrap", 1399, "Chicken tikka wrapped with fresh vegetables.", ["spice", "removals", "addOns"], {}],
  ["Bowls", "Build Your Own Rice Bowl", 1399, "Choose protein, side, spice, and toppings.", ["protein", "spice", "side", "addOns", "removals"], { featured: true }],
  ["Kids", "Kids Chicken and Rice", 799, "Simple chicken and rice plate.", ["side"], {}],
  ["Kids", "Kids Cheese Naan", 599, "Cheesy naan for smaller appetites.", ["preparation"], { isVegetarian: true }],
  ["Desserts", "Gulab Jamun", 599, "Warm milk dumplings in syrup.", [], { isVegetarian: true }],
  ["Desserts", "Mango Kulfi", 599, "Frozen mango dessert.", [], { isVegetarian: true, available: false }],
  ["Hot Drinks", "Masala Chai", 399, "Spiced tea with milk.", ["size"], { isVegetarian: true }],
  ["Cold Drinks", "Mango Lassi", 499, "Chilled mango yogurt drink.", ["drinkSize"], { isVegetarian: true, imageUrl: image("mango lassi") }],
  ["Cold Drinks", "Fountain Drink", 299, "Choice of fountain soda.", ["drinkSize"], {}],
  ["Specials", "Chef's Long-Name Combo for Category Wrapping and Cart Scroll Testing", 2299, "Internal QA combo with entree, side, bread, and drink.", ["spice", "side", "drinkSize", "addOns", "preparation"], { featured: true, recommended: true }]
];

function productionGuard() {
  if (process.env.NODE_ENV === "production" && !ALLOW_PRODUCTION_SEED) {
    throw new Error("Refusing to seed the development POS menu in production without ALLOW_PRODUCTION_DEVELOPMENT_POS_MENU_SEED=true.");
  }
}

async function findDevelopmentRestaurant() {
  const where = DEVELOPMENT_RESTAURANT_ID
    ? { id: DEVELOPMENT_RESTAURANT_ID, tenantClassification: REQUIRED_CLASSIFICATION }
    : { slug: DEVELOPMENT_SLUG, tenantClassification: REQUIRED_CLASSIFICATION };
  const restaurants = await prisma.restaurant.findMany({
    where,
    include: {
      locations: { where: { active: true }, orderBy: { createdAt: "asc" } },
      users: {
        where: { role: { in: ["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "SUPER_ADMIN"] } },
        orderBy: { createdAt: "asc" },
        take: 1
      }
    }
  });
  if (restaurants.length !== 1) {
    throw new Error(`Expected exactly one ${REQUIRED_CLASSIFICATION} restaurant for ${DEVELOPMENT_RESTAURANT_ID || DEVELOPMENT_SLUG}; found ${restaurants.length}.`);
  }
  if (!restaurants[0].locations.length) {
    throw new Error("Development restaurant has no active location. Run setup:development-pos first.");
  }
  return restaurants[0];
}

async function upsertCategory(tx, restaurantId, name, sortOrder) {
  const existing = await tx.menuCategory.findFirst({ where: { restaurantId, name } });
  if (existing) {
    return tx.menuCategory.update({ where: { id: existing.id }, data: { active: true, sortOrder } });
  }
  return tx.menuCategory.create({ data: { restaurantId, name, sortOrder, active: true } });
}

async function upsertMenuItem(tx, restaurantId, categoryId, item) {
  const existing = await tx.menuItem.findFirst({ where: { restaurantId, categoryId, name: item.name } });
  const data = {
    restaurantId,
    categoryId,
    name: item.name,
    description: item.description,
    priceCents: item.priceCents,
    imageUrl: item.imageUrl || null,
    available: item.available !== false,
    preparationTimeMins: item.preparationTimeMins || 12,
    calories: item.calories || null,
    spiceLevel: item.isSpicy ? "Medium" : null,
    featured: Boolean(item.featured),
    recommended: Boolean(item.recommended),
    isGlutenFree: Boolean(item.isGlutenFree),
    isVegetarian: Boolean(item.isVegetarian),
    isVegan: Boolean(item.isVegan),
    isSpicy: Boolean(item.isSpicy),
    isDairyFree: Boolean(item.isDairyFree),
    isNutFree: Boolean(item.isNutFree)
  };
  return existing
    ? tx.menuItem.update({ where: { id: existing.id }, data })
    : tx.menuItem.create({ data });
}

async function replaceModifierGroups(tx, menuItemId, modifierKeys) {
  await tx.menuItemOption.deleteMany({ where: { menuItemId } });
  await tx.menuItemOptionGroup.deleteMany({ where: { menuItemId } });

  let groupCount = 0;
  let optionCount = 0;
  for (const [groupIndex, key] of modifierKeys.entries()) {
    const template = modifierTemplates[key];
    if (!template) continue;
    const group = await tx.menuItemOptionGroup.create({
      data: {
        menuItemId,
        name: template.name,
        required: template.required,
        minSelect: template.minSelect,
        maxSelect: template.maxSelect,
        sortOrder: groupIndex + 1
      }
    });
    groupCount += 1;
    for (const [optionIndex, [name, priceCents]] of template.options.entries()) {
      await tx.menuItemOption.create({
        data: {
          menuItemId,
          optionGroupId: group.id,
          name,
          priceCents,
          isDefault: template.required && optionIndex === 0,
          sortOrder: optionIndex + 1
        }
      });
      optionCount += 1;
    }
  }
  return { groupCount, optionCount };
}

function normalizeItem([categoryName, name, priceCents, description, modifierKeys = [], flags = {}]) {
  return { categoryName, name, priceCents, description, modifierKeys, ...flags };
}

async function main() {
  productionGuard();
  const restaurant = await findDevelopmentRestaurant();
  const normalizedItems = items.map(normalizeItem);

  const summary = await prisma.$transaction(async (tx) => {
    const categoryByName = new Map();
    for (const [index, categoryName] of categories.entries()) {
      const category = await upsertCategory(tx, restaurant.id, categoryName, index + 1);
      categoryByName.set(categoryName, category);
    }

    let itemCount = 0;
    let modifierGroupCount = 0;
    let modifierOptionCount = 0;
    let unavailableCount = 0;
    for (const item of normalizedItems) {
      const category = categoryByName.get(item.categoryName);
      if (!category) throw new Error(`Unknown seed category ${item.categoryName}`);
      const menuItem = await upsertMenuItem(tx, restaurant.id, category.id, item);
      const modifiers = await replaceModifierGroups(tx, menuItem.id, item.modifierKeys);
      itemCount += 1;
      modifierGroupCount += modifiers.groupCount;
      modifierOptionCount += modifiers.optionCount;
      if (item.available === false) unavailableCount += 1;
    }

    await tx.auditLog.create({
      data: {
        restaurantId: restaurant.id,
        actorUserId: restaurant.users[0]?.id || null,
        action: "development.pos_menu.seeded",
        entityType: "Restaurant",
        entityId: restaurant.id,
        metadataJson: {
          internalDevelopmentOnly: true,
          categoryCount: categories.length,
          itemCount,
          modifierGroupCount,
          modifierOptionCount,
          unavailableCount
        }
      }
    });

    return {
      categoryCount: categories.length,
      itemCount,
      modifierGroupCount,
      modifierOptionCount,
      unavailableCount
    };
  }, { timeout: 30000 });

  console.log("Development POS menu seed complete.");
  console.log(JSON.stringify({
    restaurant: { id: restaurant.id, slug: restaurant.slug, classification: restaurant.tenantClassification },
    defaultLocationId: restaurant.locations[0].id,
    ...summary
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

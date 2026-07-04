const img = (id, w = 1200) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

const demoModifierGroups = {
  protein: {
    id: "mod-protein",
    name: "Choose protein",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { id: "protein-chicken", name: "Chicken", priceCents: 0, isDefault: true },
      { id: "protein-beef", name: "Beef", priceCents: 250 },
      { id: "protein-salmon", name: "Salmon", priceCents: 600 },
      { id: "protein-shrimp", name: "Shrimp", priceCents: 500 },
      { id: "protein-tofu", name: "Tofu", priceCents: 0 },
      { id: "protein-paneer", name: "Paneer", priceCents: 300 }
    ]
  },
  veggies: {
    id: "mod-veggies",
    name: "Add veggies",
    required: false,
    minSelect: 0,
    maxSelect: 5,
    options: ["Lettuce", "Tomato", "Onion", "Mushroom", "Bell Pepper", "Spinach", "Jalapeno", "Avocado"].map((name, index) => ({ id: `veg-${index}`, name, priceCents: name === "Avocado" ? 225 : 0 }))
  },
  sauces: {
    id: "mod-sauces",
    name: "Add sauce",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    options: ["Ranch", "Garlic Aioli", "Buffalo", "Teriyaki", "House Sauce", "Hot Sauce"].map((name, index) => ({ id: `sauce-${index}`, name, priceCents: 75 }))
  },
  side: {
    id: "mod-side",
    name: "Choose side",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: ["Fries", "Rice", "Salad", "Soup", "Seasonal Vegetables"].map((name, index) => ({ id: `side-${index}`, name, priceCents: index > 2 ? 150 : 0, isDefault: index === 0 }))
  },
  spice: {
    id: "mod-spice",
    name: "Spice level",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    options: ["Mild", "Medium", "Hot", "Extra Hot"].map((name, index) => ({ id: `spice-${index}`, name, priceCents: 0, isDefault: index === 1 }))
  },
  dietary: {
    id: "mod-dietary",
    name: "Dietary requests",
    required: false,
    minSelect: 0,
    maxSelect: 5,
    options: ["Gluten Free", "No Dairy", "No Nuts", "Vegan", "Vegetarian"].map((name, index) => ({ id: `diet-${index}`, name, priceCents: 0 }))
  }
};

function item({ id, name, description, priceCents, image, preparationTimeMins = 16, featured = false, recommended = false, badges = [], optionGroups = [demoModifierGroups.spice, demoModifierGroups.dietary] }) {
  return {
    id,
    name,
    description,
    priceCents,
    imageUrl: image,
    preparationTimeMins,
    featured,
    recommended,
    available: true,
    isGlutenFree: badges.includes("Gluten Free"),
    isVegetarian: badges.includes("Vegetarian"),
    isVegan: badges.includes("Vegan"),
    isSpicy: badges.includes("Spicy"),
    isDairyFree: badges.includes("Dairy Free"),
    isNutFree: badges.includes("Nut Free"),
    optionGroups,
    options: optionGroups.flatMap((group) => group.options.map((option) => ({ ...option, required: group.required })))
  };
}

const demoCategories = [
  {
    id: "cat-appetizers",
    name: "Appetizers",
    items: [
      item({ id: "crispy-calamari", name: "Crispy Calamari", description: "Lightly fried calamari, lemon, herbs, spicy marinara.", priceCents: 1495, image: img("photo-1599487488170-d11ec9c172f0"), featured: true, badges: ["Dairy Free"] }),
      item({ id: "garlic-parmesan-wings", name: "Garlic Parmesan Wings", description: "Crisp wings tossed with roasted garlic, parmesan, parsley.", priceCents: 1395, image: img("photo-1567620832903-9fc6debc209f"), recommended: true, badges: ["Spicy"], optionGroups: [demoModifierGroups.sauces, demoModifierGroups.spice] }),
      item({ id: "spinach-artichoke-dip", name: "Spinach Artichoke Dip", description: "Creamy baked dip with artichokes, spinach, warm crostini.", priceCents: 1195, image: img("photo-1541014741259-de529411b96a"), badges: ["Vegetarian"] })
    ]
  },
  {
    id: "cat-soups-salads",
    name: "Soups & Salads",
    items: [
      item({ id: "caesar-salad", name: "Caesar Salad", description: "Romaine, parmesan, focaccia croutons, classic Caesar dressing.", priceCents: 1095, image: img("photo-1546793665-c74683f339c1"), badges: ["Vegetarian"], optionGroups: [demoModifierGroups.protein, demoModifierGroups.dietary] }),
      item({ id: "southwest-chicken-salad", name: "Southwest Chicken Salad", description: "Grilled chicken, avocado, corn, black beans, chipotle lime.", priceCents: 1495, image: img("photo-1505253716362-afaea1d3d1af"), featured: true, badges: ["Gluten Free", "Spicy"], optionGroups: [demoModifierGroups.protein, demoModifierGroups.veggies, demoModifierGroups.dietary] }),
      item({ id: "tomato-basil-soup", name: "Tomato Basil Soup", description: "Slow-simmered tomato, basil oil, grilled sourdough.", priceCents: 895, image: img("photo-1547592166-23ac45744acd"), badges: ["Vegetarian", "Nut Free"] })
    ]
  },
  {
    id: "cat-entrees",
    name: "Entrees",
    items: [
      item({ id: "grilled-salmon", name: "Grilled Salmon", description: "Citrus-herb salmon, seasonal vegetables, lemon butter.", priceCents: 2495, image: img("photo-1467003909585-2f8a72700288"), featured: true, recommended: true, badges: ["Gluten Free", "Nut Free"], optionGroups: [demoModifierGroups.side, demoModifierGroups.sauces, demoModifierGroups.dietary] }),
      item({ id: "herb-roasted-chicken", name: "Herb Roasted Chicken", description: "Half chicken, garlic jus, mashed potatoes, charred greens.", priceCents: 2195, image: img("photo-1532550907401-a500c9a57435"), recommended: true, optionGroups: [demoModifierGroups.side, demoModifierGroups.sauces, demoModifierGroups.dietary] }),
      item({ id: "steak-frites", name: "Steak Frites", description: "Seared steak, truffle fries, arugula, peppercorn sauce.", priceCents: 2895, image: img("photo-1558030006-450675393462"), featured: true, optionGroups: [demoModifierGroups.side, demoModifierGroups.sauces, demoModifierGroups.spice] })
    ]
  },
  {
    id: "cat-dinner-specials",
    name: "Dinner Specials",
    items: [
      item({ id: "braised-short-rib", name: "Braised Short Rib", description: "Red wine short rib, whipped potatoes, glazed carrots.", priceCents: 3195, image: img("photo-1544025162-d76694265947"), featured: true, optionGroups: [demoModifierGroups.side, demoModifierGroups.dietary] }),
      item({ id: "seafood-linguine", name: "Seafood Linguine", description: "Shrimp, scallops, clams, tomato saffron broth.", priceCents: 2995, image: img("photo-1563379926898-05f4575a45d8"), recommended: true, badges: ["Spicy"], optionGroups: [demoModifierGroups.spice, demoModifierGroups.dietary] }),
      item({ id: "seasonal-risotto", name: "Chef's Seasonal Risotto", description: "Arborio rice, market vegetables, parmesan, herb oil.", priceCents: 2295, image: img("photo-1476124369491-e7addf5db371"), badges: ["Vegetarian", "Gluten Free"], optionGroups: [demoModifierGroups.protein, demoModifierGroups.veggies, demoModifierGroups.dietary] })
    ]
  },
  {
    id: "cat-burgers-sandwiches",
    name: "Burgers & Sandwiches",
    items: [
      item({ id: "bistro-burger", name: "Bistro Burger", description: "Double patty, aged cheddar, caramelized onion, house sauce.", priceCents: 1695, image: img("photo-1568901346375-23c9450c58cd"), featured: true, optionGroups: [demoModifierGroups.protein, demoModifierGroups.veggies, demoModifierGroups.side, demoModifierGroups.sauces, demoModifierGroups.dietary] }),
      item({ id: "seed-chicken-sandwich", name: "Crispy Chicken Sandwich", description: "Buttermilk chicken, slaw, pickles, house sauce.", priceCents: 1395, image: img("photo-1550547660-d9450f859349"), recommended: true, badges: ["Spicy"], optionGroups: [demoModifierGroups.veggies, demoModifierGroups.side, demoModifierGroups.sauces, demoModifierGroups.spice] }),
      item({ id: "veggie-melt", name: "Veggie Melt", description: "Mushrooms, peppers, spinach, provolone, garlic aioli.", priceCents: 1295, image: img("photo-1528735602780-2552fd46c7af"), badges: ["Vegetarian"], optionGroups: [demoModifierGroups.veggies, demoModifierGroups.side, demoModifierGroups.dietary] })
    ]
  },
  {
    id: "cat-sides",
    name: "Sides",
    items: [
      item({ id: "truffle-fries", name: "Truffle Fries", description: "Crisp fries, parmesan, herbs, truffle aioli.", priceCents: 795, image: img("photo-1576107232684-1279f390859f"), recommended: true, badges: ["Vegetarian"] }),
      item({ id: "seasonal-vegetables", name: "Seasonal Vegetables", description: "Roasted market vegetables with lemon and herbs.", priceCents: 695, image: img("photo-1540420773420-3366772f4999"), badges: ["Vegan", "Gluten Free", "Dairy Free", "Nut Free"] }),
      item({ id: "garlic-mashed-potatoes", name: "Garlic Mashed Potatoes", description: "Yukon gold potatoes, roasted garlic, chives.", priceCents: 695, image: img("photo-1601050690597-df0568f70950"), badges: ["Vegetarian", "Nut Free"] })
    ]
  },
  {
    id: "cat-desserts",
    name: "Desserts",
    items: [
      item({ id: "chocolate-lava-cake", name: "Chocolate Lava Cake", description: "Warm chocolate cake, molten center, vanilla cream.", priceCents: 995, image: img("photo-1606313564200-e75d5e30476c"), featured: true, badges: ["Vegetarian"] }),
      item({ id: "new-york-cheesecake", name: "New York Cheesecake", description: "Classic cheesecake, berry compote, graham crust.", priceCents: 895, image: img("photo-1533134242443-d4fd215305ad"), badges: ["Vegetarian"] }),
      item({ id: "tiramisu", name: "Tiramisu", description: "Espresso-soaked ladyfingers, mascarpone, cocoa.", priceCents: 925, image: img("photo-1571877227200-a0d98ea607e9"), recommended: true, badges: ["Vegetarian"] })
    ]
  },
  {
    id: "cat-drinks",
    name: "Drinks",
    items: [
      item({ id: "house-lemonade", name: "House Lemonade", description: "Fresh lemon, cane sugar, mint.", priceCents: 495, image: img("photo-1621263764928-df1444c5e859"), badges: ["Vegan", "Gluten Free", "Dairy Free", "Nut Free"] }),
      item({ id: "iced-tea", name: "Iced Tea", description: "Black tea, citrus, lightly sweetened.", priceCents: 395, image: img("photo-1556679343-c7306c1976bc"), badges: ["Vegan", "Gluten Free", "Dairy Free", "Nut Free"] }),
      item({ id: "sparkling-water", name: "Sparkling Water", description: "Chilled sparkling mineral water.", priceCents: 350, image: img("photo-1523362628745-0c100150b504"), badges: ["Vegan", "Gluten Free", "Dairy Free", "Nut Free"] })
    ]
  }
];

export const demoRestaurant = {
  id: "demo-restaurant",
  name: "Demo Bistro",
  businessName: "Demo Bistro",
  businessType: "RESTAURANT",
  enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"],
  slug: "demo-bistro",
  description: "Modern American bistro cooking with seasonal ingredients, elegant comfort food, and restaurant-owned pickup and delivery.",
  address: "100 Main St, Denver, CO",
  phone: "555-0101",
  email: "hello@demobistro.local",
  deliveryFeeCents: 399,
  pickupEnabled: true,
  deliveryEnabled: true,
  storeHoursJson: { monday: "11:00 AM - 10:00 PM", tuesday: "11:00 AM - 10:00 PM", wednesday: "11:00 AM - 10:00 PM", thursday: "11:00 AM - 10:00 PM", friday: "11:00 AM - 11:00 PM", saturday: "10:00 AM - 11:00 PM", sunday: "10:00 AM - 9:00 PM" },
  loyaltySettingsJson: { pointsPerDollar: 1, welcomeBonus: 100 },
  categories: demoCategories
};

export const demoOrders = [
  { id: "ord-101", orderNumber: "894120", status: "PREPARING", type: "DELIVERY", totalCents: 3287, tipCents: 600, customer: { name: "Maya Chen" }, createdAt: new Date().toISOString() },
  { id: "ord-102", orderNumber: "894119", status: "READY", type: "PICKUP", totalCents: 1512, tipCents: 0, customer: { name: "Jon Miller" }, createdAt: new Date().toISOString() },
  { id: "ord-103", orderNumber: "894118", status: "DELIVERED", type: "DELIVERY", totalCents: 4822, tipCents: 900, customer: { name: "Priya Shah" }, createdAt: new Date().toISOString() }
];

export const demoDrivers = [
  {
    id: "drv-1",
    available: true,
    totalEarningsCents: 10300,
    totalTipsCents: 4100,
    user: { name: "Alex Driver", phone: "555-0133" },
    deliveries: [{ status: "ASSIGNED" }, { status: "DELIVERED" }]
  },
  {
    id: "drv-2",
    available: false,
    totalEarningsCents: 0,
    totalTipsCents: 0,
    user: { name: "Sam Rivera", phone: "555-0144" },
    deliveries: []
  }
];

export const demoCustomers = [
  { id: "cust-1", name: "Maya Chen", email: "customer@demo.local", segment: "VIP_CUSTOMER", totalOrders: 14, lifetimeSpendCents: 68200, loyaltyPointBalance: 640, favoriteMenuItems: [{ name: "Harvest Bowl", quantity: 8 }] },
  { id: "cust-2", name: "Jon Miller", email: "jon.customer@demo.local", segment: "ACTIVE_CUSTOMER", totalOrders: 5, lifetimeSpendCents: 15120, loyaltyPointBalance: 150, favoriteMenuItems: [{ name: "Crispy Chicken Sandwich", quantity: 3 }] },
  { id: "cust-3", name: "Priya Shah", email: "priya@example.local", segment: "AT_RISK_CUSTOMER", totalOrders: 2, lifetimeSpendCents: 4822, loyaltyPointBalance: 48, favoriteMenuItems: [] }
];

export const demoCustomerSummary = {
  totalCustomers: 842,
  newCustomersThisMonth: 58,
  repeatCustomerPercentage: 42,
  vipCustomerCount: 91
};

export const demoGrowth = {
  loyalty: {
    settings: { pointsPerDollar: 1, welcomeBonus: 100 },
    rewards: [
      { id: "reward-1", name: "Free drink", pointsRequired: 150 },
      { id: "reward-2", name: "Free appetizer", pointsRequired: 300 },
      { id: "reward-3", name: "$5 discount coupon", pointsRequired: 500 },
      { id: "reward-4", name: "Free delivery", pointsRequired: 250 }
    ],
    analytics: { pointsIssued: 12840, pointsRedeemed: 3420, topCustomers: [] }
  },
  promotions: {
    activePromotions: [{ id: "promo-1", code: "BISTRO10", redeemedCount: 32 }, { id: "promo-2", code: "FREEDELIVERY", redeemedCount: 18 }],
    redemptionStatistics: []
  },
  analytics: {
    metrics: { totalOrders: 207, averageOrderValueCents: 2860, deliveryOrders: 122, pickupOrders: 85, driverTipsCents: 18400 },
    charts: { salesTrend: [] },
    popularItems: []
  },
  menuInsights: {
    bestSellingItems: [{ id: "grilled-salmon", name: "Grilled Salmon", quantity: 78 }, { id: "bistro-burger", name: "Bistro Burger", quantity: 54 }],
    worstSellingItems: [],
    mostProfitableCategories: []
  },
  locations: [{ id: "loc-1", name: "Demo Bistro Main" }]
};

export const demoRestaurants = [
  { id: "res-1", name: "Demo Bistro", businessName: "Demo Bistro", businessType: "RESTAURANT", enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"], slug: "demo-bistro", status: "ACTIVE", _count: { orders: 128, drivers: 6, customers: 842 }, subscriptions: [{ plan: { name: "Professional" } }] },
  { id: "res-2", name: "Northside Tacos", businessName: "Northside Tacos", businessType: "RESTAURANT", enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "DELIVERY_ZONES"], slug: "northside-tacos", status: "ACTIVE", _count: { orders: 76, drivers: 3, customers: 410 }, subscriptions: [{ plan: { name: "Starter" } }] },
  { id: "res-loohar", name: "Loohar Restaurant", businessName: "Loohar Restaurant", businessType: "RESTAURANT", enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"], slug: "loohar-restaurant", status: "ACTIVE", email: "subash.sunar@loohar.com", phone: "3032462749", address: "5371 Laredo Street", city: "Denver", state: "CO", zip: "80239", _count: { orders: 24, drivers: 1, customers: 86 }, subscriptions: [{ plan: { name: "Professional", code: "PROFESSIONAL" } }] },
  { id: "res-3", name: "Morning Pour", businessName: "Morning Pour", businessType: "COFFEE_SHOP", enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "LOYALTY", "FOOD_CATALOG"], slug: "morning-pour", status: "ACTIVE", _count: { orders: 44, drivers: 0, customers: 220 }, subscriptions: [{ plan: { name: "Starter" } }] },
  { id: "res-4", name: "Sweet Rise Bakery", businessName: "Sweet Rise Bakery", businessType: "BAKERY", enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "LOYALTY", "FOOD_CATALOG"], slug: "sweet-rise-bakery", status: "ACTIVE", _count: { orders: 38, drivers: 0, customers: 180 }, subscriptions: [{ plan: { name: "Starter" } }] },
  { id: "res-5", name: "Mile High Fuel Market", businessName: "Mile High Fuel Market", businessType: "GAS_STATION_FOOD_SHOP", enabledModules: ["FOOD_CATALOG", "PICKUP"], slug: "mile-high-fuel-market", status: "ACTIVE", _count: { orders: 0, drivers: 0, customers: 35 }, subscriptions: [{ plan: { name: "Starter" } }] },
  { id: "res-6", name: "Cork & Bottle", businessName: "Cork & Bottle", businessType: "LIQUOR_STORE", enabledModules: ["DELIVERY", "DRIVER_MANAGEMENT", "FOOD_CATALOG"], slug: "cork-bottle", status: "ACTIVE", _count: { orders: 0, drivers: 2, customers: 140 }, subscriptions: [{ plan: { name: "Professional" } }] }
];

export const demoWebsiteSettings = {
  websiteEnabled: true,
  heroTitle: "Seasonal Bistro Dining, Delivered Direct",
  heroSubtitle: "A polished neighborhood restaurant for modern comfort food, seasonal dinner specials, and direct pickup or delivery.",
  tagline: "Seasonal American Bistro",
  cuisineType: "Modern American",
  heroImageUrl: img("photo-1517248135467-4c7edcad34c4", 1800),
  logoUrl: img("photo-1555396273-367ea4eb4db5", 500),
  brandColor: "#10231f",
  accentColor: "#c9a45c",
  aboutTitle: "About Demo Bistro",
  aboutStory: "Demo Bistro began as a small dinner room built around seasonal produce, careful sourcing, and the belief that restaurants should own the relationship with their guests. Our team cooks familiar dishes with polished technique: crisp appetizers, composed salads, flame-grilled entrees, handmade desserts, and thoughtful drinks.",
  missionStatement: "Serve memorable food with gracious hospitality while keeping ordering, delivery, rewards, and guest relationships owned by the restaurant.",
  ownerStory: "Chef Maya and the opening team built Demo Bistro for guests who want a neighborhood place that still feels special. The menu balances comfort, craft, and practical direct ordering.",
  specialOfferText: "Use BISTRO10 for 10% off direct ordering.",
  seoTitle: "Demo Bistro | Order Online",
  seoDescription: "Order pickup and delivery directly from Demo Bistro."
};

export const demoDomain = {
  defaultSubdomain: "demo-bistro",
  customDomain: null,
  domainStatus: "NOT_CONFIGURED",
  dnsTarget: "sites.loohar.com",
  sslStatus: "NOT_CONFIGURED"
};

export const demoGallery = [
  { id: "gallery-1", imageUrl: img("photo-1414235077428-338989a2e8c0"), altText: "Demo Bistro dining room", category: "interior", sortOrder: 1 },
  { id: "gallery-2", imageUrl: img("photo-1551218808-94e220e084d2"), altText: "Chef plating dinner", category: "team", sortOrder: 2 },
  { id: "gallery-3", imageUrl: img("photo-1504674900247-0877df9cc836"), altText: "Seasonal bistro dish", category: "food", sortOrder: 3 },
  { id: "gallery-4", imageUrl: img("photo-1559339352-11d035aa65de"), altText: "Restaurant bar", category: "interior", sortOrder: 4 },
  { id: "gallery-5", imageUrl: img("photo-1550966871-3ed3cdb5ed0c"), altText: "Dinner service", category: "events", sortOrder: 5 },
  { id: "gallery-6", imageUrl: img("photo-1556911220-bff31c812dba"), altText: "Kitchen prep", category: "team", sortOrder: 6 }
];

export const demoSocialLinks = [
  { id: "social-1", platform: "instagram", url: "https://instagram.com/demobistro" },
  { id: "social-2", platform: "facebook", url: "https://facebook.com/demo-bistro" }
];

const compactOptionGroups = [demoModifierGroups.spice, demoModifierGroups.dietary];
const coffeeCategories = [
  { id: "coffee", name: "Coffee", items: [
    item({ id: "pour-over", name: "Single Origin Pour Over", description: "Rotating single-origin coffee brewed to order.", priceCents: 525, image: img("photo-1495474472287-4d71bcdd2085"), featured: true, badges: ["Vegan", "Dairy Free"], optionGroups: compactOptionGroups }),
    item({ id: "cold-brew", name: "Cold Brew", description: "Slow-steeped cold brew with a smooth chocolate finish.", priceCents: 495, image: img("photo-1461023058943-07fcbe16d735"), recommended: true, badges: ["Vegan", "Gluten Free"], optionGroups: compactOptionGroups })
  ] },
  { id: "espresso", name: "Espresso", items: [
    item({ id: "vanilla-latte", name: "Vanilla Latte", description: "Espresso, steamed milk, house vanilla.", priceCents: 575, image: img("photo-1570968915860-54d5c301fa9f"), featured: true, badges: ["Vegetarian"], optionGroups: compactOptionGroups }),
    item({ id: "cappuccino", name: "Cappuccino", description: "Classic espresso with dense foam and cocoa dust.", priceCents: 525, image: img("photo-1534778101976-62847782c213"), badges: ["Vegetarian"], optionGroups: compactOptionGroups })
  ] },
  { id: "pastries", name: "Pastries", items: [
    item({ id: "almond-croissant", name: "Almond Croissant", description: "Flaky croissant, almond cream, toasted almonds.", priceCents: 595, image: img("photo-1509440159596-0249088772ff"), recommended: true, badges: ["Vegetarian"], optionGroups: compactOptionGroups }),
    item({ id: "breakfast-sandwich", name: "Breakfast Sandwich", description: "Egg, cheddar, tomato jam, brioche.", priceCents: 895, image: img("photo-1550507992-eb63ffee0847"), badges: ["Vegetarian"], optionGroups: [demoModifierGroups.sauces, demoModifierGroups.dietary] })
  ] }
];

const bakeryCategories = [
  { id: "breads", name: "Breads", items: [
    item({ id: "sourdough-loaf", name: "Country Sourdough", description: "Naturally leavened loaf with crisp crust.", priceCents: 850, image: img("photo-1509440159596-0249088772ff"), featured: true, badges: ["Vegan", "Dairy Free"], optionGroups: compactOptionGroups }),
    item({ id: "brioche", name: "Pullman Brioche", description: "Tender enriched bread for breakfast or dessert.", priceCents: 925, image: img("photo-1549931319-a545dcf3bc73"), badges: ["Vegetarian"], optionGroups: compactOptionGroups })
  ] },
  { id: "cakes", name: "Cakes", items: [
    item({ id: "berry-cake", name: "Berry Cream Cake", description: "Vanilla sponge, berries, whipped cream.", priceCents: 3495, image: img("photo-1464349095431-e9a21285b5f3"), featured: true, badges: ["Vegetarian"], optionGroups: compactOptionGroups }),
    item({ id: "chocolate-tart", name: "Chocolate Ganache Tart", description: "Dark chocolate ganache in a crisp pastry shell.", priceCents: 795, image: img("photo-1519869325930-281384150729"), recommended: true, badges: ["Vegetarian"], optionGroups: compactOptionGroups })
  ] },
  { id: "cookies", name: "Cookies", items: [
    item({ id: "sea-salt-cookie", name: "Sea Salt Chocolate Chip Cookie", description: "Brown butter cookie with dark chocolate.", priceCents: 425, image: img("photo-1499636136210-6f4ee915583e"), badges: ["Vegetarian"], optionGroups: compactOptionGroups })
  ] }
];

const tacoCategories = [
  { id: "tacos", name: "Tacos", items: [
    item({ id: "carnitas-taco", name: "Carnitas Taco", description: "Slow pork, salsa verde, onion, cilantro.", priceCents: 495, image: img("photo-1565299585323-38d6b0865b47"), featured: true, badges: ["Gluten Free", "Spicy"], optionGroups: [demoModifierGroups.protein, demoModifierGroups.veggies, demoModifierGroups.sauces, demoModifierGroups.spice] }),
    item({ id: "mushroom-taco", name: "Roasted Mushroom Taco", description: "Mushrooms, peppers, crema, cotija.", priceCents: 450, image: img("photo-1551504734-5ee1c4a1479b"), badges: ["Vegetarian"], optionGroups: [demoModifierGroups.veggies, demoModifierGroups.sauces, demoModifierGroups.spice] })
  ] },
  { id: "burritos", name: "Burritos", items: [
    item({ id: "northside-burrito", name: "Northside Burrito", description: "Rice, beans, queso, pico, choice of protein.", priceCents: 1195, image: img("photo-1626700051175-6818013e1d4f"), featured: true, optionGroups: [demoModifierGroups.protein, demoModifierGroups.veggies, demoModifierGroups.sauces, demoModifierGroups.spice] })
  ] }
];

const marketCategories = [
  { id: "hot-food", name: "Hot Food", items: [
    item({ id: "market-breakfast-burrito", name: "Breakfast Burrito", description: "Egg, potato, cheese, green chile.", priceCents: 695, image: img("photo-1626700051175-6818013e1d4f"), featured: true, optionGroups: compactOptionGroups }),
    item({ id: "hot-pizza-slice", name: "Hot Pizza Slice", description: "Pepperoni or cheese, ready for pickup.", priceCents: 399, image: img("photo-1513104890138-7c749659a591"), recommended: true, optionGroups: compactOptionGroups })
  ] },
  { id: "snacks", name: "Snacks", items: [
    item({ id: "trail-mix", name: "Trail Mix", description: "Salty-sweet snack blend for the road.", priceCents: 499, image: img("photo-1599599810769-bcde5a160d32"), badges: ["Vegetarian"], optionGroups: [] }),
    item({ id: "cold-drink", name: "Cold Bottled Drink", description: "Chilled beverages and energy drinks.", priceCents: 299, image: img("photo-1523362628745-0c100150b504"), optionGroups: [] })
  ] }
];

const liquorCategories = [
  { id: "wine", name: "Wine", items: [
    item({ id: "pinot-noir", name: "Willamette Pinot Noir", description: "Elegant red wine with cherry and spice notes.", priceCents: 2895, image: img("photo-1510812431401-41d2bd2722f3"), featured: true, optionGroups: [] }),
    item({ id: "sauvignon-blanc", name: "Marlborough Sauvignon Blanc", description: "Bright citrus, tropical fruit, crisp finish.", priceCents: 1995, image: img("photo-1506377247377-2a5b3b417ebb"), optionGroups: [] })
  ] },
  { id: "beer", name: "Beer", items: [
    item({ id: "local-ipa", name: "Local IPA 6-Pack", description: "Hoppy local craft IPA.", priceCents: 1395, image: img("photo-1608270586620-248524c67de9"), recommended: true, optionGroups: [] })
  ] },
  { id: "mixers-snacks", name: "Mixers & Snacks", items: [
    item({ id: "tonic-water", name: "Premium Tonic Water", description: "Four-pack tonic mixer.", priceCents: 795, image: img("photo-1544145945-f90425340c7e"), optionGroups: [] })
  ] }
];

const looharCategories = [
  { id: "loohar-specials", name: "House Specials", items: [
    item({ id: "loohar-bowl", name: "Loohar Signature Bowl", description: "Rice, grilled protein, seasonal vegetables, house sauce.", priceCents: 1395, image: img("photo-1546069901-ba9599a7e63c"), featured: true, recommended: true, optionGroups: [demoModifierGroups.protein, demoModifierGroups.veggies, demoModifierGroups.sauces] }),
    item({ id: "loohar-wrap", name: "Grilled Chicken Wrap", description: "Grilled chicken, greens, pickled onion, garlic sauce.", priceCents: 1195, image: img("photo-1528735602780-2552fd46c7af"), recommended: true, optionGroups: [demoModifierGroups.sauces, demoModifierGroups.dietary] })
  ] },
  { id: "loohar-drinks", name: "Drinks", items: [
    item({ id: "loohar-lemonade", name: "House Lemonade", description: "Fresh lemon, mint, cane sugar.", priceCents: 495, image: img("photo-1621263764928-df1444c5e859"), badges: ["Vegan", "Gluten Free"], optionGroups: compactOptionGroups })
  ] }
];

const tenantSiteProfiles = {
  "demo-bistro": { categories: demoCategories, tagline: "Seasonal American Bistro", cuisineType: "Modern American", heroTitle: "Seasonal Bistro Dining, Delivered Direct", heroSubtitle: demoWebsiteSettings.heroSubtitle, heroImageUrl: demoWebsiteSettings.heroImageUrl, brandColor: "#10231f", accentColor: "#c9a45c", offer: "Use BISTRO10 for 10% off direct ordering.", gallery: demoGallery },
  "northside-tacos": { categories: tacoCategories, tagline: "Mexican Street Tacos", cuisineType: "Tacos & Burritos", heroTitle: "Street Tacos Without Marketplace Fees", heroSubtitle: "Fast tacos, burritos, bowls, pickup, and local delivery from the Northside kitchen.", heroImageUrl: img("photo-1565299585323-38d6b0865b47", 1800), logoUrl: img("photo-1551504734-5ee1c4a1479b", 500), brandColor: "#7c2d12", accentColor: "#facc15", offer: "Use TACO10 for direct-order savings." },
  "loohar-restaurant": { categories: looharCategories, tagline: "Direct Denver Ordering", cuisineType: "Local Restaurant", heroTitle: "Loohar Restaurant Direct Ordering", heroSubtitle: "Pickup and delivery from Loohar Restaurant at 5371 Laredo Street, Denver, CO 80239.", heroImageUrl: img("photo-1546069901-ba9599a7e63c", 1800), logoUrl: img("photo-1528735602780-2552fd46c7af", 500), brandColor: "#111827", accentColor: "#f59e0b", offer: "Use LOOHAR10 for direct ordering savings." },
  "morning-pour": { categories: coffeeCategories, tagline: "Neighborhood Coffee & Espresso Bar", cuisineType: "Coffee Shop", heroTitle: "Coffee, Espresso, and Breakfast Pickup", heroSubtitle: "A warm neighborhood coffee bar for espresso, pastries, breakfast sandwiches, and quick pickup.", heroImageUrl: img("photo-1495474472287-4d71bcdd2085", 1800), logoUrl: img("photo-1509042239860-f550ce710b93", 500), brandColor: "#4b2e1f", accentColor: "#d6a15f", offer: "Earn points on every morning pickup." },
  "sweet-rise-bakery": { categories: bakeryCategories, tagline: "Fresh Bakery & Custom Pastries", cuisineType: "Bakery", heroTitle: "Breads, Cakes, and Pastries Baked Daily", heroSubtitle: "Fresh loaves, cakes, cookies, breakfast pastries, and catering trays from a neighborhood bakery.", heroImageUrl: img("photo-1517433670267-08bbd4be890f", 1800), logoUrl: img("photo-1464349095431-e9a21285b5f3", 500), brandColor: "#831843", accentColor: "#f9a8d4", offer: "BAKERY10 for first-time direct orders." },
  "mile-high-fuel-market": { categories: marketCategories, tagline: "Fuel, Snacks & Fresh Food Market", cuisineType: "Gas Station Food Market", heroTitle: "Hot Food and Market Essentials On the Go", heroSubtitle: "Quick pickup for hot food, coffee, snacks, drinks, and grocery essentials.", heroImageUrl: img("photo-1571091718767-18b5b1457add", 1800), logoUrl: img("photo-1542838132-92c53300491e", 500), brandColor: "#0f766e", accentColor: "#f97316", offer: "Fast pickup for road-trip essentials." },
  "cork-bottle": { categories: liquorCategories, tagline: "Local Beverage & Bottle Shop", cuisineType: "Wine, Beer & Mixers", heroTitle: "Bottle Shop Pickup and Regulated Delivery", heroSubtitle: "Wine, beer, mixers, and snacks with age verification and local compliance placeholders.", heroImageUrl: img("photo-1510812431401-41d2bd2722f3", 1800), logoUrl: img("photo-1506377247377-2a5b3b417ebb", 500), brandColor: "#3b0764", accentColor: "#f59e0b", offer: "Age verification required for regulated products.", complianceNote: "Age verification and local delivery compliance placeholder." }
};

export function demoWebsiteBundle(slug = "demo-bistro") {
  const listing = demoRestaurants.find((restaurant) => restaurant.slug === slug) || demoRestaurants[0];
  const profile = tenantSiteProfiles[listing.slug] || tenantSiteProfiles["demo-bistro"];
  const restaurant = { ...demoRestaurant, ...listing, description: listing.description || profile.heroSubtitle, categories: profile.categories, phone: listing.phone || demoRestaurant.phone, email: listing.email || demoRestaurant.email };
  const gallery = (profile.gallery || demoGallery.map((image) => ({ ...image, imageUrl: image.imageUrl, altText: image.altText.replace("Demo Bistro", listing.businessName || listing.name) })));
  return {
    restaurant,
    website: {
      ...demoWebsiteSettings,
      heroTitle: listing.businessName || listing.name,
      heroSubtitle: profile.heroSubtitle,
      tagline: profile.tagline,
      cuisineType: profile.cuisineType,
      heroImageUrl: profile.heroImageUrl,
      logoUrl: profile.logoUrl || demoWebsiteSettings.logoUrl,
      brandColor: profile.brandColor,
      accentColor: profile.accentColor,
      specialOfferText: profile.offer,
      aboutTitle: `About ${listing.businessName || listing.name}`,
      aboutStory: `${listing.businessName || listing.name} is built for direct food-commerce ordering with a website, catalog, loyalty, and customer relationship owned by the business.`,
      seoTitle: `${listing.businessName || listing.name} | Order Online`
    },
    domain: { ...demoDomain, defaultSubdomain: listing.slug },
    gallery,
    socialLinks: demoSocialLinks,
    complianceNote: profile.complianceNote,
    seo: { title: `${listing.businessName || listing.name} | Order Online`, description: profile.heroSubtitle, openGraphImage: profile.heroImageUrl },
    routes: {
      home: `/sites/${listing.slug}`,
      menu: `/sites/${listing.slug}/menu`,
      order: `/sites/${listing.slug}/order`,
      about: `/sites/${listing.slug}/about`,
      contact: `/sites/${listing.slug}/contact`,
      gallery: `/sites/${listing.slug}/gallery`,
      loyalty: `/sites/${listing.slug}/loyalty`,
      catering: `/sites/${listing.slug}/catering`,
      careers: `/sites/${listing.slug}/careers`
    }
  };
}

export const demoAudit = [
  { id: "log-1", action: "restaurant.created", entityType: "Restaurant", restaurant: { name: "Northside Tacos" }, actor: { name: "Platform Admin" } },
  { id: "log-2", action: "restaurant.profile.updated", entityType: "Restaurant", restaurant: { name: "Demo Bistro" }, actor: { name: "Demo Owner" } }
];

import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const passwords = {
  admin: "Admin123!",
  looharSuperAdmin: "Welcome12!",
  looharOwner: "Welcome2026!",
  owner: "Owner123!",
  staff: "Staff123!",
  driver: "Driver123!",
  customer: "Customer123!"
};

async function hash(password) {
  return bcrypt.hash(password, 12);
}

async function hasPermanentPassword(email) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { forcePasswordChange: true, temporaryPassword: true, passwordChangedAt: true }
  });
  if (!user) return false;
  return Boolean(user.passwordChangedAt || (!user.forcePasswordChange && !user.temporaryPassword));
}

const demoImage = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`;
const restaurantLocationDefaults = {
  "demo-bistro": { city: "Denver", state: "CO", zip: "80202", latitude: 39.752, longitude: -104.998, deliveryRadiusMiles: 6 },
  "northside-tacos": { city: "Denver", state: "CO", zip: "80211", latitude: 39.761, longitude: -105.012, deliveryRadiusMiles: 5 },
  "loohar-restaurant": { city: "Denver", state: "CO", zip: "80239", latitude: 39.792, longitude: -104.775, deliveryRadiusMiles: 7 },
  "archie-s-lodge": { city: "Denver", state: "CO", zip: "80202", latitude: 39.753, longitude: -104.999, deliveryRadiusMiles: 6 },
  "morning-pour": { city: "Denver", state: "CO", zip: "80205", latitude: 39.759, longitude: -104.985, deliveryRadiusMiles: 2 },
  "sweet-rise-bakery": { city: "Denver", state: "CO", zip: "80203", latitude: 39.736, longitude: -104.984, deliveryRadiusMiles: 2 },
  "rolling-dumpling-truck": { city: "Denver", state: "CO", zip: "80202", latitude: 39.751, longitude: -104.995, deliveryRadiusMiles: 1 },
  "mile-high-fuel-market": { city: "Denver", state: "CO", zip: "80216", latitude: 39.779, longitude: -104.972, deliveryRadiusMiles: 3 },
  "cork-bottle": { city: "Denver", state: "CO", zip: "80206", latitude: 39.722, longitude: -104.956, deliveryRadiusMiles: 5 }
};

function seedOptionGroups(itemId) {
  return [
    {
      id: `${itemId}-protein`,
      name: "Choose protein",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 1,
      options: [
        { name: "Chicken", priceCents: 0, isDefault: true },
        { name: "Beef", priceCents: 250 },
        { name: "Salmon", priceCents: 600 },
        { name: "Shrimp", priceCents: 500 },
        { name: "Tofu", priceCents: 0 },
        { name: "Paneer", priceCents: 300 }
      ]
    },
    {
      id: `${itemId}-side`,
      name: "Choose side",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 2,
      options: ["Fries", "Rice", "Salad", "Soup", "Seasonal Vegetables"].map((name, index) => ({ name, priceCents: index > 2 ? 150 : 0, isDefault: index === 0 }))
    },
    {
      id: `${itemId}-sauce`,
      name: "Add sauce",
      required: false,
      minSelect: 0,
      maxSelect: 3,
      sortOrder: 3,
      options: ["Ranch", "Garlic Aioli", "Buffalo", "Teriyaki", "House Sauce", "Hot Sauce"].map((name) => ({ name, priceCents: 75 }))
    },
    {
      id: `${itemId}-spice`,
      name: "Spice level",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 4,
      options: ["Mild", "Medium", "Hot", "Extra Hot"].map((name, index) => ({ name, priceCents: 0, isDefault: index === 1 }))
    }
  ];
}

function seedItem(id, name, description, priceCents, imageUrl, extra = {}) {
  return { id, name, description, priceCents, imageUrl, preparationTimeMins: extra.preparationTimeMins || 16, options: [], optionGroups: seedOptionGroups(id), ...extra };
}

async function seedPlans() {
  return Promise.all([
    prisma.subscriptionPlan.upsert({
      where: { code: "STARTER" },
      update: { name: "Starter", monthlyPriceCents: 9900, technologyFeeBps: 75, maxLocations: 1, maxDrivers: 5, featuresJson: ["Ordering", "Pickup"] },
      create: { code: "STARTER", name: "Starter", monthlyPriceCents: 9900, technologyFeeBps: 75, maxLocations: 1, maxDrivers: 5, featuresJson: ["Ordering", "Pickup"] }
    }),
    prisma.subscriptionPlan.upsert({
      where: { code: "PROFESSIONAL" },
      update: { name: "Professional", monthlyPriceCents: 19900, technologyFeeBps: 50, maxLocations: 5, maxDrivers: 25, featuresJson: ["Delivery", "Driver Management", "Loyalty", "Coupons"] },
      create: { code: "PROFESSIONAL", name: "Professional", monthlyPriceCents: 19900, technologyFeeBps: 50, maxLocations: 5, maxDrivers: 25, featuresJson: ["Delivery", "Driver Management", "Loyalty", "Coupons"] }
    }),
    prisma.subscriptionPlan.upsert({
      where: { code: "ENTERPRISE" },
      update: { name: "Enterprise", monthlyPriceCents: 49900, technologyFeeBps: 25, maxLocations: null, maxDrivers: null, featuresJson: ["Analytics", "Advanced CRM", "Multi-location"] },
      create: { code: "ENTERPRISE", name: "Enterprise", monthlyPriceCents: 49900, technologyFeeBps: 25, maxLocations: null, maxDrivers: null, featuresJson: ["Analytics", "Advanced CRM", "Multi-location"] }
    })
  ]);
}

function permissionsForRole(role) {
  const permissions = {
    RESTAURANT_MANAGER: ["orders", "kitchen", "employees", "drivers", "inventory", "reports", "settings"],
    CASHIER: ["orders", "receipts", "customers"],
    KITCHEN_STAFF: ["kitchen", "orders"],
    RESTAURANT_OWNER: ["all"]
  };
  return permissions[role] || ["orders"];
}

async function seedEmployee({ restaurant, email, name, phone, role }) {
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, phone, restaurantId: restaurant.id, role, status: "ACTIVE" },
    create: {
      email,
      name,
      phone,
      passwordHash: await hash(passwords.staff),
      role,
      restaurantId: restaurant.id,
      status: "ACTIVE"
    }
  });
  await prisma.restaurantStaff.upsert({
    where: { userId: user.id },
    update: { restaurantId: restaurant.id, role, active: true, permissionsJson: permissionsForRole(role) },
    create: { userId: user.id, restaurantId: restaurant.id, role, active: true, permissionsJson: permissionsForRole(role) }
  });
  return user;
}

async function seedRestaurant({ restaurant, owner, drivers, customers, categories, couponCode, planId }) {
  const restaurantRecord = {
    deliveryRadiusMiles: 5,
    ...(restaurantLocationDefaults[restaurant.slug] || {}),
    ...restaurant
  };
  const savedRestaurant = await prisma.restaurant.upsert({
    where: { slug: restaurantRecord.slug },
    update: restaurantRecord,
    create: {
      ...restaurantRecord,
      subscriptions: { create: { planId } }
    }
  });

  const ownerHasPermanentPassword = await hasPermanentPassword(owner.email);
  const ownerIsTemporary = Boolean(owner.forcePasswordChange) && !ownerHasPermanentPassword;
  const ownerUser = await prisma.user.upsert({
    where: { email: owner.email },
    update: {
      name: owner.name,
      restaurantId: savedRestaurant.id,
      role: "RESTAURANT_OWNER",
      status: "ACTIVE",
      ...(ownerHasPermanentPassword ? {} : {
        forcePasswordChange: Boolean(owner.forcePasswordChange),
        temporaryPassword: ownerIsTemporary,
        ...(owner.password ? { passwordHash: await hash(owner.password) } : {})
      })
    },
    create: {
      email: owner.email,
      name: owner.name,
      passwordHash: await hash(owner.password || passwords.owner),
      role: "RESTAURANT_OWNER",
      restaurantId: savedRestaurant.id,
      status: "ACTIVE",
      forcePasswordChange: Boolean(owner.forcePasswordChange),
      temporaryPassword: Boolean(owner.forcePasswordChange),
      passwordChangedAt: owner.forcePasswordChange ? null : new Date()
    }
  });
  await prisma.restaurantStaff.upsert({
    where: { userId: ownerUser.id },
    update: { restaurantId: savedRestaurant.id, role: "RESTAURANT_OWNER", active: true },
    create: { userId: ownerUser.id, restaurantId: savedRestaurant.id, role: "RESTAURANT_OWNER" }
  });

  const savedDrivers = [];
  for (const driver of drivers) {
    const driverUser = await prisma.user.upsert({
      where: { email: driver.email },
      update: { name: driver.name, phone: driver.phone, restaurantId: savedRestaurant.id, role: "DRIVER" },
      create: {
        email: driver.email,
        name: driver.name,
        phone: driver.phone,
        passwordHash: await hash(passwords.driver),
        role: "DRIVER",
        restaurantId: savedRestaurant.id
      }
    });
    savedDrivers.push(await prisma.driver.upsert({
      where: { userId: driverUser.id },
      update: { restaurantId: savedRestaurant.id, available: driver.available, currentLat: driver.currentLat, currentLng: driver.currentLng },
      create: { userId: driverUser.id, restaurantId: savedRestaurant.id, available: driver.available, currentLat: driver.currentLat, currentLng: driver.currentLng }
    }));
  }

  const savedCustomers = [];
  for (const customer of customers) {
    const customerUser = await prisma.user.upsert({
      where: { email: customer.email },
      update: { name: customer.name, phone: customer.phone, restaurantId: savedRestaurant.id, role: "CUSTOMER" },
      create: {
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        passwordHash: await hash(passwords.customer),
        role: "CUSTOMER",
        restaurantId: savedRestaurant.id
      }
    });
    savedCustomers.push(await prisma.customer.upsert({
      where: { restaurantId_email: { restaurantId: savedRestaurant.id, email: customer.email } },
      update: { name: customer.name, phone: customer.phone, defaultAddress: customer.defaultAddress, userId: customerUser.id },
      create: { ...customer, userId: customerUser.id, restaurantId: savedRestaurant.id }
    }));
  }

  const savedItems = [];
  for (const category of categories) {
    const savedCategory = await prisma.menuCategory.upsert({
      where: { id: category.id },
      update: { restaurantId: savedRestaurant.id, name: category.name, sortOrder: category.sortOrder, active: true },
      create: { id: category.id, restaurantId: savedRestaurant.id, name: category.name, sortOrder: category.sortOrder }
    });

    for (const item of category.items) {
      await prisma.menuItemOption.deleteMany({ where: { menuItemId: item.id } });
      await prisma.menuItemOptionGroup.deleteMany({ where: { menuItemId: item.id } });
      savedItems.push(await prisma.menuItem.upsert({
        where: { id: item.id },
        update: {
          restaurantId: savedRestaurant.id,
          categoryId: savedCategory.id,
          name: item.name,
          description: item.description,
          imageUrl: item.imageUrl,
          priceCents: item.priceCents,
          preparationTimeMins: item.preparationTimeMins,
          available: item.available ?? true,
          featured: item.featured ?? false,
          recommended: item.recommended ?? false,
          isGlutenFree: item.isGlutenFree ?? false,
          isVegetarian: item.isVegetarian ?? false,
          isVegan: item.isVegan ?? false,
          isSpicy: item.isSpicy ?? false,
          isDairyFree: item.isDairyFree ?? false,
          isNutFree: item.isNutFree ?? false,
          options: { create: item.options || [] }
        },
        create: {
          id: item.id,
          restaurantId: savedRestaurant.id,
          categoryId: savedCategory.id,
          name: item.name,
          description: item.description,
          imageUrl: item.imageUrl,
          priceCents: item.priceCents,
          preparationTimeMins: item.preparationTimeMins,
          available: item.available ?? true,
          featured: item.featured ?? false,
          recommended: item.recommended ?? false,
          isGlutenFree: item.isGlutenFree ?? false,
          isVegetarian: item.isVegetarian ?? false,
          isVegan: item.isVegan ?? false,
          isSpicy: item.isSpicy ?? false,
          isDairyFree: item.isDairyFree ?? false,
          isNutFree: item.isNutFree ?? false,
          options: { create: item.options || [] }
        }
      }));
      for (const group of item.optionGroups || []) {
        const { options, ...groupData } = group;
        await prisma.menuItemOptionGroup.create({
          data: {
            ...groupData,
            menuItemId: item.id,
            options: { create: (options || []).map((option, index) => ({ ...option, menuItemId: item.id, sortOrder: option.sortOrder ?? index })) }
          }
        });
      }
    }
  }

  await prisma.coupon.upsert({
    where: { restaurantId_code: { restaurantId: savedRestaurant.id, code: couponCode } },
    update: { description: "Seed loyalty offer", percentOff: 10, active: true },
    create: { restaurantId: savedRestaurant.id, code: couponCode, description: "Seed loyalty offer", percentOff: 10 }
  });

  await prisma.restaurantLocation.upsert({
    where: { id: `${savedRestaurant.slug}-main-location` },
    update: { name: `${savedRestaurant.name} Main`, address: savedRestaurant.address, phone: savedRestaurant.phone, timezone: savedRestaurant.timezone },
    create: { id: `${savedRestaurant.slug}-main-location`, restaurantId: savedRestaurant.id, name: `${savedRestaurant.name} Main`, address: savedRestaurant.address, phone: savedRestaurant.phone, timezone: savedRestaurant.timezone }
  });

  await prisma.restaurantPrinterSettings.upsert({
    where: { restaurantId: savedRestaurant.id },
    update: { kitchenPrinterName: "Kitchen Printer", kitchenPrinterEnabled: true, frontCounterPrinterName: "Front Counter", frontCounterPrinterEnabled: true, provider: "browser_print" },
    create: { restaurantId: savedRestaurant.id, kitchenPrinterName: "Kitchen Printer", kitchenPrinterEnabled: true, frontCounterPrinterName: "Front Counter", frontCounterPrinterEnabled: true, provider: "browser_print" }
  });

  await prisma.restaurantNotificationSettings.upsert({
    where: { restaurantId: savedRestaurant.id },
    update: { smsEnabled: false, emailEnabled: true, orderConfirmationEmail: true, receiptEmail: true, welcomeEmail: true },
    create: { restaurantId: savedRestaurant.id, smsEnabled: false, emailEnabled: true, orderConfirmationEmail: true, receiptEmail: true, welcomeEmail: true }
  });

  if (savedRestaurant.deliveryEnabled) {
    const zones = [
      { name: "Zone A", radiusMiles: 3, deliveryFeeCents: savedRestaurant.deliveryFeeCents || 399, minimumOrderCents: 1500 },
      { name: "Zone B", radiusMiles: 6, deliveryFeeCents: (savedRestaurant.deliveryFeeCents || 399) + 200, minimumOrderCents: 2500 },
      { name: "Zone C", radiusMiles: 10, deliveryFeeCents: (savedRestaurant.deliveryFeeCents || 399) + 400, minimumOrderCents: 3500 }
    ];
    for (const zone of zones) {
      await prisma.deliveryZone.upsert({
        where: { restaurantId_name: { restaurantId: savedRestaurant.id, name: zone.name } },
        update: { ...zone, active: true, mapSettingsJson: { provider: "future_map_integration" } },
        create: { ...zone, restaurantId: savedRestaurant.id, active: true, mapSettingsJson: { provider: "future_map_integration" } }
      });
    }
  }

  const inventoryItems = [
    { name: "Chicken", quantity: 42, unit: "lb", costCents: 2600, lowStockAt: 10 },
    { name: "Rice", quantity: 80, unit: "lb", costCents: 1200, lowStockAt: 20 },
    { name: "Cheese", quantity: 24, unit: "lb", costCents: 1800, lowStockAt: 8 },
    { name: "Tomatoes", quantity: 18, unit: "case", costCents: 1800, lowStockAt: 5 }
  ];
  for (const item of inventoryItems) {
    await prisma.inventoryItem.upsert({
      where: { restaurantId_name: { restaurantId: savedRestaurant.id, name: item.name } },
      update: { ...item, active: true },
      create: { ...item, restaurantId: savedRestaurant.id, active: true }
    });
  }

  return { restaurant: savedRestaurant, owner: ownerUser, drivers: savedDrivers, customers: savedCustomers, items: savedItems };
}

async function seedRewards(restaurantId) {
  const rewards = [
    { id: `${restaurantId}-free-drink`, name: "Free drink", type: "FREE_DRINK", pointsRequired: 150 },
    { id: `${restaurantId}-free-appetizer`, name: "Free appetizer", type: "FREE_APPETIZER", pointsRequired: 300 },
    { id: `${restaurantId}-discount`, name: "$5 discount coupon", type: "DISCOUNT_COUPON", pointsRequired: 500 },
    { id: `${restaurantId}-free-delivery`, name: "Free delivery", type: "FREE_DELIVERY", pointsRequired: 250 }
  ];
  for (const reward of rewards) {
    await prisma.loyaltyReward.upsert({
      where: { id: reward.id },
      update: { name: reward.name, type: reward.type, pointsRequired: reward.pointsRequired, active: true },
      create: { ...reward, restaurantId }
    });
  }
}

async function seedWebsiteAssets(restaurant, overrides = {}) {
  const brandColor = overrides.brandColor || restaurant.brandingJson?.primaryColor || "#1f9d80";
  const accentColor = overrides.accentColor || "#f4b740";
  await prisma.restaurantWebsiteSettings.upsert({
    where: { restaurantId: restaurant.id },
    update: {
      websiteEnabled: true,
      heroTitle: overrides.heroTitle || restaurant.businessName || restaurant.name,
      heroSubtitle: overrides.heroSubtitle || restaurant.description,
      tagline: overrides.tagline || "Seasonal direct ordering",
      cuisineType: overrides.cuisineType || "Modern American",
      heroImageUrl: overrides.heroImageUrl || demoImage("photo-1517248135467-4c7edcad34c4"),
      logoUrl: overrides.logoUrl || demoImage("photo-1555396273-367ea4eb4db5"),
      brandColor,
      accentColor,
      aboutTitle: overrides.aboutTitle || `About ${restaurant.businessName || restaurant.name}`,
      aboutStory: overrides.aboutStory || `${restaurant.businessName || restaurant.name} uses direct ordering so guests can support the restaurant, earn rewards, and avoid marketplace friction.`,
      missionStatement: overrides.missionStatement || "Serve guests directly with great food, transparent pickup and delivery, and local customer relationships.",
      ownerStory: overrides.ownerStory || "Owner and chef story placeholder.",
      specialOfferText: overrides.specialOfferText || "Order direct for loyalty points and restaurant-owned offers.",
      seoTitle: overrides.seoTitle || `${restaurant.businessName || restaurant.name} | Order Online`,
      seoDescription: overrides.seoDescription || restaurant.description
    },
    create: {
      restaurantId: restaurant.id,
      websiteEnabled: true,
      heroTitle: overrides.heroTitle || restaurant.businessName || restaurant.name,
      heroSubtitle: overrides.heroSubtitle || restaurant.description,
      tagline: overrides.tagline || "Seasonal direct ordering",
      cuisineType: overrides.cuisineType || "Modern American",
      heroImageUrl: overrides.heroImageUrl || demoImage("photo-1517248135467-4c7edcad34c4"),
      logoUrl: overrides.logoUrl || demoImage("photo-1555396273-367ea4eb4db5"),
      brandColor,
      accentColor,
      aboutTitle: overrides.aboutTitle || `About ${restaurant.businessName || restaurant.name}`,
      aboutStory: overrides.aboutStory || `${restaurant.businessName || restaurant.name} uses direct ordering so guests can support the restaurant, earn rewards, and avoid marketplace friction.`,
      missionStatement: overrides.missionStatement || "Serve guests directly with great food, transparent pickup and delivery, and local customer relationships.",
      ownerStory: overrides.ownerStory || "Owner and chef story placeholder.",
      specialOfferText: overrides.specialOfferText || "Order direct for loyalty points and restaurant-owned offers.",
      seoTitle: overrides.seoTitle || `${restaurant.businessName || restaurant.name} | Order Online`,
      seoDescription: overrides.seoDescription || restaurant.description
    }
  });
  const defaultHost = `${restaurant.slug}.loohar.com`;
  await prisma.restaurantDomain.upsert({
    where: { restaurantId_defaultSubdomain: { restaurantId: restaurant.id, defaultSubdomain: restaurant.slug } },
    update: {
      primaryDomain: overrides.customDomain && overrides.domainStatus === "ACTIVE" ? overrides.customDomain : defaultHost,
      canonicalDomain: overrides.customDomain && overrides.domainStatus === "ACTIVE" ? overrides.customDomain : defaultHost,
      customDomain: overrides.customDomain || null,
      domainStatus: overrides.domainStatus || "NOT_CONFIGURED",
      dnsTarget: overrides.dnsTarget || "cname.vercel-dns.com",
      sslStatus: overrides.sslStatus || "NOT_CONFIGURED",
      domainVerifiedAt: ["VERIFIED", "SSL_PENDING", "ACTIVE"].includes(overrides.domainStatus) ? new Date() : null
    },
    create: {
      restaurantId: restaurant.id,
      defaultSubdomain: restaurant.slug,
      primaryDomain: overrides.customDomain && overrides.domainStatus === "ACTIVE" ? overrides.customDomain : defaultHost,
      canonicalDomain: overrides.customDomain && overrides.domainStatus === "ACTIVE" ? overrides.customDomain : defaultHost,
      customDomain: overrides.customDomain || null,
      domainStatus: overrides.domainStatus || "NOT_CONFIGURED",
      dnsTarget: overrides.dnsTarget || "cname.vercel-dns.com",
      sslStatus: overrides.sslStatus || "NOT_CONFIGURED",
      domainVerifiedAt: ["VERIFIED", "SSL_PENDING", "ACTIVE"].includes(overrides.domainStatus) ? new Date() : null
    }
  });
  await prisma.restaurantGalleryImage.deleteMany({ where: { restaurantId: restaurant.id } });
  await prisma.restaurantSocialLink.deleteMany({ where: { restaurantId: restaurant.id } });
  const galleryImages = [
    { label: "dining room", imageUrl: demoImage("photo-1414235077428-338989a2e8c0"), category: "interior" },
    { label: "chef plating dinner", imageUrl: demoImage("photo-1551218808-94e220e084d2"), category: "team" },
    { label: "seasonal dish", imageUrl: demoImage("photo-1504674900247-0877df9cc836"), category: "food" },
    { label: "restaurant bar", imageUrl: demoImage("photo-1559339352-11d035aa65de"), category: "interior" },
    { label: "dinner service", imageUrl: demoImage("photo-1550966871-3ed3cdb5ed0c"), category: "events" },
    { label: "kitchen prep", imageUrl: demoImage("photo-1556911220-bff31c812dba"), category: "team" }
  ];
  await prisma.restaurantGalleryImage.createMany({
    data: galleryImages.map((image, index) => ({
      restaurantId: restaurant.id,
      imageUrl: image.imageUrl,
      altText: `${restaurant.businessName || restaurant.name} ${image.label}`,
      category: image.category,
      sortOrder: index + 1
    }))
  });
  await prisma.restaurantSocialLink.createMany({
    data: [
      { restaurantId: restaurant.id, platform: "instagram", url: `https://instagram.com/${restaurant.slug.replaceAll("-", "")}` },
      { restaurantId: restaurant.id, platform: "facebook", url: `https://facebook.com/${restaurant.slug}` }
    ]
  });
}

async function seedOrder({ id, orderNumber, restaurant, customer, items, driver, status, type, deliveryAddress, tipCents }) {
  const subtotalCents = items.reduce((sum, item) => sum + item.menuItem.priceCents * item.quantity, 0);
  const deliveryFeeCents = type === "DELIVERY" ? restaurant.deliveryFeeCents : 0;
  const taxCents = Math.round(subtotalCents * 0.0825);
  const restaurantTipCents = type === "DELIVERY" ? 0 : tipCents;
  const driverTipCents = type === "DELIVERY" ? tipCents : 0;
  const totalCents = subtotalCents + deliveryFeeCents + taxCents + tipCents;

  await prisma.payment.deleteMany({ where: { orderId: id } });
  await prisma.deliveryStatusHistory.deleteMany({ where: { delivery: { orderId: id } } });
  await prisma.delivery.deleteMany({ where: { orderId: id } });
  await prisma.loyaltyPoint.deleteMany({ where: { orderId: id } });
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: id } });
  await prisma.orderItem.deleteMany({ where: { orderId: id } });

  const order = await prisma.order.upsert({
    where: { id },
    update: {
      restaurantId: restaurant.id,
      customerId: customer.id,
      orderNumber,
      type,
      status,
      subtotalCents,
      deliveryFeeCents,
      taxCents,
      tipCents,
      restaurantTipCents,
      driverTipCents,
      tipType: tipCents > 0 ? "SEEDED" : "NONE",
      tipStatus: tipCents > 0 ? "COLLECTED" : "NONE",
      tipCollectedAt: tipCents > 0 ? new Date() : null,
      totalCents,
      deliveryAddress,
      notes: "Seed sample order",
      items: {
        create: items.map((item) => ({
          menuItemId: item.menuItem.id,
          name: item.menuItem.name,
          quantity: item.quantity,
          unitPriceCents: item.menuItem.priceCents,
          optionsJson: item.options || []
        }))
      },
      statusHistory: {
        create: [{ status: "PENDING", note: "Seed order placed" }, { status, note: "Seed current status" }]
      }
    },
    create: {
      id,
      restaurantId: restaurant.id,
      customerId: customer.id,
      orderNumber,
      type,
      status,
      subtotalCents,
      deliveryFeeCents,
      taxCents,
      tipCents,
      restaurantTipCents,
      driverTipCents,
      tipType: tipCents > 0 ? "SEEDED" : "NONE",
      tipStatus: tipCents > 0 ? "COLLECTED" : "NONE",
      tipCollectedAt: tipCents > 0 ? new Date() : null,
      totalCents,
      deliveryAddress,
      notes: "Seed sample order",
      items: {
        create: items.map((item) => ({
          menuItemId: item.menuItem.id,
          name: item.menuItem.name,
          quantity: item.quantity,
          unitPriceCents: item.menuItem.priceCents,
          optionsJson: item.options || []
        }))
      },
      statusHistory: {
        create: [{ status: "PENDING", note: "Seed order placed" }, { status, note: "Seed current status" }]
      }
    }
  });

  await prisma.payment.create({
    data: {
      orderId: order.id,
      status: "AUTHORIZED",
      amountCents: totalCents,
      technologyFeeCents: Math.round(totalCents * 0.005),
      restaurantNetCents: totalCents - Math.round(totalCents * 0.005) - driverTipCents,
      driverTipCents
    }
  });

  if (type === "DELIVERY" && driver) {
    await prisma.delivery.create({
      data: {
        restaurantId: restaurant.id,
        orderId: order.id,
        driverId: driver.id,
        status: status === "DELIVERED" ? "DELIVERED" : "ASSIGNED",
        claimedAt: status === "DELIVERED" ? new Date() : null,
        pickedUpAt: status === "DELIVERED" ? new Date() : null,
        deliveredAt: status === "DELIVERED" ? new Date() : null,
        pickupAddress: restaurant.address,
        dropoffAddress: deliveryAddress,
        baseEarningsCents: 650,
        tipCents: driverTipCents,
        statusHistory: { create: [{ status: "ASSIGNED", note: "Seed driver assignment" }] }
      }
    });
  }

  await prisma.loyaltyPoint.create({
    data: {
      restaurantId: restaurant.id,
      customerId: customer.id,
      orderId: order.id,
      points: Math.floor(totalCents / 100),
      reason: "Seed order reward"
    }
  });

  return order;
}

async function main() {
  const [starter, professional, enterprise] = await seedPlans();
  const isProductionSeed = process.env.NODE_ENV === "production";

  const admin = await prisma.user.upsert({
    where: { email: "admin@platform.local" },
    update: { name: "Platform Admin", role: "SUPER_ADMIN", status: isProductionSeed ? "DISABLED" : "ACTIVE" },
    create: {
      email: "admin@platform.local",
      name: "Platform Admin",
      passwordHash: await hash(passwords.admin),
      role: "SUPER_ADMIN",
      status: isProductionSeed ? "DISABLED" : "ACTIVE",
      passwordChangedAt: new Date()
    }
  });

  const looharSuperAdminHasPermanentPassword = await hasPermanentPassword("subash.sunar@loohar.com");
  const looharSuperAdmin = await prisma.user.upsert({
    where: { email: "subash.sunar@loohar.com" },
    update: {
      name: "Subash Sunar",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      restaurantId: null,
      mfaEnabled: false,
      mfaSetupStatus: "NOT_CONFIGURED",
      mfaSecret: null,
      mfaVerifiedAt: null,
      ...(looharSuperAdminHasPermanentPassword ? {} : {
        passwordHash: await hash(passwords.looharSuperAdmin),
        forcePasswordChange: true,
        temporaryPassword: true
      })
    },
    create: {
      email: "subash.sunar@loohar.com",
      name: "Subash Sunar",
      passwordHash: await hash(passwords.looharSuperAdmin),
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      forcePasswordChange: true,
      temporaryPassword: true,
      mfaEnabled: false,
      mfaSetupStatus: "NOT_CONFIGURED"
    }
  });
  await prisma.restaurantStaff.deleteMany({ where: { userId: looharSuperAdmin.id } });

  const demo = await seedRestaurant({
    planId: professional.id,
    couponCode: "BISTRO10",
    restaurant: {
      name: "Demo Bistro",
      businessName: "Demo Bistro",
      businessType: "RESTAURANT",
      enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"],
      slug: "demo-bistro",
      status: "ACTIVE",
      description: "Fresh bowls, sandwiches, and neighborhood delivery.",
      phone: "555-0101",
      email: "hello@demobistro.local",
      address: "100 Main St, Denver, CO",
      timezone: "America/Denver",
      brandingJson: { primaryColor: "#1f9d80" },
      deliveryEnabled: true,
      pickupEnabled: true,
      deliveryFeeCents: 399,
      loyaltySettingsJson: { pointsPerDollar: 1, welcomeBonus: 100, birthdayRewardsPlaceholder: true, referralRewardPlaceholder: true },
      storeHoursJson: { monday: "9:00 AM - 9:00 PM", tuesday: "9:00 AM - 9:00 PM", wednesday: "9:00 AM - 9:00 PM" },
      settingsJson: { socialLinks: { instagram: "https://instagram.com/demobistro" } }
    },
    owner: { email: "owner@demobistro.local", name: "Demo Owner" },
    drivers: [
      { email: "driver@demobistro.local", name: "Alex Driver", phone: "555-0133", available: true, currentLat: 39.7392, currentLng: -104.9903 },
      { email: "sam.driver@demobistro.local", name: "Sam Rivera", phone: "555-0144", available: false, currentLat: 39.75, currentLng: -104.98 }
    ],
    customers: [
      { email: "customer@demo.local", name: "Maya Chen", phone: "555-0166", defaultAddress: "2425 Market St, Denver, CO" },
      { email: "jon.customer@demo.local", name: "Jon Miller", phone: "555-0177", defaultAddress: "1800 Blake St, Denver, CO" }
    ],
    categories: [
      { id: "cat-appetizers", name: "Appetizers", sortOrder: 1, items: [
        seedItem("crispy-calamari", "Crispy Calamari", "Lightly fried calamari, lemon, herbs, spicy marinara.", 1495, demoImage("photo-1599487488170-d11ec9c172f0"), { featured: true, isDairyFree: true }),
        seedItem("garlic-parmesan-wings", "Garlic Parmesan Wings", "Crisp wings tossed with roasted garlic, parmesan, parsley.", 1395, demoImage("photo-1567620832903-9fc6debc209f"), { recommended: true, isSpicy: true }),
        seedItem("spinach-artichoke-dip", "Spinach Artichoke Dip", "Creamy baked dip with artichokes, spinach, warm crostini.", 1195, demoImage("photo-1541014741259-de529411b96a"), { isVegetarian: true })
      ] },
      { id: "cat-soups-salads", name: "Soups & Salads", sortOrder: 2, items: [
        seedItem("caesar-salad", "Caesar Salad", "Romaine, parmesan, focaccia croutons, classic Caesar dressing.", 1095, demoImage("photo-1546793665-c74683f339c1"), { isVegetarian: true }),
        seedItem("southwest-chicken-salad", "Southwest Chicken Salad", "Grilled chicken, avocado, corn, black beans, chipotle lime.", 1495, demoImage("photo-1505253716362-afaea1d3d1af"), { featured: true, isGlutenFree: true, isSpicy: true }),
        seedItem("tomato-basil-soup", "Tomato Basil Soup", "Slow-simmered tomato, basil oil, grilled sourdough.", 895, demoImage("photo-1547592166-23ac45744acd"), { isVegetarian: true, isNutFree: true })
      ] },
      { id: "cat-entrees", name: "Entrees", sortOrder: 3, items: [
        seedItem("grilled-salmon", "Grilled Salmon", "Citrus-herb salmon, seasonal vegetables, lemon butter.", 2495, demoImage("photo-1467003909585-2f8a72700288"), { featured: true, recommended: true, isGlutenFree: true, isNutFree: true }),
        seedItem("herb-roasted-chicken", "Herb Roasted Chicken", "Half chicken, garlic jus, mashed potatoes, charred greens.", 2195, demoImage("photo-1532550907401-a500c9a57435"), { recommended: true }),
        seedItem("steak-frites", "Steak Frites", "Seared steak, truffle fries, arugula, peppercorn sauce.", 2895, demoImage("photo-1558030006-450675393462"), { featured: true })
      ] },
      { id: "cat-dinner-specials", name: "Dinner Specials", sortOrder: 4, items: [
        seedItem("braised-short-rib", "Braised Short Rib", "Red wine short rib, whipped potatoes, glazed carrots.", 3195, demoImage("photo-1544025162-d76694265947"), { featured: true }),
        seedItem("seafood-linguine", "Seafood Linguine", "Shrimp, scallops, clams, tomato saffron broth.", 2995, demoImage("photo-1563379926898-05f4575a45d8"), { recommended: true, isSpicy: true }),
        seedItem("seasonal-risotto", "Chef's Seasonal Risotto", "Arborio rice, market vegetables, parmesan, herb oil.", 2295, demoImage("photo-1476124369491-e7addf5db371"), { isVegetarian: true, isGlutenFree: true })
      ] },
      { id: "cat-burgers-sandwiches", name: "Burgers & Sandwiches", sortOrder: 5, items: [
        seedItem("bistro-burger", "Bistro Burger", "Double patty, aged cheddar, caramelized onion, house sauce.", 1695, demoImage("photo-1568901346375-23c9450c58cd"), { featured: true }),
        seedItem("seed-chicken-sandwich", "Crispy Chicken Sandwich", "Buttermilk chicken, slaw, pickles, house sauce.", 1395, demoImage("photo-1550547660-d9450f859349"), { recommended: true, isSpicy: true }),
        seedItem("veggie-melt", "Veggie Melt", "Mushrooms, peppers, spinach, provolone, garlic aioli.", 1295, demoImage("photo-1528735602780-2552fd46c7af"), { isVegetarian: true })
      ] },
      { id: "cat-sides", name: "Sides", sortOrder: 6, items: [
        seedItem("truffle-fries", "Truffle Fries", "Crisp fries, parmesan, herbs, truffle aioli.", 795, demoImage("photo-1576107232684-1279f390859f"), { recommended: true, isVegetarian: true }),
        seedItem("seasonal-vegetables", "Seasonal Vegetables", "Roasted market vegetables with lemon and herbs.", 695, demoImage("photo-1540420773420-3366772f4999"), { isVegan: true, isGlutenFree: true, isDairyFree: true, isNutFree: true }),
        seedItem("garlic-mashed-potatoes", "Garlic Mashed Potatoes", "Yukon gold potatoes, roasted garlic, chives.", 695, demoImage("photo-1601050690597-df0568f70950"), { isVegetarian: true, isNutFree: true })
      ] },
      { id: "cat-desserts", name: "Desserts", sortOrder: 7, items: [
        seedItem("chocolate-lava-cake", "Chocolate Lava Cake", "Warm chocolate cake, molten center, vanilla cream.", 995, demoImage("photo-1606313564200-e75d5e30476c"), { featured: true, isVegetarian: true }),
        seedItem("new-york-cheesecake", "New York Cheesecake", "Classic cheesecake, berry compote, graham crust.", 895, demoImage("photo-1533134242443-d4fd215305ad"), { isVegetarian: true }),
        seedItem("tiramisu", "Tiramisu", "Espresso-soaked ladyfingers, mascarpone, cocoa.", 925, demoImage("photo-1571877227200-a0d98ea607e9"), { recommended: true, isVegetarian: true })
      ] },
      { id: "cat-drinks", name: "Drinks", sortOrder: 8, items: [
        seedItem("house-lemonade", "House Lemonade", "Fresh lemon, cane sugar, mint.", 495, demoImage("photo-1621263764928-df1444c5e859"), { isVegan: true, isGlutenFree: true, isDairyFree: true, isNutFree: true }),
        seedItem("iced-tea", "Iced Tea", "Black tea, citrus, lightly sweetened.", 395, demoImage("photo-1556679343-c7306c1976bc"), { isVegan: true, isGlutenFree: true, isDairyFree: true, isNutFree: true }),
        seedItem("sparkling-water", "Sparkling Water", "Chilled sparkling mineral water.", 350, demoImage("photo-1523362628745-0c100150b504"), { isVegan: true, isGlutenFree: true, isDairyFree: true, isNutFree: true })
      ] }
    ]
  });

  await seedEmployee({ restaurant: demo.restaurant, email: "manager@demobistro.local", name: "Rina Manager", phone: "555-0188", role: "RESTAURANT_MANAGER" });
  await seedEmployee({ restaurant: demo.restaurant, email: "cashier@demobistro.local", name: "Casey Cashier", phone: "555-0122", role: "CASHIER" });
  await seedEmployee({ restaurant: demo.restaurant, email: "kitchen@demobistro.local", name: "Kai Kitchen", phone: "555-0199", role: "KITCHEN_STAFF" });

  const tacos = await seedRestaurant({
    planId: starter.id,
    couponCode: "TACO10",
    restaurant: {
      name: "Northside Tacos",
      businessName: "Northside Tacos",
      businessType: "RESTAURANT",
      enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"],
      slug: "northside-tacos",
      status: "ACTIVE",
      description: "Fast tacos, bowls, and direct local delivery.",
      phone: "555-0202",
      email: "hello@northsidetacos.local",
      address: "220 North Ave, Denver, CO",
      timezone: "America/Denver",
      deliveryEnabled: true,
      pickupEnabled: true,
      deliveryFeeCents: 299
    },
    owner: { email: "owner@northsidetacos.local", name: "Northside Owner" },
    drivers: [{ email: "driver@northsidetacos.local", name: "Taylor Cruz", phone: "555-0233", available: true, currentLat: 39.77, currentLng: -105.0 }],
    customers: [{ email: "customer@northsidetacos.local", name: "Priya Shah", phone: "555-0266", defaultAddress: "3000 Tejon St, Denver, CO" }],
    categories: [
      {
        id: "seed-tacos",
        name: "Tacos",
        sortOrder: 1,
        items: [
          { id: "seed-carnitas-taco", name: "Carnitas Taco", description: "Slow pork, salsa verde, onion, cilantro.", priceCents: 495, imageUrl: demoImage("photo-1565299585323-38d6b0865b47"), preparationTimeMins: 8, options: [{ name: "Add guacamole", priceCents: 175 }] },
          { id: "seed-veggie-taco", name: "Veggie Taco", description: "Roasted mushrooms, peppers, crema.", priceCents: 450, imageUrl: demoImage("photo-1551504734-5ee1c4a1479b"), preparationTimeMins: 8, options: [] }
        ]
      }
    ]
  });

  const loohar = await seedRestaurant({
    planId: professional.id,
    couponCode: "LOOHAR10",
    restaurant: {
      name: "Loohar Restaurant",
      businessName: "Loohar Restaurant",
      businessType: "RESTAURANT",
      enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"],
      slug: "loohar-restaurant",
      status: "ACTIVE",
      description: "Local restaurant direct ordering for pickup and delivery in Denver.",
      phone: "3032462749",
      email: "hello@loohar.com",
      address: "5371 Laredo Street",
      city: "Denver",
      state: "CO",
      zip: "80239",
      timezone: "America/Denver",
      deliveryEnabled: true,
      pickupEnabled: true,
      deliveryFeeCents: 399,
      brandingJson: { primaryColor: "#111827", accentColor: "#f59e0b" },
      loyaltySettingsJson: { pointsPerDollar: 1, welcomeBonus: 100, birthdayRewardsPlaceholder: true, referralRewardPlaceholder: true },
      storeHoursJson: { monday: "10:00 AM - 9:00 PM", tuesday: "10:00 AM - 9:00 PM", wednesday: "10:00 AM - 9:00 PM", thursday: "10:00 AM - 9:00 PM", friday: "10:00 AM - 10:00 PM", saturday: "10:00 AM - 10:00 PM" }
    },
    owner: { email: "rowner@loohar.com", name: "Loohar Restaurant Owner", password: passwords.looharOwner, forcePasswordChange: true },
    drivers: [{ email: "driver@loohar.com", name: "Loohar Driver", phone: "555-5372", available: true, currentLat: 39.793, currentLng: -104.775 }],
    customers: [{ email: "customer@loohar.com", name: "Loohar Customer", phone: "555-5373", defaultAddress: "5600 Tower Rd, Denver, CO" }],
    categories: [
      {
        id: "seed-loohar-specials",
        name: "House Specials",
        sortOrder: 1,
        items: [
          seedItem("seed-loohar-bowl", "Loohar Signature Bowl", "Rice, grilled protein, seasonal vegetables, house sauce.", 1395, demoImage("photo-1546069901-ba9599a7e63c"), { featured: true, recommended: true }),
          seedItem("seed-loohar-wrap", "Grilled Chicken Wrap", "Grilled chicken, greens, pickled onion, garlic sauce.", 1195, demoImage("photo-1528735602780-2552fd46c7af"), { recommended: true })
        ]
      },
      {
        id: "seed-loohar-drinks",
        name: "Drinks",
        sortOrder: 2,
        items: [
          seedItem("seed-loohar-lemonade", "House Lemonade", "Fresh lemon, mint, cane sugar.", 495, demoImage("photo-1621263764928-df1444c5e859"), { isVegan: true, isGlutenFree: true })
        ]
      }
    ]
  });

  await seedEmployee({ restaurant: loohar.restaurant, email: "kitchen@loohar.com", name: "Loohar Kitchen", phone: "555-5374", role: "KITCHEN_STAFF" });
  await seedEmployee({ restaurant: loohar.restaurant, email: "manager@loohar.com", name: "Loohar Manager", phone: "555-5375", role: "RESTAURANT_MANAGER" });

  const archie = await seedRestaurant({
    planId: professional.id,
    couponCode: "LODGE10",
    restaurant: {
      name: "Archie's Lodge",
      businessName: "Archie's Lodge",
      businessType: "RESTAURANT",
      enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"],
      slug: "archie-s-lodge",
      status: "ACTIVE",
      description: "Cozy lodge-style comfort food, direct pickup, and local delivery.",
      phone: "555-0707",
      email: "hello@archieslodge.local",
      address: "1600 Wazee St",
      city: "Denver",
      state: "CO",
      zip: "80202",
      timezone: "America/Denver",
      deliveryEnabled: true,
      pickupEnabled: true,
      deliveryFeeCents: 399,
      brandingJson: { primaryColor: "#334155", accentColor: "#f97316" },
      loyaltySettingsJson: { pointsPerDollar: 1, welcomeBonus: 100 },
      storeHoursJson: { monday: "11:00 AM - 9:00 PM", tuesday: "11:00 AM - 9:00 PM", wednesday: "11:00 AM - 9:00 PM", thursday: "11:00 AM - 9:00 PM", friday: "11:00 AM - 10:00 PM", saturday: "10:00 AM - 10:00 PM", sunday: "10:00 AM - 8:00 PM" }
    },
    owner: { email: "owner@archieslodge.local", name: "Archie Lodge Owner" },
    drivers: [{ email: "driver@archieslodge.local", name: "Morgan Lodge", phone: "555-0733", available: true, currentLat: 39.753, currentLng: -104.999 }],
    customers: [{ email: "customer@archieslodge.local", name: "Nora Guest", phone: "555-0766", defaultAddress: "1701 Wynkoop St, Denver, CO" }],
    categories: [
      {
        id: "seed-archie-starters",
        name: "Starters",
        sortOrder: 1,
        items: [
          seedItem("seed-archie-pretzel", "Warm Lodge Pretzel", "Soft pretzel, beer cheese, mustard, smoked salt.", 995, demoImage("photo-1600891964599-f61ba0e24092"), { featured: true, isVegetarian: true }),
          seedItem("seed-archie-wings", "Maple Chili Wings", "Crisp wings with maple chili glaze and ranch.", 1395, demoImage("photo-1567620832903-9fc6debc209f"), { recommended: true, isSpicy: true })
        ]
      },
      {
        id: "seed-archie-mains",
        name: "Lodge Mains",
        sortOrder: 2,
        items: [
          seedItem("seed-archie-burger", "Lodge Burger", "Double patty, cheddar, grilled onion, pickle, lodge sauce.", 1695, demoImage("photo-1568901346375-23c9450c58cd"), { featured: true }),
          seedItem("seed-archie-pot-pie", "Chicken Pot Pie", "Roasted chicken, vegetables, flaky herb crust.", 1895, demoImage("photo-1543352634-a1c51d9f1fa7"), { recommended: true })
        ]
      },
      {
        id: "seed-archie-desserts",
        name: "Desserts",
        sortOrder: 3,
        items: [
          seedItem("seed-archie-cobbler", "Skillet Berry Cobbler", "Warm berry cobbler, oat crumble, vanilla cream.", 895, demoImage("photo-1488477181946-6428a0291777"), { featured: true, isVegetarian: true })
        ]
      }
    ]
  });
  await seedEmployee({ restaurant: archie.restaurant, email: "kitchen@archieslodge.local", name: "Archie Kitchen", phone: "555-0774", role: "KITCHEN_STAFF" });

  await seedRewards(demo.restaurant.id);
  await seedRewards(tacos.restaurant.id);
  await seedRewards(loohar.restaurant.id);
  await seedRewards(archie.restaurant.id);
  await prisma.customer.updateMany({ where: { restaurantId: demo.restaurant.id, email: "customer@demo.local" }, data: { segment: "VIP_CUSTOMER", notes: "High-value delivery guest. Likes bowls and avocado." } });
  await prisma.customer.updateMany({ where: { restaurantId: demo.restaurant.id, email: "jon.customer@demo.local" }, data: { segment: "ACTIVE_CUSTOMER", notes: "Usually orders pickup during lunch." } });
  await prisma.menuItem.updateMany({ where: { id: "grilled-salmon" }, data: { featured: true, recommended: true } });
  await prisma.menuItem.updateMany({ where: { id: "seed-chicken-sandwich" }, data: { recommended: true } });

  const coffee = await seedRestaurant({
    planId: starter.id,
    couponCode: "POUR10",
    restaurant: {
      name: "Morning Pour",
      businessName: "Morning Pour",
      businessType: "COFFEE_SHOP",
      enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "LOYALTY", "COUPONS", "FOOD_CATALOG"],
      slug: "morning-pour",
      status: "ACTIVE",
      description: "Coffee, pastries, and fast pickup ordering.",
      phone: "555-0303",
      email: "hello@morningpour.local",
      address: "12 Bean St, Denver, CO",
      timezone: "America/Denver",
      deliveryEnabled: false,
      pickupEnabled: true,
      deliveryFeeCents: 0
    },
    owner: { email: "owner@morningpour.local", name: "Morning Pour Owner" },
    drivers: [],
    customers: [{ email: "customer@morningpour.local", name: "Avery Coffee", phone: "555-0366", defaultAddress: "500 Larimer St, Denver, CO" }],
    categories: [
      {
        id: "seed-coffee-drinks",
        name: "Coffee",
        sortOrder: 1,
        items: [
          { id: "seed-latte", name: "Vanilla Latte", description: "Espresso, steamed milk, vanilla.", priceCents: 575, imageUrl: demoImage("photo-1509042239860-f550ce710b93"), preparationTimeMins: 5, featured: true, options: [{ name: "Oat milk", priceCents: 75 }] },
          { id: "seed-cold-brew", name: "Cold Brew", description: "Slow-steeped house cold brew.", priceCents: 495, imageUrl: demoImage("photo-1517701604599-bb29b565090c"), preparationTimeMins: 3, recommended: true, options: [] }
        ]
      }
    ]
  });

  const bakery = await seedRestaurant({
    planId: starter.id,
    couponCode: "BAKERY10",
    restaurant: {
      name: "Sweet Rise Bakery",
      businessName: "Sweet Rise Bakery",
      businessType: "BAKERY",
      enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "LOYALTY", "COUPONS", "FOOD_CATALOG"],
      slug: "sweet-rise-bakery",
      status: "ACTIVE",
      description: "Fresh pastries, cakes, and pickup ordering.",
      phone: "555-0404",
      email: "hello@sweetrise.local",
      address: "44 Flour Ave, Denver, CO",
      timezone: "America/Denver",
      deliveryEnabled: false,
      pickupEnabled: true,
      deliveryFeeCents: 0
    },
    owner: { email: "owner@sweetrise.local", name: "Sweet Rise Owner" },
    drivers: [],
    customers: [{ email: "customer@sweetrise.local", name: "Casey Baker", phone: "555-0466", defaultAddress: "900 Market St, Denver, CO" }],
    categories: [
      {
        id: "seed-bakery-pastries",
        name: "Pastries",
        sortOrder: 1,
        items: [
          { id: "seed-croissant", name: "Butter Croissant", description: "Flaky, buttery, baked daily.", priceCents: 425, imageUrl: demoImage("photo-1555507036-ab1f4038808a"), preparationTimeMins: 3, featured: true, options: [] },
          { id: "seed-cinnamon-roll", name: "Cinnamon Roll", description: "Cream cheese icing, warm spice.", priceCents: 525, imageUrl: demoImage("photo-1509365465985-25d11c17e812"), preparationTimeMins: 4, recommended: true, options: [] }
        ]
      }
    ]
  });

  const fuel = await seedRestaurant({
    planId: starter.id,
    couponCode: "TRUCK10",
    restaurant: {
      name: "Rolling Dumpling Truck",
      businessName: "Rolling Dumpling Truck",
      businessType: "FOOD_TRUCK",
      enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "LOYALTY", "FOOD_CATALOG"],
      slug: "rolling-dumpling-truck",
      status: "ACTIVE",
      description: "Food truck pickup ordering and loyalty.",
      phone: "555-0455",
      email: "hello@rollingdumpling.local",
      address: "Downtown Denver Food Truck Zone",
      timezone: "America/Denver",
      deliveryEnabled: false,
      pickupEnabled: true,
      deliveryFeeCents: 0
    },
    owner: { email: "owner@rollingdumpling.local", name: "Rolling Dumpling Owner" },
    drivers: [],
    customers: [],
    categories: [
      {
        id: "seed-dumplings",
        name: "Dumplings",
        sortOrder: 1,
        items: [
          { id: "seed-pork-dumplings", name: "Pork Dumplings", description: "Six pan-seared dumplings with chili crisp.", priceCents: 995, imageUrl: demoImage("photo-1496116218417-1a781b1c416c"), preparationTimeMins: 9, featured: true, options: [] }
        ]
      }
    ]
  });

  const fuelMarket = await seedRestaurant({
    planId: starter.id,
    couponCode: "FUELFOOD10",
    restaurant: {
      name: "Mile High Fuel Market",
      businessName: "Mile High Fuel Market",
      businessType: "GAS_STATION_FOOD_SHOP",
      enabledModules: ["FOOD_CATALOG", "PICKUP"],
      slug: "mile-high-fuel-market",
      status: "ACTIVE",
      description: "Prepared snacks and food retail catalog placeholder.",
      phone: "555-0505",
      email: "hello@milehighfuelmarket.local",
      address: "88 Pump Rd, Denver, CO",
      timezone: "America/Denver",
      deliveryEnabled: false,
      pickupEnabled: false,
      deliveryFeeCents: 0
    },
    owner: { email: "owner@milehighfuelmarket.local", name: "Mile High Fuel Market Owner" },
    drivers: [],
    customers: [],
    categories: [
      {
        id: "seed-fuel-hot-food",
        name: "Hot Food",
        sortOrder: 1,
        items: [
          { id: "seed-fuel-breakfast-burrito", name: "Breakfast Burrito", description: "Egg, potato, cheese, and green chile.", priceCents: 699, imageUrl: demoImage("photo-1565299585323-38d6b0865b47"), preparationTimeMins: 6, featured: true, options: [] },
          { id: "seed-fuel-hot-dog", name: "Market Hot Dog", description: "Classic hot dog with condiment packets.", priceCents: 399, imageUrl: demoImage("photo-1619740455993-9e612b1af08a"), preparationTimeMins: 4, options: [] }
        ]
      },
      {
        id: "seed-fuel-snacks",
        name: "Snacks & Drinks",
        sortOrder: 2,
        items: [
          { id: "seed-fuel-trail-mix", name: "Trail Mix", description: "Salty-sweet snack blend for the road.", priceCents: 499, imageUrl: demoImage("photo-1599599810769-bcde5a160d32"), preparationTimeMins: 1, recommended: true, options: [] },
          { id: "seed-fuel-cold-drink", name: "Cold Bottled Drink", description: "Chilled beverage from the market cooler.", priceCents: 299, imageUrl: demoImage("photo-1523362628745-0c100150b504"), preparationTimeMins: 1, options: [] }
        ]
      }
    ]
  });

  const cork = await seedRestaurant({
    planId: professional.id,
    couponCode: "CORK10",
    restaurant: {
      name: "Cork & Bottle",
      businessName: "Cork & Bottle",
      businessType: "LIQUOR_STORE",
      enabledModules: ["DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "FOOD_CATALOG"],
      slug: "cork-bottle",
      status: "ACTIVE",
      description: "Regulated delivery foundation where legally allowed.",
      phone: "555-0606",
      email: "hello@corkbottle.local",
      address: "101 Cellar Way, Denver, CO",
      timezone: "America/Denver",
      deliveryEnabled: true,
      pickupEnabled: true,
      deliveryFeeCents: 499
    },
    owner: { email: "owner@corkbottle.local", name: "Cork Bottle Owner" },
    drivers: [{ email: "driver@corkbottle.local", name: "Jordan Bottle", phone: "555-0633", available: true, currentLat: 39.74, currentLng: -104.99 }],
    customers: [],
    categories: [
      {
        id: "seed-cork-wine",
        name: "Wine",
        sortOrder: 1,
        items: [
          { id: "seed-cork-pinot", name: "Willamette Pinot Noir", description: "Elegant red wine with cherry and spice notes.", priceCents: 2895, imageUrl: demoImage("photo-1510812431401-41d2bd2722f3"), preparationTimeMins: 2, featured: true, options: [] },
          { id: "seed-cork-sauv-blanc", name: "Marlborough Sauvignon Blanc", description: "Bright citrus, tropical fruit, crisp finish.", priceCents: 1995, imageUrl: demoImage("photo-1506377247377-2a5b3b417ebb"), preparationTimeMins: 2, options: [] }
        ]
      },
      {
        id: "seed-cork-beer-mixers",
        name: "Beer & Mixers",
        sortOrder: 2,
        items: [
          { id: "seed-cork-local-ipa", name: "Local IPA 6-Pack", description: "Hoppy local craft IPA.", priceCents: 1395, imageUrl: demoImage("photo-1608270586620-248524c67de9"), preparationTimeMins: 2, recommended: true, options: [] },
          { id: "seed-cork-tonic", name: "Premium Tonic Water", description: "Four-pack tonic mixer.", priceCents: 795, imageUrl: demoImage("photo-1544145945-f90425340c7e"), preparationTimeMins: 1, options: [] }
        ]
      }
    ]
  });

  await seedRewards(coffee.restaurant.id);
  await seedRewards(bakery.restaurant.id);
  await seedRewards(fuel.restaurant.id);
  await seedRewards(fuelMarket.restaurant.id);
  await seedRewards(cork.restaurant.id);

  await seedOrder({
    id: "seed-order-demo-1",
    orderNumber: "894120",
    restaurant: demo.restaurant,
    customer: demo.customers[0],
    driver: demo.drivers[0],
    items: [{ menuItem: demo.items[0], quantity: 2 }],
    status: "PREPARING",
    type: "DELIVERY",
    deliveryAddress: demo.customers[0].defaultAddress,
    tipCents: 600
  });
  await seedOrder({
    id: "seed-order-demo-2",
    orderNumber: "894119",
    restaurant: demo.restaurant,
    customer: demo.customers[1],
    items: [{ menuItem: demo.items[2], quantity: 1 }],
    status: "READY",
    type: "PICKUP",
    deliveryAddress: null,
    tipCents: 0
  });
  await seedOrder({
    id: "seed-order-demo-3",
    orderNumber: "894118",
    restaurant: demo.restaurant,
    customer: demo.customers[0],
    driver: demo.drivers[0],
    items: [{ menuItem: demo.items[1], quantity: 1 }],
    status: "DELIVERED",
    type: "DELIVERY",
    deliveryAddress: demo.customers[0].defaultAddress,
    tipCents: 900
  });
  await seedOrder({
    id: "seed-order-taco-1",
    orderNumber: "771042",
    restaurant: tacos.restaurant,
    customer: tacos.customers[0],
    driver: tacos.drivers[0],
    items: [{ menuItem: tacos.items[0], quantity: 3 }, { menuItem: tacos.items[1], quantity: 2 }],
    status: "DELIVERED",
    type: "DELIVERY",
    deliveryAddress: tacos.customers[0].defaultAddress,
    tipCents: 800
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      restaurantId: demo.restaurant.id,
      action: "seed.database",
      entityType: "Business",
      entityId: demo.restaurant.id,
      metadataJson: { message: "Seeded restaurant-owned ordering and delivery SaaS data with restaurants, coffee shop, bakery, food truck, gas-station food shop, liquor store, users, menus, orders, payments, deliveries, and tips." }
    }
  });

  await seedWebsiteAssets(demo.restaurant, { brandColor: "#1f9d80", accentColor: "#f4b740", heroSubtitle: "Fresh bowls, sandwiches, pickup, and neighborhood delivery without marketplace fees.", specialOfferText: "Use BISTRO10 for 10% off direct ordering." });
  await seedWebsiteAssets(tacos.restaurant, { brandColor: "#c2410c", accentColor: "#facc15", heroSubtitle: "Fast tacos, bowls, and delivery from the Northside kitchen.", specialOfferText: "TACO10 saves 10% on direct orders." });
  await seedWebsiteAssets(loohar.restaurant, { brandColor: "#111827", accentColor: "#f59e0b", tagline: "Direct Denver Ordering", cuisineType: "Local Restaurant", heroTitle: "Loohar Restaurant Direct Ordering", heroSubtitle: "Pickup and delivery from Loohar Restaurant at 5371 Laredo Street, Denver, CO 80239.", specialOfferText: "Use LOOHAR10 for direct ordering savings.", seoTitle: "Loohar Restaurant | Direct Online Ordering" });
  await seedWebsiteAssets(archie.restaurant, { brandColor: "#334155", accentColor: "#f97316", tagline: "Comfort Food Lodge", cuisineType: "American Comfort Food", heroTitle: "Lodge Comfort Food, Ordered Direct", heroSubtitle: "Cozy starters, burgers, mains, desserts, pickup, and restaurant-owned delivery from Archie's Lodge.", specialOfferText: "Use LODGE10 for direct ordering savings.", seoTitle: "Archie's Lodge | Direct Online Ordering" });
  await seedWebsiteAssets(coffee.restaurant, { brandColor: "#6f4e37", accentColor: "#86efac", heroSubtitle: "Coffee, pastries, and quick pickup ordering.", specialOfferText: "Earn points on every morning pickup." });
  await seedWebsiteAssets(bakery.restaurant, { brandColor: "#be185d", accentColor: "#fbbf24", heroSubtitle: "Fresh pastries, cakes, and pickup ordering.", specialOfferText: "BAKERY10 for first-time direct orders." });
  await seedWebsiteAssets(fuel.restaurant, { brandColor: "#0f766e", accentColor: "#f97316", heroSubtitle: "Dumplings and street food pickup from the truck window.", specialOfferText: "Truck pickup ordering and loyalty." });
  await seedWebsiteAssets(fuelMarket.restaurant, { brandColor: "#0f766e", accentColor: "#f97316", heroSubtitle: "Prepared snacks and food market favorites.", specialOfferText: "Food catalog and pickup foundation." });
  await seedWebsiteAssets(cork.restaurant, { brandColor: "#581c87", accentColor: "#f59e0b", heroSubtitle: "Regulated delivery foundation where legally allowed.", specialOfferText: "Direct delivery where legally permitted." });

  console.log({
    plans: [starter.name, professional.name, enterprise.name],
    foodBusinesses: [demo.restaurant.slug, tacos.restaurant.slug, loohar.restaurant.slug, archie.restaurant.slug, coffee.restaurant.slug, bakery.restaurant.slug, "rolling-dumpling-truck", "mile-high-fuel-market", "cork-bottle"],
    seededAccounts: {
      superAdmin: "admin@platform.local",
      restaurantOwner: "owner@demobistro.local",
      looharSuperAdmin: "subash.sunar@loohar.com",
      looharOwner: "rowner@loohar.com",
      manager: "manager@demobistro.local",
      cashier: "cashier@demobistro.local",
      kitchenStaff: "kitchen@demobistro.local",
      driver: "driver@demobistro.local",
      customer: "customer@demo.local",
      passwordOutput: "redacted"
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

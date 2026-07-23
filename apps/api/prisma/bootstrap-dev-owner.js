import {
  createPrismaClient,
  databaseSummary,
  hasArg,
  hashPassword,
  maskEmail,
  normalizeEmail,
  recordScriptAudit,
  requiredEnv,
  validateStrongPassword
} from "./auth-script-utils.js";

const prisma = createPrismaClient();
const defaultRestaurantSlug = "development-restaurant";
const ownerPermissions = ["dashboard", "orders", "kitchen", "customers", "drivers", "reports", "settings"];
const defaultCategories = ["Appetizers", "Soups", "Salads", "Lunch", "Dinner", "Desserts", "Drinks"];

function runtimeEnvironment() {
  return String(process.env.APP_ENV || process.env.VERCEL_ENV || process.env.RENDER_ENVIRONMENT || process.env.NODE_ENV || "development").toLowerCase();
}

function assertDevFixtureAllowed() {
  const env = runtimeEnvironment();
  if (env === "production" || env === "prod" || env === "live") {
    throw new Error("Refusing to create a development owner fixture in production.");
  }
  if (process.env.ENABLE_DEV_OWNER_FIXTURE !== "true") {
    throw new Error("ENABLE_DEV_OWNER_FIXTURE=true is required to create or update the development owner fixture.");
  }
}

function publicRestaurantName(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Development Restaurant";
}

async function ensureStarterPlan() {
  return prisma.subscriptionPlan.upsert({
    where: { code: "STARTER" },
    update: {
      name: "Starter",
      monthlyPriceCents: 9900,
      technologyFeeBps: 75,
      maxLocations: 1,
      maxDrivers: 5,
      featuresJson: ["Ordering", "Pickup"]
    },
    create: {
      code: "STARTER",
      name: "Starter",
      monthlyPriceCents: 9900,
      technologyFeeBps: 75,
      maxLocations: 1,
      maxDrivers: 5,
      featuresJson: ["Ordering", "Pickup"]
    }
  });
}

async function ensureRestaurantFixture(slug) {
  const name = (process.env.DEV_OWNER_RESTAURANT_NAME || publicRestaurantName(slug)).trim();
  const email = normalizeEmail(process.env.DEV_OWNER_RESTAURANT_EMAIL || "development-restaurant@loohar.local");
  const plan = await ensureStarterPlan();
  const restaurant = await prisma.restaurant.upsert({
    where: { slug },
    update: {
      name,
      businessName: name,
      businessType: "RESTAURANT",
      status: "ACTIVE",
      email,
      phone: process.env.DEV_OWNER_RESTAURANT_PHONE || "555-0101",
      address: process.env.DEV_OWNER_RESTAURANT_ADDRESS || "100 Development Way",
      city: process.env.DEV_OWNER_RESTAURANT_CITY || "Denver",
      state: process.env.DEV_OWNER_RESTAURANT_STATE || "CO",
      zip: process.env.DEV_OWNER_RESTAURANT_ZIP || "80202",
      timezone: process.env.DEV_OWNER_RESTAURANT_TIMEZONE || "America/Denver",
      deliveryEnabled: true,
      pickupEnabled: true,
      enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"],
      onboardingStatus: "COMPLETED",
      onboardingCurrentStep: "review",
      websitePublishedAt: new Date()
    },
    create: {
      name,
      businessName: name,
      businessType: "RESTAURANT",
      status: "ACTIVE",
      email,
      phone: process.env.DEV_OWNER_RESTAURANT_PHONE || "555-0101",
      address: process.env.DEV_OWNER_RESTAURANT_ADDRESS || "100 Development Way",
      city: process.env.DEV_OWNER_RESTAURANT_CITY || "Denver",
      state: process.env.DEV_OWNER_RESTAURANT_STATE || "CO",
      zip: process.env.DEV_OWNER_RESTAURANT_ZIP || "80202",
      timezone: process.env.DEV_OWNER_RESTAURANT_TIMEZONE || "America/Denver",
      slug,
      deliveryEnabled: true,
      pickupEnabled: true,
      enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "DELIVERY", "DRIVER_MANAGEMENT", "LOYALTY", "COUPONS", "DELIVERY_ZONES", "FOOD_CATALOG"],
      onboardingStatus: "COMPLETED",
      onboardingCurrentStep: "review",
      websitePublishedAt: new Date()
    },
    select: { id: true, name: true, businessName: true, slug: true, status: true }
  });

  await prisma.restaurantWebsiteSettings.upsert({
    where: { restaurantId: restaurant.id },
    update: {
      websiteEnabled: true,
      heroTitle: restaurant.businessName || restaurant.name,
      heroSubtitle: `Order directly from ${restaurant.businessName || restaurant.name}.`,
      tagline: "Direct ordering, pickup, delivery, and loyalty.",
      cuisineType: "Restaurant",
      publicEmail: email,
      brandColor: "#0f766e",
      accentColor: "#f59e0b",
      seoTitle: `${restaurant.businessName || restaurant.name} | Loohar`,
      seoDescription: `Order pickup and delivery directly from ${restaurant.businessName || restaurant.name}.`
    },
    create: {
      restaurantId: restaurant.id,
      websiteEnabled: true,
      heroTitle: restaurant.businessName || restaurant.name,
      heroSubtitle: `Order directly from ${restaurant.businessName || restaurant.name}.`,
      tagline: "Direct ordering, pickup, delivery, and loyalty.",
      cuisineType: "Restaurant",
      publicEmail: email,
      brandColor: "#0f766e",
      accentColor: "#f59e0b",
      seoTitle: `${restaurant.businessName || restaurant.name} | Loohar`,
      seoDescription: `Order pickup and delivery directly from ${restaurant.businessName || restaurant.name}.`
    }
  });

  await prisma.restaurantDomain.upsert({
    where: { restaurantId_defaultSubdomain: { restaurantId: restaurant.id, defaultSubdomain: slug } },
    update: {
      primaryDomain: `${slug}.loohar.com`,
      canonicalDomain: `${slug}.loohar.com`,
      domainStatus: "ACTIVE",
      sslStatus: "ACTIVE"
    },
    create: {
      restaurantId: restaurant.id,
      defaultSubdomain: slug,
      primaryDomain: `${slug}.loohar.com`,
      canonicalDomain: `${slug}.loohar.com`,
      domainStatus: "ACTIVE",
      sslStatus: "ACTIVE"
    }
  });

  const existingCategories = await prisma.menuCategory.findMany({
    where: { restaurantId: restaurant.id },
    select: { name: true }
  });
  const existingNames = new Set(existingCategories.map((category) => category.name.toLowerCase()));
  await Promise.all(defaultCategories
    .filter((name) => !existingNames.has(name.toLowerCase()))
    .map((name, index) => prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name, sortOrder: index + 1, active: true }
    })));

  const activeSubscription = await prisma.tenantSubscription.findFirst({
    where: { restaurantId: restaurant.id, active: true },
    select: { id: true }
  });
  if (activeSubscription) {
    await prisma.tenantSubscription.update({ where: { id: activeSubscription.id }, data: { planId: plan.id, active: true } });
  } else {
    await prisma.tenantSubscription.create({ data: { restaurantId: restaurant.id, planId: plan.id, active: true } });
  }

  return restaurant;
}

async function main() {
  assertDevFixtureAllowed();

  const resetExisting = hasArg("--reset-existing");
  const email = normalizeEmail(process.env.DEV_OWNER_EMAIL || "development@loohar.com");
  const name = (process.env.DEV_OWNER_NAME || "Loohar Development Owner").trim();
  const restaurantSlug = (process.env.DEV_OWNER_RESTAURANT_SLUG || defaultRestaurantSlug).trim();
  const password = requiredEnv("DEV_OWNER_TEMP_PASSWORD");

  validateStrongPassword(password);

  if (resetExisting && process.env.DEV_OWNER_CONFIRM_RESET !== "RESET_EXISTING_DEV_OWNER") {
    throw new Error("DEV_OWNER_CONFIRM_RESET=RESET_EXISTING_DEV_OWNER is required with --reset-existing.");
  }

  const restaurant = await ensureRestaurantFixture(restaurantSlug);

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, role: true, status: true, restaurantId: true }
  });

  let user;
  let action;

  if (!existing) {
    user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        role: "TENANT_OWNER",
        status: "ACTIVE",
        restaurantId: restaurant.id,
        forcePasswordChange: true,
        temporaryPassword: true,
        passwordChangedAt: null,
        sessionVersion: 0,
        staffProfile: {
          create: {
            restaurantId: restaurant.id,
            role: "TENANT_OWNER",
            active: true,
            permissionsJson: ownerPermissions
          }
        }
      },
      select: { id: true, email: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, temporaryPassword: true, sessionVersion: true }
    });
    action = "created";
  } else {
    const data = {
      email,
      name,
      role: "TENANT_OWNER",
      status: "ACTIVE",
      restaurantId: restaurant.id
    };

    if (resetExisting) {
      data.passwordHash = await hashPassword(password);
      data.forcePasswordChange = true;
      data.temporaryPassword = true;
      data.passwordChangedAt = null;
      data.sessionVersion = { increment: 1 };
    }

    user = await prisma.user.update({
      where: { id: existing.id },
      data,
      select: { id: true, email: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, temporaryPassword: true, sessionVersion: true }
    });

    await prisma.restaurantStaff.upsert({
      where: { userId: user.id },
      create: {
        restaurantId: restaurant.id,
        userId: user.id,
        role: "TENANT_OWNER",
        active: true,
        permissionsJson: ownerPermissions
      },
      update: {
        restaurantId: restaurant.id,
        role: "TENANT_OWNER",
        active: true,
        permissionsJson: ownerPermissions
      }
    });

    action = resetExisting ? "reset" : "updated_without_password_reset";
  }

  await recordScriptAudit(prisma, {
    actorUserId: user.id,
    restaurantId: restaurant.id,
    action: resetExisting ? "auth.dev_owner_fixture.reset" : "auth.dev_owner_fixture.upserted",
    entityType: "User",
    entityId: user.id,
    metadata: {
      maskedEmail: maskEmail(user.email),
      action,
      restaurantSlug: restaurant.slug,
      runtimeEnvironment: runtimeEnvironment(),
      database: databaseSummary()
    }
  }).catch(() => {});

  console.log(JSON.stringify({
    ok: true,
    action,
    database: databaseSummary(),
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name
    },
    owner: {
      userId: user.id,
      maskedEmail: maskEmail(user.email),
      role: user.role,
      status: user.status,
      restaurantId: user.restaurantId,
      forcePasswordChange: user.forcePasswordChange,
      temporaryPassword: user.temporaryPassword,
      sessionVersion: user.sessionVersion
    },
    passwordUpdated: !existing || resetExisting,
    sessionsRevoked: resetExisting
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

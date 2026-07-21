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

async function main() {
  assertDevFixtureAllowed();

  const resetExisting = hasArg("--reset-existing");
  const email = normalizeEmail(process.env.DEV_OWNER_EMAIL || "development@loohar.com");
  const name = (process.env.DEV_OWNER_NAME || "Loohar Development Owner").trim();
  const restaurantSlug = (process.env.DEV_OWNER_RESTAURANT_SLUG || "loohar-restaurant").trim();
  const password = requiredEnv("DEV_OWNER_TEMP_PASSWORD");

  validateStrongPassword(password);

  if (resetExisting && process.env.DEV_OWNER_CONFIRM_RESET !== "RESET_EXISTING_DEV_OWNER") {
    throw new Error("DEV_OWNER_CONFIRM_RESET=RESET_EXISTING_DEV_OWNER is required with --reset-existing.");
  }

  const restaurant = await prisma.restaurant.findFirst({
    where: { slug: restaurantSlug },
    select: { id: true, name: true, slug: true, status: true }
  });

  if (!restaurant) {
    throw new Error(`No restaurant found for DEV_OWNER_RESTAURANT_SLUG=${restaurantSlug}.`);
  }

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
            permissionsJson: ["dashboard", "orders", "kitchen", "customers", "drivers", "reports", "settings"]
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
        permissionsJson: ["dashboard", "orders", "kitchen", "customers", "drivers", "reports", "settings"]
      },
      update: {
        restaurantId: restaurant.id,
        role: "TENANT_OWNER",
        active: true,
        permissionsJson: ["dashboard", "orders", "kitchen", "customers", "drivers", "reports", "settings"]
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

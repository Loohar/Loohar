import bcrypt from "bcrypt";
import {
  createPrismaClient,
  databaseSummary,
  maskEmail,
  normalizeEmail,
  requiredEnv
} from "./auth-script-utils.js";

const prisma = createPrismaClient();

async function membershipsForUser(user) {
  const memberships = new Map();
  const setBestMembership = (membership) => {
    if (!membership?.tenantId) return;
    const existing = memberships.get(membership.tenantId);
    if (!existing || existing.status !== "ACTIVE" || membership.status === "ACTIVE") {
      memberships.set(membership.tenantId, membership);
    }
  };

  if (user?.restaurantId && user.restaurant) {
    setBestMembership({
      tenantId: user.restaurant.id,
      tenantSlug: user.restaurant.slug,
      role: user.role,
      status: ["ACTIVE", "PASSWORD_RESET_REQUIRED"].includes(user.status) && user.restaurant.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
      source: "user.restaurantId"
    });
  }

  if (user?.id) {
    const staffMemberships = await prisma.restaurantStaff.findMany({
      where: { userId: user.id },
      select: {
        role: true,
        active: true,
        restaurant: { select: { id: true, slug: true, status: true } }
      }
    });

    for (const staff of staffMemberships) {
      setBestMembership({
        tenantId: staff.restaurant.id,
        tenantSlug: staff.restaurant.slug,
        role: staff.role,
        status: staff.active && staff.restaurant.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
        source: "RestaurantStaff"
      });
    }
  }

  return [...memberships.values()];
}

async function main() {
  const email = normalizeEmail(requiredEnv("AUTH_VERIFY_EMAIL"));
  const password = requiredEnv("AUTH_VERIFY_PASSWORD");
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      passwordHash: true,
      forcePasswordChange: true,
      temporaryPassword: true,
      restaurantId: true,
      restaurant: { select: { id: true, slug: true, status: true } }
    }
  });

  const passwordHashPresent = Boolean(user?.passwordHash);
  const passwordMatch = passwordHashPresent ? await bcrypt.compare(password, user.passwordHash) : false;
  const memberships = user ? await membershipsForUser(user) : [];

  console.log(JSON.stringify({
    ok: true,
    database: databaseSummary(),
    target: maskEmail(email),
    userFound: Boolean(user),
    status: user?.status || null,
    role: user?.role || null,
    passwordHashPresent,
    passwordMatch,
    forcePasswordChange: Boolean(user?.forcePasswordChange),
    temporaryPassword: Boolean(user?.temporaryPassword),
    activeMemberships: memberships
      .filter((membership) => membership.status === "ACTIVE")
      .map((membership) => ({
        tenantSlug: membership.tenantSlug,
        role: membership.role,
        source: membership.source
      }))
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

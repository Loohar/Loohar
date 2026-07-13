import {
  bcryptSelfTest,
  createPrismaClient,
  databaseSummary,
  maskEmail,
  normalizeEmail
} from "./auth-script-utils.js";

const prisma = createPrismaClient();
const loginRoles = ["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"];

function accountLockStatus(status) {
  return ["DISABLED", "SUSPENDED", "DELETED"].includes(status) ? status : "NONE";
}

async function membershipsForUser(user) {
  const memberships = new Map();
  const setBestMembership = (membership) => {
    const existing = memberships.get(membership.tenantId);
    if (!existing || existing.status !== "ACTIVE" || membership.status === "ACTIVE") {
      memberships.set(membership.tenantId, membership);
    }
  };
  if (user.restaurantId && user.restaurant) {
    setBestMembership({
      tenantId: user.restaurant.id,
      tenantSlug: user.restaurant.slug,
      role: user.role,
      status: user.status === "ACTIVE" || user.status === "PASSWORD_RESET_REQUIRED" ? "ACTIVE" : "INACTIVE",
      source: "user.restaurantId"
    });
  }

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

  return [...memberships.values()];
}

async function summarizeUser(user) {
  const memberships = await membershipsForUser(user);
  return {
    maskedEmail: maskEmail(user.email),
    userId: user.id,
    role: user.role,
    status: user.status,
    passwordHashPresent: Boolean(user.passwordHash),
    forcePasswordChange: Boolean(user.forcePasswordChange),
    accountLockStatus: accountLockStatus(user.status),
    tenantMembershipCount: memberships.length,
    tenantSlugs: [...new Set(memberships.map((membership) => membership.tenantSlug).filter(Boolean))],
    memberships: memberships.map((membership) => ({
      tenantSlug: membership.tenantSlug,
      role: membership.role,
      status: membership.status,
      source: membership.source
    }))
  };
}

async function main() {
  const auditEmails = (process.env.AUTH_AUDIT_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);

  const emailUsers = [];
  for (const email of auditEmails) {
    emailUsers.push(await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        passwordHash: true,
        forcePasswordChange: true,
        restaurantId: true,
        restaurant: { select: { id: true, slug: true, status: true } }
      }
    }));
  }

  const users = auditEmails.length
    ? emailUsers.filter(Boolean)
    : await prisma.user.findMany({
      where: { role: { in: loginRoles } },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        passwordHash: true,
        forcePasswordChange: true,
        restaurantId: true,
        restaurant: { select: { id: true, slug: true, status: true } }
      },
      orderBy: { createdAt: "asc" },
      take: 50
    });

  const userSummaries = [];
  for (const user of users) {
    userSummaries.push(await summarizeUser(user));
  }

  const report = {
    ok: true,
    database: databaseSummary(),
    bcryptSelfTest: await bcryptSelfTest(),
    counts: {
      users: await prisma.user.count(),
      superAdmins: await prisma.user.count({ where: { role: "SUPER_ADMIN" } }),
      activeSuperAdmins: await prisma.user.count({ where: { role: "SUPER_ADMIN", status: "ACTIVE" } }),
      tenantOwners: await prisma.user.count({ where: { role: { in: ["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"] } } }),
      activeTenantOwners: await prisma.user.count({ where: { role: { in: ["TENANT_OWNER", "RESTAURANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_MANAGER"] }, status: "ACTIVE" } }),
      restaurants: await prisma.restaurant.count(),
      activeRestaurants: await prisma.restaurant.count({ where: { status: "ACTIVE" } })
    },
    requestedEmails: auditEmails.map(maskEmail),
    missingRequestedEmails: auditEmails
      .filter((email, index) => !emailUsers[index])
      .map(maskEmail),
    users: userSummaries
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

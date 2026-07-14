import {
  createPrismaClient,
  databaseSummary,
  hashPassword,
  maskEmail,
  normalizeEmail,
  recordScriptAudit,
  requiredEnv,
  validateStrongPassword
} from "./auth-script-utils.js";

const prisma = createPrismaClient();
const userRoles = new Set(["SUPER_ADMIN", "TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF", "DRIVER", "CUSTOMER"]);
const tenantRoles = new Set(["TENANT_OWNER", "RESTAURANT_ADMIN", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "CASHIER", "KITCHEN_STAFF"]);

function optionalEnv(name) {
  return String(process.env[name] || "").trim();
}

function repairedName(email) {
  return optionalEnv("AUTH_REPAIR_NAME") || `${email.split("@")[0]} User`;
}

async function main() {
  if (process.env.AUTH_REPAIR_CONFIRM !== "true") {
    throw new Error("AUTH_REPAIR_CONFIRM=true is required. Repair aborted.");
  }

  const email = normalizeEmail(requiredEnv("AUTH_REPAIR_EMAIL"));
  const password = requiredEnv("AUTH_REPAIR_PASSWORD");
  const role = String(requiredEnv("AUTH_REPAIR_ROLE")).trim().toUpperCase();
  if (!userRoles.has(role)) throw new Error(`Unsupported AUTH_REPAIR_ROLE: ${role}`);
  validateStrongPassword(password);

  const needsTenant = tenantRoles.has(role);
  const tenantSlug = optionalEnv("AUTH_REPAIR_TENANT_SLUG");
  const forcePasswordChange = process.env.AUTH_REPAIR_FORCE_PASSWORD_RESET === "true";
  const allowCreate = process.env.AUTH_REPAIR_ALLOW_CREATE === "true";

  let restaurant = null;
  if (needsTenant) {
    if (!tenantSlug) throw new Error("AUTH_REPAIR_TENANT_SLUG is required for restaurant roles.");
    restaurant = await prisma.restaurant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, slug: true, name: true, businessName: true, status: true }
    });
    if (!restaurant) throw new Error(`No tenant found for slug ${tenantSlug}. Repair aborted.`);
    if (restaurant.status === "DELETED") throw new Error(`Tenant ${tenantSlug} is deleted. Repair aborted.`);
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, name: true, role: true, restaurantId: true, sessionVersion: true }
  });
  if (!existing && !allowCreate) {
    throw new Error("User does not exist. Set AUTH_REPAIR_ALLOW_CREATE=true to create the exact requested user.");
  }
  if (existing?.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
    throw new Error("Refusing to convert an existing SUPER_ADMIN account to a tenant role.");
  }
  if (existing?.restaurantId && restaurant?.id && existing.restaurantId !== restaurant.id) {
    throw new Error("Existing user is linked to a different tenant. Repair aborted to avoid cross-tenant changes.");
  }

  const passwordHash = await hashPassword(password);
  const userData = {
    email,
    name: existing?.name || repairedName(email),
    passwordHash,
    role,
    status: "ACTIVE",
    restaurantId: restaurant?.id || null,
    forcePasswordChange,
    temporaryPassword: forcePasswordChange,
    passwordChangedAt: forcePasswordChange ? null : new Date()
  };

  const user = existing
    ? await prisma.user.update({
      where: { id: existing.id },
      data: { ...userData, sessionVersion: { increment: 1 } },
      select: { id: true, email: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, temporaryPassword: true, sessionVersion: true }
    })
    : await prisma.user.create({
      data: { ...userData, sessionVersion: 0 },
      select: { id: true, email: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, temporaryPassword: true, sessionVersion: true }
    });

  let staff = null;
  if (needsTenant) {
    staff = await prisma.restaurantStaff.upsert({
      where: { userId: user.id },
      update: {
        restaurantId: restaurant.id,
        role,
        active: true,
        permissionsJson: role === "TENANT_OWNER" || role === "RESTAURANT_OWNER" ? ["all"] : []
      },
      create: {
        restaurantId: restaurant.id,
        userId: user.id,
        role,
        active: true,
        permissionsJson: role === "TENANT_OWNER" || role === "RESTAURANT_OWNER" ? ["all"] : []
      },
      select: { id: true, role: true, active: true }
    });
  }

  await recordScriptAudit(prisma, {
    actorUserId: user.id,
    restaurantId: restaurant?.id || null,
    action: "auth.user.repaired",
    entityType: "User",
    entityId: user.id,
    metadata: {
      maskedEmail: maskEmail(user.email),
      role,
      tenantSlug: restaurant?.slug || null,
      createdUser: !existing,
      sessionsRevoked: Boolean(existing),
      forcePasswordChange,
      database: databaseSummary()
    }
  }).catch(() => {});

  console.log(JSON.stringify({
    ok: true,
    database: databaseSummary(),
    user: {
      userId: user.id,
      maskedEmail: maskEmail(user.email),
      role: user.role,
      status: user.status,
      passwordHashPresent: true,
      forcePasswordChange: user.forcePasswordChange,
      temporaryPassword: user.temporaryPassword,
      sessionVersion: user.sessionVersion
    },
    membership: restaurant ? {
      tenantSlug: restaurant.slug,
      role: staff?.role || user.role,
      status: staff?.active && restaurant.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"
    } : null,
    createdUser: !existing,
    sessionsRevoked: Boolean(existing)
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

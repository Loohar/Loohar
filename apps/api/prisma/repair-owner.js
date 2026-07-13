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

function ownerName(email) {
  return process.env.OWNER_NAME?.trim() || `${email.split("@")[0]} Owner`;
}

async function main() {
  const email = normalizeEmail(requiredEnv("OWNER_EMAIL"));
  const tenantSlug = String(requiredEnv("TENANT_SLUG")).trim();
  const temporaryPassword = requiredEnv("TEMPORARY_PASSWORD");

  validateStrongPassword(temporaryPassword);

  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true, name: true, businessName: true, status: true }
  });
  if (!restaurant) throw new Error(`No tenant found for slug ${tenantSlug}. Repair aborted.`);
  if (restaurant.status === "DELETED") throw new Error(`Tenant ${tenantSlug} is deleted. Repair aborted.`);

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, role: true, status: true, restaurantId: true }
  });
  if (existing?.role === "SUPER_ADMIN") {
    throw new Error("Refusing to convert a SUPER_ADMIN account into a tenant owner.");
  }
  if (existing?.restaurantId && existing.restaurantId !== restaurant.id) {
    throw new Error("Existing user is linked to a different tenant. Repair aborted to avoid cross-tenant changes.");
  }

  const passwordHash = await hashPassword(temporaryPassword);
  const user = existing
    ? await prisma.user.update({
      where: { id: existing.id },
      data: {
        email,
        name: ownerName(email),
        passwordHash,
        role: "TENANT_OWNER",
        status: "PASSWORD_RESET_REQUIRED",
        restaurantId: restaurant.id,
        forcePasswordChange: true,
        temporaryPassword: true,
        passwordChangedAt: null,
        sessionVersion: { increment: 1 }
      },
      select: { id: true, email: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, sessionVersion: true }
    })
    : await prisma.user.create({
      data: {
        email,
        name: ownerName(email),
        passwordHash,
        role: "TENANT_OWNER",
        status: "PASSWORD_RESET_REQUIRED",
        restaurantId: restaurant.id,
        forcePasswordChange: true,
        temporaryPassword: true,
        passwordChangedAt: null,
        sessionVersion: 0
      },
      select: { id: true, email: true, role: true, status: true, restaurantId: true, forcePasswordChange: true, sessionVersion: true }
    });

  const staff = await prisma.restaurantStaff.upsert({
    where: { userId: user.id },
    update: {
      restaurantId: restaurant.id,
      role: "TENANT_OWNER",
      active: true,
      permissionsJson: ["all"]
    },
    create: {
      restaurantId: restaurant.id,
      userId: user.id,
      role: "TENANT_OWNER",
      active: true,
      permissionsJson: ["all"]
    },
    select: { id: true, role: true, active: true }
  });

  await recordScriptAudit(prisma, {
    actorUserId: user.id,
    restaurantId: restaurant.id,
    action: "auth.owner.repaired",
    entityType: "User",
    entityId: user.id,
    metadata: {
      maskedEmail: maskEmail(user.email),
      tenantSlug: restaurant.slug,
      createdUser: !existing,
      sessionsRevoked: Boolean(existing),
      database: databaseSummary()
    }
  }).catch(() => {});

  console.log(JSON.stringify({
    ok: true,
    database: databaseSummary(),
    owner: {
      userId: user.id,
      maskedEmail: maskEmail(user.email),
      role: user.role,
      status: user.status,
      forcePasswordChange: user.forcePasswordChange,
      passwordHashPresent: true,
      sessionVersion: user.sessionVersion
    },
    membership: {
      tenantId: restaurant.id,
      tenantSlug: restaurant.slug,
      tenantName: restaurant.businessName || restaurant.name,
      role: staff.role,
      status: staff.active && restaurant.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"
    },
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

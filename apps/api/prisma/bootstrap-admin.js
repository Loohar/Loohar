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

async function main() {
  const email = normalizeEmail(requiredEnv("BOOTSTRAP_ADMIN_EMAIL"));
  const password = requiredEnv("BOOTSTRAP_ADMIN_PASSWORD");
  const name = requiredEnv("BOOTSTRAP_ADMIN_NAME").trim();
  const resetExisting = hasArg("--reset-existing");

  validateStrongPassword(password);

  if (resetExisting && process.env.BOOTSTRAP_CONFIRM_RESET !== "RESET_EXISTING_ADMIN") {
    throw new Error("BOOTSTRAP_CONFIRM_RESET=RESET_EXISTING_ADMIN is required with --reset-existing.");
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, role: true, status: true, passwordHash: true }
  });

  let user;
  let action;

  if (!existing) {
    const passwordHash = await hashPassword(password);
    user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        forcePasswordChange: false,
        temporaryPassword: false,
        passwordChangedAt: new Date(),
        sessionVersion: 0
      },
      select: { id: true, email: true, role: true, status: true, forcePasswordChange: true, sessionVersion: true }
    });
    action = "created";
  } else {
    const data = {
      email,
      name,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      forcePasswordChange: false,
      temporaryPassword: false
    };
    if (resetExisting) {
      data.passwordHash = await hashPassword(password);
      data.passwordChangedAt = new Date();
      data.sessionVersion = { increment: 1 };
    }
    user = await prisma.user.update({
      where: { id: existing.id },
      data,
      select: { id: true, email: true, role: true, status: true, forcePasswordChange: true, sessionVersion: true }
    });
    action = resetExisting ? "reset" : "updated_without_password_reset";
  }

  await recordScriptAudit(prisma, {
    actorUserId: user.id,
    action: resetExisting ? "auth.bootstrap_admin.reset" : "auth.bootstrap_admin.upserted",
    entityType: "User",
    entityId: user.id,
    metadata: {
      maskedEmail: maskEmail(user.email),
      action,
      sessionsRevoked: resetExisting,
      database: databaseSummary()
    }
  }).catch(() => {});

  console.log(JSON.stringify({
    ok: true,
    action,
    database: databaseSummary(),
    admin: {
      userId: user.id,
      maskedEmail: maskEmail(user.email),
      role: user.role,
      status: user.status,
      forcePasswordChange: user.forcePasswordChange,
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

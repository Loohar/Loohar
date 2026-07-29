import fs from "node:fs";

const checks = [];

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function expectIncludesAll(file, label, needles) {
  const content = read(file);
  checks.push({
    file,
    label,
    pass: needles.every((needle) => content.includes(needle))
  });
}

function expectMatchesAll(file, label, patterns) {
  const content = read(file);
  checks.push({
    file,
    label,
    pass: patterns.every((pattern) => pattern.test(content))
  });
}

expectIncludesAll("apps/api/prisma/schema.prisma", "Prisma introductory program models and lifecycle fields", [
  "enum TenantLifecycleStatus",
  "enum PaymentLifecycleStatus",
  "enum PlatformBillingMode",
  "INTRO_TRIAL",
  "model PlatformProgramConfig",
  "model TrialEnrollment",
  "model NotificationSchedule",
  "model SavingsBaseline",
  "trialEndsAt"
]);

expectMatchesAll("apps/api/prisma/schema.prisma", "Prisma restaurant billing mode field", [
  /billingMode\s+PlatformBillingMode/
]);

expectIncludesAll("apps/api/prisma/migrations/20260728090000_introductory_program/migration.sql", "Migration creates introductory program tables", [
  "CREATE TABLE \"PlatformProgramConfig\"",
  "CREATE TABLE \"TrialEnrollment\"",
  "CREATE TABLE \"NotificationSchedule\"",
  "CREATE UNIQUE INDEX \"NotificationSchedule_dedupeKey_key\"",
  "CREATE TABLE \"SavingsBaseline\""
]);

expectIncludesAll("apps/api/src/modules/platformBilling/platformBillingService.js", "Shared provisioning service is the tenant activation path", [
  "export async function provisionRestaurantTenant",
  "getIntroductoryProgramConfig",
  "autoChargeWithoutExplicitAuthorization: false",
  "trialEnrollment.create",
  "notificationSchedule.createMany",
  "savingsBaseline.create",
  "tenantSubscription.create",
  "platformSubscription.create",
  "sendAccountSetupEmail",
  "Registration owner account is missing"
]);

expectIncludesAll("apps/api/src/routes/registration.js", "Public registration exposes introductory program start endpoint", [
  "\"/intro-trial\"",
  "createRegistrationIntroTrial"
]);

expectIncludesAll("apps/api/src/routes/superAdmin.js", "Super Admin creation uses shared provisioning service", [
  "provisionRestaurantTenant",
  "billingMode",
  "trialEnrollments",
  "platformSubscriptions"
]);

expectIncludesAll("apps/api/src/routes/restaurant.js", "Restaurant profile returns introductory program summary", [
  "introductoryProgram",
  "trialEnrollments",
  "notificationSchedules",
  "savingsBaseline",
  "buildIntroductoryProgramSummary"
]);

expectIncludesAll("apps/web/src/App.jsx", "Frontend supports intro trial setup and owner countdown", [
  "billingMode",
  "introductoryProgramAvailable",
  "/api/registration/intro-trial",
  "TrialCountdownPanel",
  "planStartAvailable",
  "No automatic charge"
]);

const failures = checks.filter((check) => !check.pass);

if (failures.length) {
  console.error("Introductory program checks failed:");
  for (const failure of failures) console.error(`- ${failure.file}: ${failure.label}`);
  process.exit(1);
}

console.log(`Introductory program checks passed (${checks.length}).`);

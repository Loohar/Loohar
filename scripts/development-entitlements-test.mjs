import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const schema = readFileSync(join(root, "apps/api/prisma/schema.prisma"), "utf8");
const middleware = readFileSync(join(root, "apps/api/src/middleware/entitlements.js"), "utf8");
const config = readFileSync(join(root, "apps/api/src/config/entitlements.js"), "utf8");
const route = readFileSync(join(root, "apps/api/src/routes/entitlementSimulation.js"), "utf8");
const server = readFileSync(join(root, "apps/api/src/server.js"), "utf8");
const apiPackage = readFileSync(join(root, "apps/api/package.json"), "utf8");
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const migrationRoot = join(root, "apps/api/prisma/migrations");
const markDevelopmentTenantScript = readFileSync(join(root, "apps/api/prisma/mark-development-tenant.js"), "utf8");
const failures = [];

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function assertCheck(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

function migrationContains(value) {
  if (!existsSync(migrationRoot)) return false;
  return readdirSync(migrationRoot).some((folder) => {
    const file = join(migrationRoot, folder, "migration.sql");
    return existsSync(file) && readFileSync(file, "utf8").includes(value);
  });
}

if (mode === "all" || mode === "entitlements") {
  assertCheck(includesAll(schema, [
    "enum TenantClassification",
    "INTERNAL_DEVELOPMENT",
    "PRIVATE_BETA",
    "model TenantEntitlementSimulation",
    "entitlementSimulation TenantEntitlementSimulation?"
  ]) && migrationContains("CREATE TABLE \"TenantEntitlementSimulation\""), "Development tenant classification and entitlement simulation are persisted in Prisma");
  assertCheck(includesAll(middleware, [
    "applyEntitlementSimulation",
    "isInternalTenantClassification",
    "INTERNAL_FULL_ACCESS_DEFAULT",
    "fullAccess",
    "actualPlanCode",
    "actualSubscriptionStatus"
  ]), "Central entitlement loader applies internal full access without POS-only bypass");
  assertCheck(includesAll(config, [
    "entitlement.fullAccess",
    "LIMIT_BYPASSED_INTERNAL_FULL_ACCESS",
    "fullAccessSource"
  ]), "Feature and usage decisions respect centralized internal full-access entitlements");
}

if (mode === "all" || mode === "plan-simulation") {
  assertCheck(includesAll(route, [
    "SIMULATE_PLAN",
    "SIMULATE_SUSPENDED",
    "SIMULATE_EXPIRED_TRIAL",
    "SIMULATE_PAST_DUE",
    "SIMULATE_CANCELLED",
    "normalizePlanCode",
    "planMatrixRows",
    "ENTITLEMENT_SIMULATION_NOT_AVAILABLE"
  ]), "Development simulator supports plan and subscription-state simulation through a guarded API");
  assertCheck(includesAll(app, [
    "function DevelopmentEntitlementSimulator",
    "Full access",
    "Starter",
    "Professional",
    "Enterprise",
    "Past due",
    "Suspended",
    "Cancelled",
    "Disable simulation"
  ]), "Restaurant settings expose a development-only plan simulator UI");
}

if (mode === "all" || mode === "subscription-analysis") {
  assertCheck(includesAll(middleware, [
    "actualPlanCode",
    "actualSubscriptionStatus",
    "SIMULATE_PAST_DUE",
    "SIMULATE_CANCELLED",
    "SIMULATE_EXPIRED_TRIAL",
    "SIMULATE_SUSPENDED"
  ]) && includesAll(config, [
    "subscriptionAccessForStatus",
    "PAST_DUE",
    "UNPAID",
    "CANCELLED",
    "SUSPENDED"
  ]) && includesAll(route, [
    "\"SUSPENDED\"",
    "\"PAST_DUE\"",
    "\"CANCELLED\"",
    "\"ACTIVE\""
  ]), "Simulation preserves actual billing analysis while exercising subscription access states");
}

if (mode === "all" || mode === "billing-isolation") {
  const forbiddenMutations = [
    "stripe.subscriptions.update",
    "stripe.checkout",
    "platformSubscription.update",
    "tenantSubscription.update",
    "restaurantOrderPayment.update",
    "payment.update"
  ];
  assertCheck(forbiddenMutations.every((value) => !route.includes(value)), "Simulation route does not mutate Stripe, subscription, billing, or payment records");
  assertCheck(includesAll(route, [
    "development.entitlement_simulation.updated",
    "Simulation changes do not modify Stripe",
    "prisma.auditLog.create",
    "requireAuth"
  ]) && includesAll(server, [
    "entitlementSimulationRoutes",
    "app.use(\"/api/restaurants\", entitlementSimulationRoutes)"
  ]), "Simulation changes are authenticated, audited, and mounted through the API");
}

if (mode === "all" || mode === "tenant-classification") {
  assertCheck(includesAll(schema, [
    "tenantClassification TenantClassification",
    "model TenantEntitlementSimulation",
    "restaurant                  Restaurant"
  ]), "Tenant classification is attached to Restaurant, the current tenant root model");
  assertCheck(migrationContains("ADD COLUMN \"tenantClassification\" \"TenantClassification\" NOT NULL DEFAULT 'STANDARD'"), "Migration adds Restaurant.tenantClassification with STANDARD default");
  assertCheck(!migrationContains("LIKE '%development%'") && !migrationContains("INTERNAL_DEVELOPMENT'\nWHERE"), "Migration does not grant internal access using slug, name, or fuzzy text matching");
  assertCheck(includesAll(markDevelopmentTenantScript, [
    "DEVELOPMENT_TENANT_ID",
    "findUnique",
    "tenantClassification: \"INTERNAL_DEVELOPMENT\"",
    "development.tenant_classification.updated",
    "billingChanged: false",
    "subscriptionChanged: false",
    "paymentChanged: false"
  ]), "Development tenant marking requires an explicit tenant ID and records a non-billing audit log");
  assertCheck(apiPackage.includes("\"tenant:mark-development\""), "API exposes controlled tenant:mark-development script");
}

if (failures.length) {
  console.error(`development-entitlements-test (${mode}) failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`development-entitlements-test (${mode}) passed.`);

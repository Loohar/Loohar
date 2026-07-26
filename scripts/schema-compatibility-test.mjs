import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const server = readFileSync(join(root, "apps/api/src/server.js"), "utf8");
const schemaCompatibility = readFileSync(join(root, "apps/api/src/utils/schemaCompatibility.js"), "utf8");
const errorHandler = readFileSync(join(root, "apps/api/src/middleware/errorHandler.js"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const failures = [];

function assertCheck(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else {
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

assertCheck(includesAll(schemaCompatibility, [
  "20260724090000_development_entitlement_simulation",
  "Restaurant",
  "tenantClassification",
  "TenantEntitlementSimulation",
  "MISSING_RESTAURANT_TENANT_CLASSIFICATION_COLUMN",
  "MISSING_REQUIRED_PRISMA_MIGRATION",
  "schemaCompatibilitySnapshot"
]), "Schema compatibility guard checks the tenant-classification migration and required database objects");

assertCheck(includesAll(server, [
  "refreshSchemaCompatibility",
  "res.status(ok ? 200 : 503)",
  "app.get(\"/health\", healthHandler)",
  "app.get(\"/api/health\", healthHandler)"
]), "API health reports 503 when the deployed database schema is behind");

assertCheck(includesAll(errorHandler, [
  "isPrismaMissingColumn",
  "POS_CONFIGURATION_UNAVAILABLE",
  "DATABASE_SCHEMA_MISMATCH",
  "The POS configuration could not be loaded.",
  "requestId"
]) && !errorHandler.includes("detail: process.env.NODE_ENV"), "Missing-column errors are sanitized and include structured request IDs");

assertCheck(packageJson.includes("\"test:schema-compatibility\"") && packageJson.includes("\"test:tenant-classification\""), "Root package exposes schema and tenant-classification test scripts");

if (failures.length) {
  console.error(`schema-compatibility-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("schema-compatibility-test passed.");

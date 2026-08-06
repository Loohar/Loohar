import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { describeDatabaseUrl, printSafeUrlSummary } from "./safe-db-url-metadata.mjs";

for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "apps/api/.env")]) {
  if (existsSync(envPath)) loadDotenv({ path: envPath, override: false });
}

const requiredMigrations = [
  "20260724090000_development_entitlement_simulation",
  "20260802120000_enterprise_pos_workflows",
  "20260804090000_auth_device_sessions"
];

const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF || process.env.STAGING_SUPABASE_PROJECT_REF || "";
const databaseUrl = process.env.DATABASE_URL || "";
const directUrl = process.env.DIRECT_URL || "";
const databaseMeta = describeDatabaseUrl(databaseUrl);
const directMeta = describeDatabaseUrl(directUrl);
const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "";
const requireSchemaCurrent = process.argv.includes("--require-schema-current");
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function assert(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function assertUrlMatches(label, metadata) {
  assert(metadata.ok, `${label} is parseable`);
  if (!metadata.ok) return;
  assert(Boolean(metadata.projectRef), `${label} exposes a Supabase project reference through safe metadata`);
  if (expectedProjectRef) {
    assert(metadata.projectRef === expectedProjectRef, `${label} matches the expected staging Supabase project reference`);
  }
  assert(metadata.mode !== "supabase-transaction-pooler", `${label} is not the transaction pooler on port 6543`);
}

console.log("Staging database identity check");
console.log("Environment:", {
  appEnv,
  expectedProjectRef: expectedProjectRef ? "configured" : "missing",
  requireSchemaCurrent
});
printSafeUrlSummary("DATABASE_URL", databaseMeta, expectedProjectRef);
printSafeUrlSummary("DIRECT_URL", directMeta, expectedProjectRef);

assert(appEnv === "staging", "APP_ENV is staging");
assert(Boolean(expectedProjectRef), "EXPECTED_SUPABASE_PROJECT_REF is configured");
assertUrlMatches("DATABASE_URL", databaseMeta);
assertUrlMatches("DIRECT_URL", directMeta);

if (failures.length) {
  console.error("Database identity check stopped before opening a database connection.");
  process.exit(1);
}

process.env.DATABASE_URL = directUrl || databaseUrl;
process.env.DIRECT_URL = process.env.DATABASE_URL;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({
  log: [{ level: "error", emit: "event" }]
});

try {
  const dbRows = await prisma.$queryRaw`SELECT current_database() AS database_name`;
  const authSessionRows = await prisma.$queryRaw`SELECT to_regclass('public."AuthSession"')::text AS table_name`;
  const migrationRows = await prisma.$queryRaw`
    SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
    ORDER BY finished_at DESC, started_at DESC
  `;
  const migrationNames = new Set(migrationRows.map((row) => row.migration_name));
  const missingMigrations = requiredMigrations.filter((migrationName) => !migrationNames.has(migrationName));

  console.log("Database query result:", {
    currentDatabase: dbRows[0]?.database_name || "unknown",
    authSessionExists: Boolean(authSessionRows[0]?.table_name),
    appliedMigrationCount: migrationRows.length,
    latestAppliedMigration: migrationRows[0]?.migration_name || null,
    requiredMigrationsApplied: missingMigrations.length === 0
  });

  assert(dbRows[0]?.database_name === "postgres", "Connected database name is postgres");
  if (requireSchemaCurrent) {
    assert(Boolean(authSessionRows[0]?.table_name), "AuthSession table exists");
    assert(missingMigrations.length === 0, "Required staging migrations are applied");
  } else {
    console.log("Schema readiness:", {
      authSessionExists: Boolean(authSessionRows[0]?.table_name),
      missingRequiredMigrationCount: missingMigrations.length,
      status: missingMigrations.length === 0 && authSessionRows[0]?.table_name ? "current" : "pending-migration"
    });
  }

  if (missingMigrations.length && requireSchemaCurrent) {
    console.error("Missing required migrations:", missingMigrations);
  }
} finally {
  await prisma.$disconnect();
}

if (failures.length) {
  console.error(`staging-db-identity-check failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("staging-db-identity-check passed.");

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const deployScript = readFileSync(join(root, "scripts/prisma-deploy-with-retry.mjs"), "utf8");
const identityScript = readFileSync(join(root, "scripts/staging-db-identity-check.mjs"), "utf8");
const metadataHelper = readFileSync(join(root, "scripts/safe-db-url-metadata.mjs"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const apiPackageJson = readFileSync(join(root, "apps/api/package.json"), "utf8");
const failures = [];

function assertCheck(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else {
    failures.push(message);
    console.error(`FAIL ${message}`);
  }
}

assertCheck(
  deployScript.includes("ALLOW_PRISMA_MIGRATE_SESSION_POOLER") &&
    deployScript.includes("APP_ENV === \"staging\"") &&
    deployScript.includes("EXPECTED_SUPABASE_PROJECT_REF"),
  "Prisma deploy guard only allows Supabase session pooler with explicit staging identity configuration"
);

assertCheck(
  deployScript.includes("supabase-transaction-pooler") &&
    deployScript.includes("port 6543") &&
    deployScript.includes("process.exit(1)"),
  "Prisma deploy guard blocks transaction pooler migrations"
);

assertCheck(
  deployScript.includes("redactSensitiveText") &&
    metadataHelper.includes("postgresql://<redacted>@") &&
    metadataHelper.includes("maskValue"),
  "Migration output is redacted before being written to logs"
);

assertCheck(
  identityScript.includes("printSafeUrlSummary(\"DATABASE_URL\"") &&
    identityScript.includes("printSafeUrlSummary(\"DIRECT_URL\"") &&
    identityScript.includes("current_database()") &&
    identityScript.includes("AuthSession") &&
    identityScript.includes("--require-schema-current"),
  "Staging identity probe reports masked URL metadata and can enforce schema-current checks after migration"
);

assertCheck(
  identityScript.includes("to_regclass('public.\"AuthSession\"')::text"),
  "Staging identity probe casts AuthSession table metadata to text for Prisma compatibility"
);

assertCheck(
  packageJson.includes("\"staging:db:identity\"") &&
    apiPackageJson.includes("\"staging:db:identity\"") &&
    apiPackageJson.includes("\"staging:db:identity:current\""),
  "Root and API packages expose staging database identity scripts"
);

if (failures.length) {
  console.error(`staging-db-identity-guard-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("staging-db-identity-guard-test passed.");

// Verifies that applying every migration to a DISPOSABLE local database produces exactly the
// schema in apps/api/prisma/schema.prisma. Drift means `prisma migrate dev`/`db push` would try
// to drop real tables, columns or indexes.
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/fresh_db node scripts/schema-migration-drift-db-test.mjs
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";
let host = "";
try {
  host = new URL(databaseUrl).hostname;
} catch {
  host = "";
}
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.log("SKIP schema drift DB test: set LOOHAR_TEST_DATABASE_URL to a disposable local database.");
  process.exit(0);
}

const apiDir = resolve("apps/api");
const prismaBin = resolve("node_modules/.bin/prisma");
const env = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
const run = (args) => spawnSync(prismaBin, args, { cwd: apiDir, env, encoding: "utf8" });

const deploy = run(["migrate", "deploy"]);
if (deploy.status !== 0) {
  console.error("FAIL migrations did not apply cleanly");
  process.exit(1);
}
const diff = run(["migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
if (diff.status === 0) {
  console.log("PASS migrations and schema.prisma describe the same database");
  process.exit(0);
}
console.error("FAIL schema.prisma differs from the migrated database:");
console.error(run(["migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--script"]).stdout);
process.exit(1);

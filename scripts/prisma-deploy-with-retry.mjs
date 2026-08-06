import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { describeDatabaseUrl, maskValue, printSafeUrlSummary, redactSensitiveText } from "./safe-db-url-metadata.mjs";

for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "apps/api/.env")]) {
  if (existsSync(envPath)) loadDotenv({ path: envPath, override: false });
}

const maxAttempts = 3;
const retryDelaysMs = [5000, 15000, 30000];
const transientPatterns = [
  /EMAXCONNSESSION/i,
  /P1001/i,
  /P1002/i,
  /connection timeout/i,
  /connect ETIMEDOUT/i,
  /ECONNRESET/i,
  /Connection terminated/i,
  /Timed out fetching a new connection/i,
  /Can't reach database server/i
];

function getMigrationEnv() {
  const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!migrationUrl) {
    console.error("DIRECT_URL or DATABASE_URL is required to run Prisma migrations.");
    process.exit(1);
  }

  const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF || process.env.STAGING_SUPABASE_PROJECT_REF || "";
  const metadata = describeDatabaseUrl(migrationUrl);
  printSafeUrlSummary(`Prisma migrations will use ${process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL"}`, metadata, expectedProjectRef);

  if (!metadata.ok) {
    console.error("Refusing to run Prisma migrations because the database URL cannot be parsed safely.");
    process.exit(1);
  }

  if (expectedProjectRef && metadata.projectRef !== expectedProjectRef) {
    console.error(
      `Refusing to run Prisma migrations because the database project (${metadata.maskedProjectRef}) ` +
        `does not match the expected staging project (${maskValue(expectedProjectRef)}).`
    );
    process.exit(1);
  }

  if (metadata.mode === "supabase-transaction-pooler") {
    console.error("Refusing to run Prisma migrations through Supabase transaction pooler port 6543.");
    process.exit(1);
  }

  if (metadata.mode === "supabase-session-pooler") {
    const allowSessionPooler = process.env.ALLOW_PRISMA_MIGRATE_SESSION_POOLER === "true";
    const isStaging = process.env.APP_ENV === "staging";
    if (!allowSessionPooler || !isStaging || !expectedProjectRef) {
      console.error(
        "Refusing to run Prisma migrations through Supabase session pooler. " +
          "Use the direct Supabase database URL, or set APP_ENV=staging, EXPECTED_SUPABASE_PROJECT_REF, " +
          "and ALLOW_PRISMA_MIGRATE_SESSION_POOLER=true for the isolated staging service only."
      );
      process.exit(1);
    }
    console.warn("Using Supabase session pooler for Prisma migrations because explicit staging-only approval is configured.");
  }

  if (process.env.APP_ENV === "staging" && !expectedProjectRef) {
    console.error("Refusing staging Prisma migrations without EXPECTED_SUPABASE_PROJECT_REF.");
    process.exit(1);
  }

  return {
    ...process.env,
    DATABASE_URL: migrationUrl,
    DIRECT_URL: migrationUrl
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFailure(output) {
  return transientPatterns.some((pattern) => pattern.test(output));
}

function runPrismaDeploy() {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const migrationEnv = getMigrationEnv();
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(command, ["prisma", "migrate", "deploy"], {
      env: migrationEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (chunk) => {
      const text = redactSensitiveText(chunk.toString());
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = redactSensitiveText(chunk.toString());
      output += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      output += error.message;
      resolve({ code: 1, output });
    });

    child.on("close", (code) => {
      resolve({ code, output });
    });
  });
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`Prisma migrate deploy attempt ${attempt}/${maxAttempts}`);
  const result = await runPrismaDeploy();
  if (result.code === 0) {
    process.exit(0);
  }

  const transient = isTransientFailure(result.output);
  const hasRetry = attempt < maxAttempts;
  if (!transient || !hasRetry) {
    if (!transient) {
      console.error("Prisma migrate deploy failed with a non-transient error. Not retrying.");
    }
    process.exit(result.code || 1);
  }

  const delay = retryDelaysMs[attempt - 1] || retryDelaysMs.at(-1);
  console.warn(`Transient database connection failure detected. Retrying in ${Math.round(delay / 1000)}s.`);
  await sleep(delay);
}

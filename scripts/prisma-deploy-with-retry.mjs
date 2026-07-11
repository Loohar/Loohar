import { spawn } from "node:child_process";

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

function describeDatabaseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.hostname}:${parsed.port || "default"}`;
  } catch {
    return "unparseable database URL";
  }
}

function getMigrationEnv() {
  const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!migrationUrl) {
    console.error("DIRECT_URL or DATABASE_URL is required to run Prisma migrations.");
    process.exit(1);
  }

  const target = describeDatabaseUrl(migrationUrl);
  if (/pooler\.supabase\.com:5432/i.test(target)) {
    console.error(
      `Refusing to run Prisma migrations through Supabase session pooler (${target}). ` +
        "Set DIRECT_URL to the direct Supabase database URL: db.<project-ref>.supabase.co:5432."
    );
    process.exit(1);
  }

  console.log(`Prisma migrations will use ${process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL"} (${target}).`);
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
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
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

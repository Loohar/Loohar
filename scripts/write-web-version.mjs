import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const UNKNOWN = "unknown";
const COMMIT_SHA_PATTERN = /^[a-f0-9]{7,64}$/i;

function firstStringValue(env, keys) {
  for (const key of keys) {
    const value = String(env?.[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function safeCommitSha(value) {
  const candidate = String(value || "").trim();
  return COMMIT_SHA_PATTERN.test(candidate) ? candidate : UNKNOWN;
}

function safeMetadataValue(value) {
  const candidate = String(value || "").trim();
  return candidate || UNKNOWN;
}

export function resolveWebDeploymentMetadata(env = process.env, { buildTime = new Date().toISOString() } = {}) {
  return {
    service: "web",
    serviceName: "web",
    environment: safeMetadataValue(firstStringValue(env, ["LOOHAR_BUILD_ENVIRONMENT", "VERCEL_ENV", "NODE_ENV"])),
    commitSha: safeCommitSha(firstStringValue(env, ["VERCEL_GIT_COMMIT_SHA", "GIT_COMMIT_SHA", "COMMIT_SHA", "SOURCE_VERSION", "GITHUB_SHA"])),
    buildTime: safeMetadataValue(firstStringValue(env, ["BUILD_TIME"]) || buildTime),
    // Present only in a native build. The installed app compares its own versionCode with the one
    // published beside the APK to know whether a newer build exists, and Android's own ordering is
    // numeric on versionCode, so that is what is carried here.
    ...(firstStringValue(env, ["LOOHAR_APP_PACKAGE"]) ? { package: firstStringValue(env, ["LOOHAR_APP_PACKAGE"]) } : {}),
    ...(firstStringValue(env, ["LOOHAR_VERSION_CODE"]) ? { versionCode: firstStringValue(env, ["LOOHAR_VERSION_CODE"]) } : {}),
    ...(firstStringValue(env, ["LOOHAR_VERSION_NAME"]) ? { versionName: firstStringValue(env, ["LOOHAR_VERSION_NAME"]) } : {})
  };
}

export function writeWebVersionFile({
  rootDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  env = process.env,
  buildTime
} = {}) {
  const outputPath = resolve(rootDir, "apps/web/public/version.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(resolveWebDeploymentMetadata(env, { buildTime }), null, 2)}\n`);
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputPath = writeWebVersionFile();
  console.log(`Wrote web deployment metadata to ${outputPath}`);
}

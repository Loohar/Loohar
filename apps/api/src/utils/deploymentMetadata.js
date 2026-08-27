const UNKNOWN = "unknown";
const COMMIT_SHA_PATTERN = /^[a-f0-9]{7,64}$/i;

function firstStringValue(env, keys) {
  for (const key of keys) {
    const value = String(env?.[key] || "").trim();
    if (value) return value;
  }
  return "";
}

export function safeCommitSha(value) {
  const candidate = String(value || "").trim();
  return COMMIT_SHA_PATTERN.test(candidate) ? candidate : UNKNOWN;
}

export function safeMetadataValue(value) {
  const candidate = String(value || "").trim();
  return candidate || UNKNOWN;
}

export function apiDeploymentMetadata(env = process.env) {
  return {
    service: "api",
    serviceName: safeMetadataValue(firstStringValue(env, ["RENDER_SERVICE_NAME", "SERVICE_NAME"]) || "api"),
    environment: safeMetadataValue(firstStringValue(env, ["APP_ENV", "NODE_ENV"])),
    commitSha: safeCommitSha(firstStringValue(env, ["RENDER_GIT_COMMIT", "GIT_COMMIT_SHA", "COMMIT_SHA", "SOURCE_VERSION", "GITHUB_SHA"])),
    buildTime: safeMetadataValue(firstStringValue(env, ["BUILD_TIME", "RENDER_BUILD_TIME"]))
  };
}

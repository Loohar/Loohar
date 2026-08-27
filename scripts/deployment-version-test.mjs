import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apiDeploymentMetadata } from "../apps/api/src/utils/deploymentMetadata.js";
import { buildHealthPayload } from "../apps/api/src/utils/healthPayload.js";
import { resolveWebDeploymentMetadata } from "./write-web-version.mjs";

const sha = "038b5b17f9da5878b21253da68d00ff2cc3f8d00";
const buildTime = "2026-08-27T18:30:00.000Z";

const apiMetadata = apiDeploymentMetadata({
  RENDER_GIT_COMMIT: sha,
  RENDER_SERVICE_NAME: "loohar-api",
  NODE_ENV: "production",
  BUILD_TIME: buildTime,
  DATABASE_URL: "postgres://sensitive.example",
  JWT_SECRET: "sensitive-secret"
});
assert.equal(apiMetadata.commitSha, sha, "API metadata should use Render commit SHA");
assert.equal(apiMetadata.service, "api", "API metadata should identify the service");
assert.equal(apiMetadata.serviceName, "loohar-api", "API metadata should include safe Render service name");
assert.equal(apiMetadata.environment, "production", "API metadata should include environment");
assert.equal(apiMetadata.buildTime, buildTime, "API metadata should include safe build time");
assert.equal(JSON.stringify(apiMetadata).includes("sensitive"), false, "API metadata must not expose sensitive env values");
assert.equal(JSON.stringify(apiMetadata).includes("DATABASE_URL"), false, "API metadata must not expose sensitive env keys");

const apiFallback = apiDeploymentMetadata({});
assert.equal(apiFallback.commitSha, "unknown", "API metadata should safely fall back without provider SHA");
assert.equal(apiFallback.environment, "unknown", "API metadata should safely fall back without environment");

const webMetadata = resolveWebDeploymentMetadata({
  VERCEL_GIT_COMMIT_SHA: sha,
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres://sensitive.example",
  VERCEL_OIDC_TOKEN: "sensitive-token"
}, { buildTime });
assert.equal(webMetadata.commitSha, sha, "Web metadata should use Vercel commit SHA");
assert.equal(webMetadata.service, "web", "Web metadata should identify the service");
assert.equal(webMetadata.environment, "production", "Web metadata should include Vercel environment");
assert.equal(webMetadata.buildTime, buildTime, "Web metadata should include build time");
assert.equal(JSON.stringify(webMetadata).includes("sensitive"), false, "Web metadata must not expose sensitive env values");
assert.equal(JSON.stringify(webMetadata).includes("TOKEN"), false, "Web metadata must not expose sensitive env keys");

const webFallback = resolveWebDeploymentMetadata({}, { buildTime });
assert.equal(webFallback.commitSha, "unknown", "Web metadata should safely fall back without provider SHA");
assert.equal(webFallback.environment, "unknown", "Web metadata should safely fall back without Vercel environment");

const healthPayload = buildHealthPayload({
  schema: { ok: true, checkedAt: "2026-08-27T18:30:00.000Z", issues: [] },
  deployment: apiMetadata
});
assert.equal(healthPayload.ok, true, "Health payload should preserve ok");
assert.equal(healthPayload.service, "api", "Health payload should preserve service");
assert.equal(healthPayload.platform, "Loohar", "Health payload should preserve platform");
assert.deepEqual(healthPayload.schema.issues, [], "Health payload should preserve schema");
assert.equal(healthPayload.deployment.commitSha, sha, "Health payload should include deployment metadata");

const serverSource = readFileSync("apps/api/src/server.js", "utf8");
assert.ok(serverSource.includes('app.get("/version", versionHandler);'), "API should expose /version");
assert.ok(serverSource.includes('app.get("/api/version", versionHandler);'), "API should expose /api/version");
assert.ok(serverSource.includes("buildHealthPayload"), "API health should use compatible health payload builder");

const vercelConfig = readFileSync("apps/web/vercel.json", "utf8");
assert.ok(vercelConfig.includes('"source": "/version"'), "Vercel should route /version to web metadata");
assert.ok(vercelConfig.includes('"destination": "/version.json"'), "Vercel should serve generated web metadata JSON");

console.log("deployment-version-test passed.");

import { apiDeploymentMetadata } from "./deploymentMetadata.js";

export function buildHealthPayload({
  schema,
  platform = process.env.PLATFORM_NAME || "Loohar",
  domain = process.env.PLATFORM_DOMAIN || "loohar.com",
  deployment = apiDeploymentMetadata()
} = {}) {
  const shapedSchema = schema || { ok: false, issues: [] };
  return {
    ok: Boolean(shapedSchema.ok),
    service: "api",
    platform,
    domain,
    deployment,
    schema: shapedSchema
  };
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve("apps/api/.env");
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];

function loadApiEnv() {
  const env = {};
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
  return { ...process.env, ...env };
}

function required(value, name) {
  if (!value) {
    throw new Error(`${name} is missing in apps/api/.env`);
  }
}

async function apiFetch(url, serviceRoleKey, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      ...(options.headers || {})
    }
  });
}

async function ensureBucket({ supabaseUrl, serviceRoleKey, bucket }) {
  const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`;
  const existing = await apiFetch(bucketUrl, serviceRoleKey);
  if (existing.ok) {
    const bucketInfo = await existing.json().catch(() => ({}));
    if (bucketInfo.public === false) {
      const update = await apiFetch(bucketUrl, serviceRoleKey, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public: true,
          file_size_limit: MAX_UPLOAD_BYTES,
          allowed_mime_types: ALLOWED_MIME_TYPES
        })
      });
      if (!update.ok) throw new Error(`Bucket exists but could not be made public: ${await update.text()}`);
      return "updated-public";
    }
    return "ready";
  }

  const existingDetail = await existing.text().catch(() => "");
  const bucketMissing = existing.status === 404 || /bucket not found/i.test(existingDetail);
  if (!bucketMissing) {
    throw new Error(`Bucket check failed: ${existingDetail || existing.statusText}`);
  }

  const created = await apiFetch(`${supabaseUrl}/storage/v1/bucket`, serviceRoleKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: MAX_UPLOAD_BYTES,
      allowed_mime_types: ALLOWED_MIME_TYPES
    })
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`Bucket could not be created: ${await created.text()}`);
  }
  return "created";
}

try {
  const env = loadApiEnv();
  const supabaseUrl = (env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEY || "";
  const bucket = env.SUPABASE_STORAGE_BUCKET || env.SUPABASE_BUCKET || env.STORAGE_BUCKET || "loohar-uploads";

  required(supabaseUrl, "SUPABASE_URL");
  required(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY");
  required(bucket, "SUPABASE_STORAGE_BUCKET");

  const status = await ensureBucket({ supabaseUrl, serviceRoleKey, bucket });
  console.log(`Supabase Storage ready: bucket "${bucket}" ${status}.`);
} catch (error) {
  console.error(`Supabase Storage check failed: ${error.message}`);
  console.error("Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET to apps/api/.env, then run npm run storage:check again.");
  process.exit(1);
}

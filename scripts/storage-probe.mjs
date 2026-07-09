import { config } from "dotenv";
import { uploadImageToSupabaseStorage } from "../apps/api/src/services/uploadService.js";

config({ path: "apps/api/.env" });

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/at+X2cAAAAASUVORK5CYII=";

function storageConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  return { supabaseUrl, serviceRoleKey };
}

async function removeObject({ bucket, key }) {
  const { supabaseUrl, serviceRoleKey } = storageConfig();
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prefixes: [key] })
  });
  if (!response.ok) {
    throw new Error(`Probe upload succeeded but cleanup failed: ${await response.text()}`);
  }
}

try {
  const upload = await uploadImageToSupabaseStorage({
    restaurantId: "storage-probe",
    kind: "gallery",
    fileName: "storage-probe.png",
    mimeType: "image/png",
    base64: tinyPngBase64
  });
  await removeObject({ bucket: upload.bucket, key: upload.key });
  console.log(`Supabase Storage probe passed: uploaded and removed a test PNG in bucket "${upload.bucket}".`);
} catch (error) {
  console.error(`Supabase Storage probe failed: ${error.message}`);
  process.exit(1);
}

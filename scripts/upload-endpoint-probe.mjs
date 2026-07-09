import { config } from "dotenv";

config({ path: "apps/api/.env" });

const API_BASE = (process.env.LOCAL_API_URL || "http://localhost:5001/api").replace(/\/+$/, "");
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/at+X2cAAAAASUVORK5CYII=";

function storageConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase Storage env is missing.");
  return { supabaseUrl, serviceRoleKey };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
  return payload;
}

async function removeStorageObject(upload) {
  if (!upload?.bucket || !upload?.key) return;
  const { supabaseUrl, serviceRoleKey } = storageConfig();
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(upload.bucket)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prefixes: [upload.key] })
  });
  if (!response.ok) throw new Error(`Storage cleanup failed: ${await response.text()}`);
}

let prisma;
let createdImageId = "";
let createdUpload = null;

try {
  ({ prisma } = await import("../apps/api/src/config/prisma.js"));

  const login = await jsonFetch(`${API_BASE}/auth/demo-login`, {
    method: "POST",
    body: JSON.stringify({ role: "SUPER_ADMIN" })
  });
  const tenants = await jsonFetch(`${API_BASE}/admin/tenants`, {
    headers: { Authorization: `Bearer ${login.accessToken}` }
  });
  const restaurant = (tenants.businesses || tenants.restaurants || []).find((item) => item.status === "ACTIVE") || (tenants.businesses || tenants.restaurants || [])[0];
  if (!restaurant?.id) throw new Error("No active restaurant tenant found for upload probe.");

  const uploadPayload = await jsonFetch(`${API_BASE}/uploads/gallery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${login.accessToken}` },
    body: JSON.stringify({
      restaurantId: restaurant.id,
      fileName: "upload-endpoint-probe.png",
      mimeType: "image/png",
      base64: tinyPngBase64,
      altText: "Upload endpoint probe",
      category: "test"
    })
  });

  createdImageId = uploadPayload.image?.id || "";
  createdUpload = uploadPayload.upload || null;
  if (!createdImageId || !createdUpload?.publicUrl) {
    throw new Error("Upload endpoint did not return the created gallery image and public URL.");
  }

  console.log(`Upload endpoint probe passed: gallery image persisted and public URL returned for "${restaurant.slug || restaurant.id}".`);
} finally {
  if (createdImageId && prisma) {
    await prisma.restaurantGalleryImage.delete({ where: { id: createdImageId } }).catch(() => {});
  }
  if (createdUpload) {
    await removeStorageObject(createdUpload).catch((error) => {
      console.warn(`Upload endpoint probe cleanup warning: ${error.message}`);
    });
  }
  await prisma?.$disconnect?.();
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"]
]);

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeMime(mimeType = "") {
  const normalized = mimeType.toLowerCase().trim();
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function extensionFor({ fileName = "", mimeType }) {
  const fromMime = MIME_EXTENSIONS.get(mimeType) || MIME_EXTENSIONS.get(normalizeMime(mimeType));
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  const fromName = match?.[1];
  if (fromName && ["png", "jpg", "jpeg", "webp", "svg"].includes(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  return fromMime || "jpg";
}

function sanitizeFileName(fileName = "image") {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const safeBase = baseName.replace(/[^a-z0-9._-]/gi, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return safeBase || "image";
}

function validateMagicBytes(buffer, mimeType) {
  if (mimeType === "image/png") {
    return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (mimeType === "image/jpeg") {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (mimeType === "image/svg+xml") {
    const svgText = buffer.toString("utf8").trimStart().toLowerCase();
    if (svgText.includes("<script") || /\son[a-z]+\s*=/.test(svgText) || svgText.includes("javascript:")) return false;
    return svgText.startsWith("<svg") || svgText.startsWith("<?xml");
  }
  return false;
}

export function parseImageUpload({ dataUrl, base64, mimeType, fileName }) {
  let rawBase64 = base64;
  let detectedMime = normalizeMime(mimeType);

  if (dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw apiError("Upload dataUrl must be a base64 encoded image data URL.");
    detectedMime = normalizeMime(match[1]);
    rawBase64 = match[2];
  }

  if (!rawBase64) throw apiError("Image file data is required.");
  if (!MIME_EXTENSIONS.has(detectedMime)) {
    throw apiError("Unsupported image type. Use PNG, JPG, JPEG, WEBP, or SVG.");
  }

  const buffer = Buffer.from(rawBase64, "base64");
  if (!buffer.length) throw apiError("Uploaded image is empty.");
  if (buffer.length > MAX_UPLOAD_BYTES) throw apiError("Image exceeds the 5MB upload limit.", 413);
  if (!validateMagicBytes(buffer, detectedMime)) {
    throw apiError("Uploaded file content does not match the declared image type.");
  }

  return {
    buffer,
    mimeType: detectedMime,
    extension: extensionFor({ fileName, mimeType: detectedMime }),
    byteSize: buffer.length
  };
}

function supabaseStorageConfig() {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET || process.env.STORAGE_BUCKET || "loohar-uploads";
  if (!supabaseUrl || !serviceRoleKey || !bucket) {
    throw apiError("Supabase Storage is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET.", 503);
  }
  return { supabaseUrl, serviceRoleKey, bucket };
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function storageFolderFor({ kind, menuItemId }) {
  if (kind === "restaurant-logo") return "logo";
  if (kind === "restaurant-hero") return "hero";
  if (kind === "menu-item") return `menu/${String(menuItemId || "").replace(/[^a-z0-9_-]/gi, "-")}`;
  if (kind === "gallery") return "gallery";
  return String(kind).replace(/[^a-z0-9_-]/gi, "-");
}

async function ensureSupabaseBucket({ supabaseUrl, serviceRoleKey, bucket }) {
  const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`;
  const headers = { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey };
  const existing = await fetch(bucketUrl, { headers });
  if (existing.ok) {
    const bucketInfo = await existing.json().catch(() => ({}));
    if (bucketInfo.public === false) {
      const updated = await fetch(bucketUrl, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          public: true,
          file_size_limit: MAX_UPLOAD_BYTES,
          allowed_mime_types: [...MIME_EXTENSIONS.keys()]
        })
      });
      if (!updated.ok) {
        const detail = await updated.text().catch(() => "");
        throw apiError(`Supabase Storage bucket "${bucket}" must be public for restaurant websites. ${detail || updated.statusText}`, updated.status >= 400 && updated.status < 500 ? updated.status : 502);
      }
    }
    return;
  }
  const existingDetail = await existing.text().catch(() => "");
  const bucketMissing = existing.status === 404 || /bucket not found/i.test(existingDetail);
  if (!bucketMissing) {
    const detail = existingDetail;
    throw apiError(`Supabase Storage bucket check failed: ${detail || existing.statusText}`, existing.status >= 400 && existing.status < 500 ? existing.status : 502);
  }

  const created = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: MAX_UPLOAD_BYTES,
      allowed_mime_types: [...MIME_EXTENSIONS.keys()]
    })
  });
  if (!created.ok && created.status !== 409) {
    const detail = await created.text().catch(() => "");
    throw apiError(`Supabase Storage bucket could not be created. Create public bucket "${bucket}" and retry. ${detail || created.statusText}`, created.status >= 400 && created.status < 500 ? created.status : 502);
  }
}

export async function uploadImageToSupabaseStorage({ restaurantId, kind, fileName, dataUrl, base64, mimeType, menuItemId }) {
  const parsed = parseImageUpload({ dataUrl, base64, mimeType, fileName });
  const { supabaseUrl, serviceRoleKey, bucket } = supabaseStorageConfig();
  const safeRestaurantId = String(restaurantId).replace(/[^a-z0-9_-]/gi, "-");
  const safeName = sanitizeFileName(fileName);
  const folder = storageFolderFor({ kind, menuItemId });
  const key = `tenants/${safeRestaurantId}/${folder}/${Date.now()}-${safeName}.${parsed.extension}`;
  const encodedBucket = encodeURIComponent(bucket);
  const encodedKey = encodeStoragePath(key);
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodedBucket}/${encodedKey}`;

  await ensureSupabaseBucket({ supabaseUrl, serviceRoleKey, bucket });

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": parsed.mimeType,
      "Cache-Control": "public, max-age=31536000",
      "x-upsert": "false"
    },
    body: parsed.buffer
  });

  if (!response.ok) {
    const detail = await response.text();
    throw apiError(`Supabase Storage upload failed: ${detail || response.statusText}`, response.status >= 400 && response.status < 500 ? response.status : 502);
  }

  const publicBaseUrl = (process.env.SUPABASE_STORAGE_PUBLIC_BASE_URL || `${supabaseUrl}/storage/v1/object/public/${encodedBucket}`).replace(/\/+$/, "");
  return {
    provider: "supabase_storage",
    bucket,
    key,
    publicUrl: `${publicBaseUrl}/${encodedKey}`,
    mimeType: parsed.mimeType,
    byteSize: parsed.byteSize
  };
}

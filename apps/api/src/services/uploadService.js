export async function createImageUploadPlaceholder({ fileName, restaurantId }) {
  const safeName = fileName.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();
  const provider = process.env.STORAGE_PROVIDER || "local_placeholder";
  const bucket = process.env.STORAGE_BUCKET || "restaurant-assets";
  const key = `${restaurantId}/${Date.now()}-${safeName}`;
  return {
    provider,
    bucket,
    key,
    uploadUrl: provider === "local_placeholder" ? `/uploads/${key}` : `/storage/${provider}/${bucket}/${key}`,
    publicUrl: provider === "local_placeholder" ? `/media/${restaurantId}/${safeName}` : `/storage/${provider}/${bucket}/${key}`,
    supportedProviders: ["cloudinary", "s3", "supabase_storage"]
  };
}

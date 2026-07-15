import { readFileSync } from "node:fs";

const uploadService = readFileSync("apps/api/src/services/uploadService.js", "utf8");
const uploadsRoute = readFileSync("apps/api/src/routes/uploads.js", "utf8");
const restaurantRoute = readFileSync("apps/api/src/routes/restaurant.js", "utf8");
const websiteService = readFileSync("apps/api/src/services/websiteService.js", "utf8");
const app = readFileSync("apps/web/src/App.jsx", "utf8");

const checks = [];

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

assertCheck("Backend upload limit is 5MB", uploadService.includes("const MAX_UPLOAD_BYTES = 5 * 1024 * 1024") && uploadService.includes("Image exceeds the 5MB upload limit."));
assertCheck("Supabase service role stays backend-only", uploadService.includes("SUPABASE_SERVICE_ROLE_KEY") && !app.includes("SUPABASE_SERVICE_ROLE_KEY"));
assertCheck("Logo storage path is isolated", uploadService.includes("return \"branding/logo\""));
assertCheck("Hero storage path is isolated", uploadService.includes("return \"branding/hero\"") && uploadService.includes("return \"branding/hero/mobile\""));
assertCheck("Menu item storage path is isolated", uploadService.includes("return `menu-items/${String(menuItemId"));
assertCheck("Gallery storage path is isolated", uploadService.includes("return \"gallery\""));
assertCheck("SVG restricted to logo and favicon", uploadService.includes("SVG uploads are only allowed for restaurant logos and favicons."));

assertCheck("Uploads require auth and tenant roles", uploadsRoute.includes("router.use(requireAuth, requireRole(...uploadRoles))"));
assertCheck("Menu upload verifies tenant-owned menu item", uploadsRoute.includes("where: { id_restaurantId: { id: req.body.menuItemId, restaurantId: restaurant.id } }"));
const galleryUploadBlock = uploadsRoute.slice(uploadsRoute.indexOf("const count = await prisma.restaurantGalleryImage.count"));
assertCheck(
  "Gallery upload creates gallery record only",
  galleryUploadBlock.includes("prisma.restaurantGalleryImage.create") &&
    galleryUploadBlock.includes("imageUrl: upload.publicUrl") &&
    !galleryUploadBlock.includes("heroImageUrl: upload.publicUrl") &&
    !galleryUploadBlock.includes("logoUrl: upload.publicUrl")
);
assertCheck("Upload audit actions identify media slot", ["website.logo.uploaded", "website.hero.uploaded", "website.favicon.uploaded", "menu.item.image.uploaded", "gallery.image.uploaded"].every((action) => uploadsRoute.includes(action)));
assertCheck("Gallery management audit actions identify gallery", ["gallery.image.created", "gallery.image.updated", "gallery.image.deleted"].every((action) => restaurantRoute.includes(action)));

assertCheck("Website bundle does not synthesize galleries", !websiteService.includes("DEFAULT_GALLERY_IMAGES.map"));
assertCheck("Website bundle does not use hero as menu image fallback", !websiteService.includes("resolveImage(item.imageUrl, website.heroImageUrl"));
assertCheck("Frontend image validation is 5MB", app.includes("const maxImageBytes = 5 * 1024 * 1024") && app.includes("Image must be 5MB or smaller."));
assertCheck("Public renderers do not use hero as menu image fallback", !app.includes("resolveImage(item.imageUrl, heroImage)") && !app.includes("resolveImage(item.imageUrl, website.heroImageUrl)"));
assertCheck("Public renderers do not use hero as gallery fallback", !app.includes("resolveImage(image.imageUrl, heroImage)") && !app.includes("resolveImage(image.imageUrl, website.heroImageUrl)"));
assertCheck("About pages do not pull gallery images", !app.includes("gallery[1]?.imageUrl"));

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

const failed = checks.filter((check) => !check.ok);
console.log(`Media test: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);

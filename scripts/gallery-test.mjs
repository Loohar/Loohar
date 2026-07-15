import { readFileSync } from "node:fs";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const restaurantRoute = readFileSync("apps/api/src/routes/restaurant.js", "utf8");
const uploadsRoute = readFileSync("apps/api/src/routes/uploads.js", "utf8");
const websiteService = readFileSync("apps/api/src/services/websiteService.js", "utf8");
const publicRoute = readFileSync("apps/api/src/routes/public.js", "utf8");
const app = readFileSync("apps/web/src/App.jsx", "utf8");

const checks = [];

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

assertCheck("Gallery model stores title/caption/publish metadata", ["title        String?", "caption      String?", "published    Boolean    @default(true)", "updatedAt    DateTime   @updatedAt"].every((snippet) => schema.includes(snippet)));
assertCheck("Gallery upload preserves metadata", ["title: req.body.title", "caption: req.body.caption", "published: toBoolean(req.body.published", "sortOrder: Number.isInteger(Number(req.body.sortOrder))"].every((snippet) => uploadsRoute.includes(snippet)));
assertCheck("Gallery update supports metadata and publish state", restaurantRoute.includes("pickEditable(req.body, [\"title\", \"altText\", \"caption\", \"category\", \"sortOrder\", \"published\"]") && restaurantRoute.includes("published = toBoolean"));
assertCheck("Gallery API is tenant-scoped", ["where: { id: req.params.id, restaurantId }", "where: { restaurantId: restaurantIdFor(req) }"].every((snippet) => restaurantRoute.includes(snippet)));
assertCheck("Public website service only loads published gallery images", websiteService.includes("galleryImages: { where: { published: true }"));
assertCheck("Public route sanitizes unpublished gallery images", publicRoute.includes("image.published !== false"));
assertCheck("Frontend gallery upload includes title alt caption category publish", ["galleryForm.altText", "galleryForm.caption", "galleryForm.published", "Upload gallery photos"].every((snippet) => app.includes(snippet)));
assertCheck("Frontend gallery can hide and publish images", app.includes("Gallery photo hidden.") && app.includes("Gallery photo published."));
assertCheck("Public gallery renders captions", app.includes("image.caption ? ` / ${image.caption}`"));

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

const failed = checks.filter((check) => !check.ok);
console.log(`Gallery test: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);

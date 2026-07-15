import { readFileSync } from "node:fs";

const restaurantRoute = readFileSync("apps/api/src/routes/restaurant.js", "utf8");
const uploadsRoute = readFileSync("apps/api/src/routes/uploads.js", "utf8");
const publicRoutes = readFileSync("apps/api/src/routes/public.js", "utf8");
const websiteService = readFileSync("apps/api/src/services/websiteService.js", "utf8");
const app = readFileSync("apps/web/src/App.jsx", "utf8");

const checks = [];

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

assertCheck("Menu categories list is tenant-scoped", restaurantRoute.includes("prisma.menuCategory.findMany({ where: { restaurantId: restaurantIdFor(req) }"));
assertCheck("Menu category update is tenant-scoped", restaurantRoute.includes("where: { id_restaurantId: { id: req.params.categoryId, restaurantId } }"));
assertCheck("Menu item create validates tenant-owned category", restaurantRoute.includes("const category = await prisma.menuCategory.findUnique({ where: { id_restaurantId: { id: data.categoryId, restaurantId } }"));
assertCheck("Menu item update validates tenant-owned category", restaurantRoute.includes("if (data.categoryId)") && restaurantRoute.includes("Select a valid menu category for this restaurant."));
assertCheck("Menu item update is tenant-scoped", restaurantRoute.includes("where: { id_restaurantId: { id: req.params.itemId, restaurantId } }"));
assertCheck("Menu item delete is tenant-scoped", restaurantRoute.includes("prisma.menuItem.delete({ where: { id_restaurantId: { id: req.params.itemId, restaurantId } } })"));
assertCheck("Menu item image upload verifies tenant-owned item", uploadsRoute.includes("where: { id_restaurantId: { id: req.body.menuItemId, restaurantId: restaurant.id } }"));

assertCheck("Public menu endpoint exists for path-based restaurants", publicRoutes.includes("router.get(\"/restaurants/:slug/menu\", sendMenu);"));
assertCheck("Public menu endpoint rejects unpublished websites", publicRoutes.includes("if (!bundle || bundle.website.websiteEnabled === false) return res.status(404).json({ error: \"Menu not found\" });"));
assertCheck("Public bundle filters menu items by tenant", websiteService.includes("filter((item) => item.restaurantId === restaurantId)"));

assertCheck("Frontend validates new menu image before create", app.includes("const imageValidationError = newItemImage ? validateImageFile(newItemImage"));
assertCheck("Frontend uploads new item image after item creation", app.includes("await uploadRestaurantImage(\"menu-item\", newItemImage, { menuItemId: created.item.id"));
assertCheck("Frontend can replace existing item image", app.includes("uploadMenuItemImage(item, event)"));
assertCheck("Frontend can remove existing item image", app.includes("updateItem(item, { imageUrl: null }, \"Menu item image removed.\")"));
assertCheck("Frontend shows image requirements", app.includes("Square food photo recommended. JPG, PNG, or WEBP up to 5MB."));

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

const failed = checks.filter((check) => !check.ok);
console.log(`Menu test: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);

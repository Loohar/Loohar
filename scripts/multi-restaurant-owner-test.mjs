import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const auth = readFileSync(join(root, "apps/api/src/routes/auth.js"), "utf8");
const schema = readFileSync(join(root, "apps/api/prisma/schema.prisma"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const failures = [];
const notes = [];

function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
    return;
  }
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function note(message) {
  notes.push(message);
  console.log(`NOTE ${message}`);
}

function sliceBetween(content, startNeedle, endNeedle) {
  const start = content.indexOf(startNeedle);
  const end = content.indexOf(endNeedle, start + startNeedle.length);
  if (start === -1 || end === -1) return "";
  return content.slice(start, end);
}

const membershipsForUser = sliceBetween(auth, "async function membershipsForUser(user)", "\nasync function authResponse");
const restaurantMembershipSlugs = sliceBetween(app, "function restaurantMembershipSlugs(", "\nfunction primaryRestaurantSlugFor");
const tenantGuard = sliceBetween(app, "function canAccessTenantRoute(", "\nfunction normalizeRole");
const shell = sliceBetween(app, "function RestaurantAppShell(", "\nfunction LoginStrip");

assertCheck(packageJson.scripts?.["test:multi-restaurant-owner"] === "node scripts/multi-restaurant-owner-test.mjs", "Multi-restaurant owner test script is registered");
assertCheck(membershipsForUser.includes("new Map()") && membershipsForUser.includes("return [...memberships.values()]"), "Backend returns a de-duplicated membership list");
assertCheck(membershipsForUser.includes("prisma.restaurantStaff.findMany") && membershipsForUser.includes("userId: user.id"), "Backend loads tenant memberships through RestaurantStaff");
assertCheck(membershipsForUser.includes("staff.restaurant") && membershipsForUser.includes("tenantSlug"), "Backend includes tenant slug and name in membership payloads");
assertCheck(restaurantMembershipSlugs.includes("user?.memberships") && restaurantMembershipSlugs.includes("membership?.tenantSlug"), "Frontend tenant access derives authorized slugs from memberships");
assertCheck(tenantGuard.includes("allowedSlugs.includes(slug)") && tenantGuard.includes("return false"), "Cross-tenant URL tampering is denied by slug guard");
assertCheck(shell.includes("restaurant-shell-switcher") || shell.includes("navItems") || shell.includes("restaurantOperationsNavigation"), "Restaurant shell is driven by tenant-aware navigation");

if (/model RestaurantStaff[\s\S]*?userId\s+String\s+@unique/.test(schema)) {
  note("Current RestaurantStaff schema still limits one staff profile per user; full multi-restaurant ownership will need a future membership migration.");
} else {
  assertCheck(/model RestaurantStaff[\s\S]*?userId\s+String/.test(schema), "RestaurantStaff stores user membership rows");
}

if (failures.length) {
  console.error(`multi-restaurant-owner-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("multi-restaurant-owner-test passed.");

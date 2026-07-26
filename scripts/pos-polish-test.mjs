import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "all";
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");
const server = readFileSync(join(root, "apps/api/src/server.js"), "utf8");
const posRoutes = readFileSync(join(root, "apps/api/src/routes/pos.js"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const failures = [];

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function assertCheck(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

const polishScripts = [
  "test:pos-layout",
  "test:pos-menu-search",
  "test:pos-categories",
  "test:pos-status-strip",
  "test:pos-mobile-cart",
  "test:pos-kiosk-shell",
  "test:pos-kiosk-lock",
  "test:pos-rate-limit",
  "test:pos-empty-states"
];

assertCheck(polishScripts.every((scriptName) => packageJson.scripts?.[scriptName]?.includes("pos-polish-test.mjs")), "POS polish test scripts are registered");

if (mode === "all" || mode === "layout") {
  assertCheck(includesAll(styles, [
    ".pos-command-bar",
    ".pos-status-strip",
    "lg:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.85fr)]",
    ".pos-cart",
    "position: sticky",
    ".pos-cart-body",
    ".pos-cart-footer"
  ]), "POS layout uses compact command bar, status strip, two-pane register, sticky desktop cart, and internal cart scrolling");
  assertCheck(!styles.includes("xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.42fr)]"), "POS layout no longer uses the old dashboard-like cart grid");
}

if (mode === "all" || mode === "menu-search") {
  assertCheck(includesAll(app, [
    "searchQuery",
    "setSearchQuery",
    "Search items...",
    "Search POS menu items",
    "event.key === \"Escape\"",
    "item.sku",
    "item.searchAliases"
  ]), "POS menu has local search with clear and Escape behavior");
  assertCheck(includesAll(styles, [
    ".pos-menu-toolbar",
    "lg:grid-cols-[auto_minmax(220px,1fr)_220px]",
    ".pos-menu-search",
    ".pos-category-select"
  ]), "Menu heading, search, and category selector are aligned for desktop/tablet");
}

if (mode === "all" || mode === "categories") {
  assertCheck(includesAll(app, [
    "pos-category-pills",
    "pos-category-pill",
    "aria-pressed={selectedCategory === \"all\"}",
    "aria-pressed={selectedCategory === category.id}"
  ]), "POS category pills expose active state accessibly");
  assertCheck(includesAll(styles, [
    ".pos-category-pills",
    "flex-wrap",
    ".pos-category-pill.active"
  ]), "Category controls wrap naturally and visually distinguish the active category");
}

if (mode === "all" || mode === "status-strip") {
  assertCheck(includesAll(app, [
    "statusChips",
    "pos-status-strip",
    "Device",
    "Shift",
    "Cart",
    "Kiosk"
  ]), "POS status strip replaces oversized status cards");
  assertCheck(includesAll(styles, [
    ".pos-status-strip",
    ".pos-status-chip",
    ".pos-status-chip.good",
    ".pos-status-chip.warn"
  ]), "Status strip has concise readable state styles");
}

if (mode === "all" || mode === "mobile-cart") {
  assertCheck(includesAll(app, [
    "mobileCartOpen",
    "setMobileCartOpen(true)",
    "pos-mobile-cart-summary",
    "pos-mobile-close"
  ]), "Mobile POS cart opens from sticky summary and has a close action");
  assertCheck(includesAll(styles, [
    "@media (max-width: 1023px)",
    ".pos-cart.open",
    "translateY(110%)",
    ".pos-mobile-cart-summary"
  ]), "Mobile cart renders as a bottom drawer without taking over desktop layout");
}

if (mode === "all" || mode === "kiosk-shell") {
  assertCheck(includesAll(app, [
    "function RestaurantKioskShell",
    "pos-kiosk-shell",
    "restaurantPage === \"kiosk\"",
    "restaurantStaffRoles",
    "kioskOnly",
    "const ownerOperator = posCanManageSubscription(user)",
    "Owner POS"
  ]), "Dedicated kiosk route renders a separate full-screen shell with owner-only escape navigation");
  assertCheck(includesAll(styles, [
    ".pos-kiosk-shell",
    "100dvh",
    ".pos-kiosk-topbar",
    ".pos-kiosk-main"
  ]), "Kiosk shell has full-screen responsive styling");
}

if (mode === "all" || mode === "kiosk-lock") {
  assertCheck(includesAll(app, [
    "showKioskExit",
    "Manager exit",
    "Manager PIN",
    "Exit kiosk mode",
    "Return to register",
    "setKiosk(false)"
  ]), "Kiosk exit requires explicit manager flow instead of blocking the register on load");
  assertCheck(includesAll(posRoutes, [
    "kioskExitLimiter",
    "Too many kiosk exit attempts",
    "\"RATE_LIMITED\""
  ]), "Kiosk exit attempts remain rate limited server-side");
}

if (mode === "all" || mode === "rate-limit") {
  assertCheck(includesAll(app, [
    "inflightLoadRef",
    "loadedOnceRef",
    "Promise.all",
    "POS is receiving too many requests",
    "Retry POS"
  ]), "Frontend deduplicates initial POS reads and shows friendly 429 messaging");
  assertCheck(!app.includes("Request failed with 429"), "Raw 429 text is not rendered by the POS UI");
  assertCheck(includesAll(server, [
    "posSafeReadPathPattern",
    "skip: (req) => req.method === \"GET\"",
    "\"RATE_LIMITED\""
  ]) && includesAll(posRoutes, [
    "posReadLimiter",
    "limit: 240",
    "kioskExitLimiter"
  ]), "Safe POS reads are separated from sensitive mutation and PIN limits");
}

if (mode === "all" || mode === "empty-states") {
  assertCheck(includesAll(app, [
    "lastSuccessfulCategories",
    "POS_MENU_STATUS.STALE",
    "Showing the last synced POS menu",
    "No matching POS items",
    "No POS menu items",
    "POS menu items are not available. Contact your manager.",
    "Add available menu items in Menu & Catalog"
  ]), "POS empty states are polished and role-aware, with stale live menu preservation");
  assertCheck(includesAll(app, [
    "is not included in the current plan.",
    "POS is not enabled for this restaurant.",
    "Contact your manager before using this register.",
    "Review Subscription"
  ]), "Entitlement errors use role-aware upgrade or manager-contact messaging");
}

if (failures.length) {
  console.error(`pos-polish-test (${mode}) failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log(`pos-polish-test (${mode}) passed.`);

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const failures = [];

function assertCheck(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
    return;
  }
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function sliceBetween(content, startNeedle, endNeedle) {
  const start = content.indexOf(startNeedle);
  const end = content.indexOf(endNeedle, start + startNeedle.length);
  if (start === -1 || end === -1) return "";
  return content.slice(start, end);
}

const publicNavbar = sliceBetween(app, "function PublicNavbar(", "\nfunction PublicFooter");
const appHeader = sliceBetween(app, "function AppHeader(", "\nfunction LoginStrip");
const tenantSiteHeader = sliceBetween(app, '<header className="site-header premium">', "\n      </header>");
const brandMark = sliceBetween(app, "function BrandMark(", "\nconst publicProductLinks");

assertCheck(packageJson.scripts?.["test:mobile-nav"] === "node scripts/mobile-nav-test.mjs", "Mobile nav test script is registered");
assertCheck(app.includes("function focusableElements(") && app.includes("function trapFocus(") && app.includes("focusableSelector"), "Shared focus-trap helpers exist");
assertCheck(brandMark.includes("<LooharBrand compact={compact} variant=\"authenticated\" />") && !brandMark.includes("app-brand-icon"), "Authenticated brand uses LooharBrand instead of the shield placeholder");
assertCheck(publicNavbar.includes("mobileTriggerRef") && publicNavbar.includes("previousMobileFocusRef"), "Public drawer stores trigger focus for restoration");
assertCheck(publicNavbar.includes('aria-label="Open navigation menu"') && publicNavbar.includes('aria-expanded={mobileOpen}') && publicNavbar.includes('aria-controls="public-mobile-menu"'), "Public hamburger has accessible label and state");
assertCheck(publicNavbar.includes('role="dialog"') && publicNavbar.includes('aria-modal="true"') && publicNavbar.includes("onKeyDown={handleMobileDrawerKeyDown}"), "Public drawer exposes modal dialog semantics and keyboard focus trapping");
assertCheck(publicNavbar.includes('<PublicLink href="/" onNavigate={closeNavigation}>Home</PublicLink>'), "Public mobile drawer includes Home");
assertCheck(publicNavbar.includes("publicProductLinks") && publicNavbar.includes("publicResourceLinks"), "Public mobile drawer reuses Product and Resources link groups");
assertCheck(publicNavbar.includes("document.body.style.overflow") && publicNavbar.includes("restoreTarget?.focus()"), "Public drawer locks scroll and restores focus after closing");
assertCheck(!publicNavbar.includes("<span>Menu</span>"), "Public mobile trigger is icon-only");
assertCheck(appHeader.includes("menuTriggerRef") && appHeader.includes("previousMenuFocusRef"), "Authenticated drawer stores trigger focus for restoration");
assertCheck(appHeader.includes('aria-label="Open dashboard navigation"') && appHeader.includes('aria-controls="app-mobile-menu"') && appHeader.includes('aria-expanded={menuOpen}'), "Authenticated hamburger has accessible label and state");
assertCheck(appHeader.includes('role="dialog"') && appHeader.includes('aria-modal="true"') && appHeader.includes("onKeyDown={handleMenuDrawerKeyDown}"), "Authenticated drawer exposes modal dialog semantics and keyboard focus trapping");
assertCheck(appHeader.includes("navItems.map") && appHeader.includes("mobile-${label}-${href}"), "Authenticated mobile drawer remains role-specific through existing nav items");
assertCheck(appHeader.includes("document.body.style.overflow") && appHeader.includes("restoreTarget?.focus()"), "Authenticated drawer locks scroll and restores focus");
assertCheck(tenantSiteHeader.includes('aria-controls="tenant-site-navigation"') && tenantSiteHeader.includes('aria-expanded={menuOpen}') && tenantSiteHeader.includes("<MenuIcon"), "Tenant public header has an accessible icon menu control");
assertCheck(styles.includes("width: min(84vw, 360px)") && styles.includes("height: 100dvh"), "Mobile drawers use bounded viewport sizing");
assertCheck(styles.includes("env(safe-area-inset-top)") && styles.includes("env(safe-area-inset-bottom)"), "Mobile drawers account for Apple safe areas");
assertCheck(styles.includes("transform: translateX(100%)") && styles.includes("transform: translateX(0)"), "Mobile drawers use right-side slide animation");
assertCheck(styles.includes(".app-mobile-layer") && styles.includes(".public-mobile-layer.open"), "Public and authenticated mobile drawer layers are styled");
assertCheck(styles.includes("@media (max-width: 1180px)") && styles.includes("display: inline-grid"), "Public navbar collapses before desktop content wraps");

if (failures.length) {
  console.error(`mobile-nav-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("mobile-nav-test passed.");

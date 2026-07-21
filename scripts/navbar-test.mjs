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
const publicDropdown = sliceBetween(app, "function PublicDropdown(", "\nfunction PublicNavbar");
const publicFooter = sliceBetween(app, "function PublicFooter(", "\nfunction PublicLayout");
const publicLayout = sliceBetween(app, "function PublicLayout(", "\nfunction AppHeader");
const looharPlatformBrand = sliceBetween(app, "function LooharPlatformBrand(", "\nconst focusableSelector");
const hasLegacyLogoSizeRule = /(^|\n)\s*(width:\s*2\.125rem|height:\s*2\.5rem|font-size:\s*1\.48rem);/.test(styles);

assertCheck(app.match(/function PublicNavbar\(/g)?.length === 1, "One global PublicNavbar component exists");
assertCheck(app.match(/function PublicFooter\(/g)?.length === 1, "One global PublicFooter component exists");
assertCheck(app.includes("function LooharPlatformBrand(") && app.includes("/marketing/loohar-mark.svg") && !app.includes("function LooharBrand("), "Public brand uses the approved LooharPlatformBrand component and L mark");
assertCheck(looharPlatformBrand.includes('size = "default"') && looharPlatformBrand.includes('variant = "full"') && looharPlatformBrand.includes('theme = "light"') && looharPlatformBrand.includes('href = "/"'), "LooharPlatformBrand exposes one shared size, variant, theme, and href API");
assertCheck(publicNavbar.includes('<LooharPlatformBrand size="default" />'), "Public navbar uses the shared default platform brand");
assertCheck(publicFooter.includes('<LooharPlatformBrand size="compact" />'), "Public footer uses the shared compact Loohar platform brand");
assertCheck(styles.includes("--loohar-platform-mark-compact: 25px;") && styles.includes("--loohar-platform-mark-default: 28px;") && styles.includes("--loohar-platform-wordmark-compact: 18px;") && styles.includes("--loohar-platform-wordmark-default: 20px;"), "Logo dimensions are controlled by shared platform-brand tokens");
assertCheck(!app.includes("function BrandMark(") && !looharPlatformBrand.includes('width={compact ?') && !hasLegacyLogoSizeRule, "Legacy BrandMark and arbitrary compact/oversized logo dimensions were removed");
assertCheck(publicNavbar.includes("publicProductLinks") && publicNavbar.includes("publicResourceLinks"), "Navbar uses centralized Product and Resources link groups");
assertCheck(publicNavbar.includes("PublicDropdown") && publicDropdown.includes("ChevronDown"), "Desktop dropdowns use a standard chevron affordance");
assertCheck(publicDropdown.includes('aria-haspopup="menu"') && publicDropdown.includes('role="menu"') && publicDropdown.includes('role="menuitem"'), "Dropdowns expose accessible menu semantics");
assertCheck(publicDropdown.includes("ArrowDown") && publicDropdown.includes("ArrowUp") && publicDropdown.includes("Escape"), "Dropdown keyboard navigation supports arrows and Escape");
assertCheck(publicNavbar.includes("pointerdown") && publicNavbar.includes("handleOutsideClick"), "Dropdowns close on outside pointer interaction");
assertCheck(publicNavbar.includes("loohar:navigate") && publicNavbar.includes("closeNavigation"), "Navbar closes menus on SPA route changes");
assertCheck(publicNavbar.includes('aria-controls="public-mobile-menu"') && publicNavbar.includes("public-mobile-drawer"), "Mobile drawer has a stable accessible target");
assertCheck(publicNavbar.includes("mobileCloseRef.current?.focus()") && publicNavbar.includes("document.body.style.overflow"), "Mobile drawer manages focus and body scroll");
assertCheck(publicLayout.includes("<PublicNavbar") && publicLayout.includes("<PublicFooter"), "PublicLayout owns the shared public header and footer");
assertCheck(styles.includes(".public-navbar-grid") && styles.includes(".public-dropdown-panel") && styles.includes(".public-mobile-drawer"), "Navbar styles are present for desktop dropdowns and mobile drawer");
assertCheck(styles.includes(".public-dropdown.open .public-dropdown-panel") && styles.includes("transform: translateY(0)"), "Open dropdown state is visually defined");
assertCheck(!app.includes("marketing-mobile-nav") && !styles.includes("marketing-mobile-nav"), "Old homepage-only mobile nav was removed");
assertCheck(!app.includes("marketing-menu-button") && !styles.includes("marketing-menu-button"), "Old homepage-only menu button was removed");
assertCheck(packageJson.scripts?.["test:navbar"] === "node scripts/navbar-test.mjs", "Navbar test script is registered");

if (failures.length) {
  console.error(`navbar-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("navbar-test passed.");

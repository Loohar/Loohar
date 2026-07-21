import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const logoPath = join(root, "apps/web/public/marketing/loohar-mark.svg");
const faviconPath = join(root, "apps/web/public/favicon/favicon.svg");
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

const platformBrand = sliceBetween(app, "function LooharPlatformBrand(", "\nconst focusableSelector");
const publicNavbar = sliceBetween(app, "function PublicNavbar(", "\nfunction PublicFooter");
const publicFooter = sliceBetween(app, "function PublicFooter(", "\nfunction PublicLayout");
const appHeader = sliceBetween(app, "function AppHeader(", "\nfunction LoginStrip");
const authPage = sliceBetween(app, "function AuthPage(", "\nfunction ForgotPasswordPage");
const tenantSiteHeader = sliceBetween(app, '<header className="site-header premium">', "\n      </header>");
const websiteBuilder = sliceBetween(app, "function RestaurantApp(", "\nfunction KitchenApp");

assertCheck(packageJson.scripts?.["test:platform-brand"] === "node scripts/platform-brand-test.mjs", "Platform brand test script is registered");
assertCheck(app.match(/function LooharPlatformBrand\(/g)?.length === 1, "One authoritative LooharPlatformBrand component exists");
assertCheck(!app.includes("function LooharBrand(") && !app.includes("function BrandMark("), "Legacy platform logo wrapper components are removed");
assertCheck(platformBrand.includes('size = "default"') && platformBrand.includes('variant = "full"') && platformBrand.includes('theme = "light"') && platformBrand.includes('href = "/"'), "LooharPlatformBrand exposes the approved default props");
assertCheck(platformBrand.includes("/marketing/loohar-mark.svg") && !platformBrand.includes("<Shield") && !platformBrand.includes("app-brand-icon"), "Platform brand uses the approved L asset instead of the old shield placeholder");
assertCheck(app.includes("compact: { width: 25, height: 30 }") && app.includes("default: { width: 28, height: 34 }") && app.includes("large: { width: 34, height: 41 }"), "Component dimensions match approved compact, default, and large sizes");
assertCheck(styles.includes("--loohar-platform-mark-compact: 25px;") && styles.includes("--loohar-platform-mark-default: 28px;") && styles.includes("--loohar-platform-mark-large: 34px;"), "Platform mark tokens are defined");
assertCheck(styles.includes("--loohar-platform-wordmark-compact: 18px;") && styles.includes("--loohar-platform-wordmark-default: 20px;") && styles.includes("--loohar-platform-wordmark-large: 24px;"), "Platform wordmark tokens are defined");
assertCheck(styles.includes("--loohar-platform-brand-gap: 8px;") && styles.includes("--loohar-platform-wordmark-weight: 700;") && styles.includes("--loohar-platform-brand-line-height: 1;"), "Platform gap, weight, and line-height tokens are defined");
assertCheck(publicNavbar.includes('<LooharPlatformBrand size="default" />'), "Public navbar uses the default platform brand size");
assertCheck(publicFooter.includes('<LooharPlatformBrand size="compact" />'), "Public footer uses the compact platform brand size");
assertCheck(appHeader.includes('<LooharPlatformBrand size="default" />') && appHeader.includes('<LooharPlatformBrand size="compact" />'), "Authenticated shell uses default desktop and compact mobile platform brand sizes");
assertCheck(authPage.includes("<PublicLayout compactNav"), "Login routes continue to use the shared auth layout");
assertCheck(tenantSiteHeader.includes("logoImage") && tenantSiteHeader.includes("restaurant.name") && !tenantSiteHeader.includes("LooharPlatformBrand"), "Restaurant public site navbar keeps tenant logo data");
assertCheck(websiteBuilder.includes("restaurant-logo") && websiteBuilder.includes("logoUrl") && websiteBuilder.includes("Upload logo"), "Restaurant owner logo upload controls remain present");
assertCheck(existsSync(logoPath) && readFileSync(logoPath, "utf8").includes('width="28"') && readFileSync(logoPath, "utf8").includes('height="34"'), "Approved platform logo SVG remains available");
assertCheck(existsSync(faviconPath) && !styles.includes("favicon") && !platformBrand.includes("favicon"), "Favicon asset stays separate from navbar brand sizing");

if (failures.length) {
  console.error(`platform-brand-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("platform-brand-test passed.");

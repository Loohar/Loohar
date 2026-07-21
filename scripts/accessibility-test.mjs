import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles/index.css"), "utf8");
const indexHtml = readFileSync(join(root, "apps/web/index.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "apps/web/public/manifest.json"), "utf8"));
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
const appHeader = sliceBetween(app, "function AppHeader(", "\nfunction LoginStrip");
const faviconDir = join(root, "apps/web/public/favicon");
const faviconAssets = [
  "favicon.ico",
  "favicon.svg",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon-48x48.png",
  "apple-touch-icon.png",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "maskable-icon-512x512.png"
];

assertCheck(packageJson.scripts?.["test:accessibility"] === "node scripts/accessibility-test.mjs", "Accessibility test script is registered");
assertCheck(indexHtml.includes('href="/favicon/favicon.ico?v=2026-07-nav"') && indexHtml.includes('href="/favicon/favicon.svg?v=2026-07-nav"'), "HTML references versioned favicon assets");
assertCheck(indexHtml.includes('sizes="16x16"') && indexHtml.includes('sizes="32x32"') && indexHtml.includes('sizes="48x48"') && indexHtml.includes('apple-touch-icon'), "HTML declares standard favicon and Apple touch sizes");
assertCheck(faviconAssets.every((asset) => existsSync(join(faviconDir, asset))), "All required favicon assets exist");
assertCheck(manifest.name === "Loohar" && manifest.short_name === "Loohar" && manifest.start_url === "/", "Manifest uses tenant-independent Loohar app identity");
assertCheck(manifest.icons?.some((icon) => icon.src.includes("android-chrome-192x192.png") && icon.sizes === "192x192"), "Manifest references 192px PNG icon");
assertCheck(manifest.icons?.some((icon) => icon.src.includes("android-chrome-512x512.png") && icon.sizes === "512x512"), "Manifest references 512px PNG icon");
assertCheck(manifest.icons?.some((icon) => icon.src.includes("maskable-icon-512x512.png") && icon.purpose === "maskable"), "Manifest references maskable icon");
assertCheck(publicDropdown.includes('aria-haspopup="menu"') && publicDropdown.includes('role="menu"') && publicDropdown.includes('role="menuitem"'), "Desktop dropdowns expose accessible menu semantics");
assertCheck(publicDropdown.includes("ArrowDown") && publicDropdown.includes("ArrowUp") && publicDropdown.includes("Escape"), "Desktop dropdowns support keyboard navigation");
assertCheck(publicNavbar.includes('aria-label="Open navigation menu"') && publicNavbar.includes('aria-modal="true"') && publicNavbar.includes("trapFocus"), "Public drawer has accessible controls and focus trap");
assertCheck(appHeader.includes('aria-label="Open dashboard navigation"') && appHeader.includes('aria-modal="true"') && appHeader.includes("trapFocus"), "Authenticated drawer has accessible controls and focus trap");
assertCheck(styles.includes(":focus-visible") && styles.includes("focus:ring-2") && styles.includes("box-shadow: 0 0 0 3px"), "Navigation controls retain visible focus indicators");
assertCheck(styles.includes("@media (prefers-reduced-motion: reduce)") && styles.includes(".public-mobile-drawer") && styles.includes(".app-mobile-drawer"), "Reduced-motion mode disables drawer transitions");
assertCheck(styles.includes("scroll-margin-top") && styles.includes("--public-nav-height"), "Sticky navbar leaves room for anchored sections");
assertCheck(!/letter-spacing\s*:\s*-[^;]+/.test(styles), "Navigation CSS does not use negative letter spacing");
assertCheck(!/font-size\s*:\s*clamp\([^;]*(vw|vh)/i.test(styles), "Navigation CSS does not scale type directly with viewport width");

if (failures.length) {
  console.error(`accessibility-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("accessibility-test passed.");

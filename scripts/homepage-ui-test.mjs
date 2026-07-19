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

const publicHome = sliceBetween(app, "function PublicHome(", "\nfunction PricingPage");

assertCheck(styles.includes(".marketing-header-inner") && styles.includes("display: flex") && styles.includes("justify-content: space-between"), "Desktop marketing header uses flex layout");
assertCheck(styles.includes(".marketing-nav") && styles.includes(".marketing-actions"), "Desktop nav and action groups have dedicated layout rules");
assertCheck(styles.includes(".marketing-menu-button") && styles.includes(".marketing-mobile-nav.open"), "Mobile menu button and drawer are styled");
assertCheck(styles.includes("@media (max-width: 767px)") && styles.includes(".marketing-nav,\n    .marketing-actions") && styles.includes("display: none"), "Mobile breakpoint hides desktop nav/actions");
assertCheck(styles.includes("min-height: 2.75rem") && styles.includes(".marketing-button.large") && styles.includes("min-height: 3.35rem"), "Marketing controls meet 44px touch target baseline");
assertCheck(styles.includes("grid-template-columns: repeat(3, minmax(0, 1fr))") && styles.includes("grid-template-columns: 1fr"), "Feature grid has desktop and mobile layouts");
assertCheck(styles.includes("overflow: hidden") && styles.includes("object-fit: cover"), "Hero image is framed predictably");
assertCheck(!/letter-spacing\s*:\s*-[^;]+/.test(styles), "Marketing CSS does not use negative letter spacing");
assertCheck(!/font-size\s*:\s*clamp\([^;]*(vw|vh)/i.test(styles), "Marketing CSS does not scale font size directly with viewport width");
assertCheck(publicHome.includes('aria-expanded={mobileMenuOpen}') && publicHome.includes('aria-controls="marketing-mobile-nav"'), "Mobile menu is announced to assistive technology");
assertCheck(publicHome.includes('aria-label="Primary"') && publicHome.includes('aria-label="Mobile primary"'), "Homepage has labelled navigation landmarks");
assertCheck(publicHome.includes('fetchPriority="high"') && publicHome.includes('alt="Premium restaurant interior'), "Hero image has priority loading and meaningful alt text");
assertCheck(!publicHome.includes("dangerouslySetInnerHTML"), "Homepage does not inject raw HTML");
assertCheck(packageJson.scripts?.["test:homepage-ui"] === "node scripts/homepage-ui-test.mjs", "Homepage UI test script is registered");

if (failures.length) {
  console.error(`homepage-ui-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("homepage-ui-test passed.");

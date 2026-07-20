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
const publicHome = sliceBetween(app, "function PublicHome(", "\nfunction FeatureHero");
const featureRoutes = [
  "/features/restaurant-website",
  "/features/direct-online-ordering",
  "/features/delivery-management",
  "/features/loyalty-marketing",
  "/features/analytics-reports",
  "/features/operations-tools"
];

assertCheck(styles.includes(".public-navbar-grid") && styles.includes("display: grid") && styles.includes("grid-template-columns: auto minmax(0, 1fr) auto"), "Desktop public navbar uses one horizontal grid row");
assertCheck(styles.includes(".public-nav-center") && styles.includes(".public-nav-actions") && styles.includes("justify-content: center"), "Public nav and action groups have dedicated desktop layout rules");
assertCheck(styles.includes(".public-mobile-trigger") && styles.includes(".public-mobile-layer.open") && styles.includes(".public-mobile-drawer"), "Mobile menu trigger and drawer are styled");
assertCheck(styles.includes("@media (max-width: 1180px)") && styles.includes(".public-nav-center,\n    .public-nav-actions") && styles.includes("display: none"), "Responsive breakpoint hides desktop nav/actions only on smaller screens");
assertCheck(styles.includes("min-height: 2.75rem") && styles.includes(".public-button.large") && styles.includes("min-height: 3.2rem"), "Public buttons meet 44px touch target baseline");
assertCheck(styles.includes("grid-template-columns: repeat(3, minmax(0, 1fr))") && styles.includes("grid-template-columns: 1fr"), "Feature grid has desktop and mobile layouts");
assertCheck(/\.marketing-hero\s*\{[\s\S]*?width:\s*100%;[\s\S]*?overflow:\s*hidden;/.test(styles), "Homepage hero outer section spans the viewport width");
assertCheck(/\.marketing-hero-content\s*\{[\s\S]*?padding:\s*5rem 0 4rem;/.test(styles), "Hero content is aligned by the shared public container");
assertCheck(styles.includes("overflow: hidden") && styles.includes("object-fit: cover"), "Hero image is framed predictably");
assertCheck(!/letter-spacing\s*:\s*-[^;]+/.test(styles), "Public CSS does not use negative letter spacing");
assertCheck(!/font-size\s*:\s*clamp\([^;]*(vw|vh)/i.test(styles), "Public CSS does not scale font size directly with viewport width");
assertCheck(styles.includes("--font-family-public") && styles.includes("--font-size-hero") && styles.includes("--font-weight-semibold"), "Public typography uses shared design tokens");
assertCheck(publicNavbar.includes("PublicDropdown") && publicDropdown.includes("ChevronDown") && publicDropdown.includes('aria-haspopup="menu"'), "Desktop Product and Resources dropdowns are accessible menu buttons");
assertCheck(publicNavbar.includes('aria-expanded={mobileOpen}') && publicNavbar.includes('aria-controls="public-mobile-menu"'), "Mobile menu is announced to assistive technology");
assertCheck(publicNavbar.includes("pointerdown") && publicNavbar.includes("Escape") && publicNavbar.includes("loohar:navigate"), "Public navbar closes on outside click, Escape, and route changes");
assertCheck(publicNavbar.includes("document.body.style.overflow") && publicNavbar.includes("mobileCloseRef.current?.focus()"), "Mobile drawer manages page scroll and initial focus");
assertCheck(app.includes("Restaurant websites") && app.includes("Restaurant onboarding"), "Public dropdowns include product and resource destinations");
assertCheck(publicHome.includes('fetchPriority="high"') && publicHome.includes('alt="Premium restaurant interior'), "Hero image has priority loading and meaningful alt text");
assertCheck(featureRoutes.every((route) => app.includes(`href: "${route}"`)), "All six homepage feature cards have dedicated feature-page routes");
assertCheck(publicHome.includes("marketing-feature-link-card") && publicHome.includes("href={href}") && publicHome.includes("marketing-card-learn-more"), "Homepage feature cards click through to matching detail pages");
const featureGrid = sliceBetween(publicHome, '<section className="marketing-feature-grid"', "\n        </section>");
assertCheck(!featureGrid.includes('href="/pricing"') && featureGrid.includes("href={href}"), "Homepage feature cards do not route directly to pricing");
assertCheck(!publicHome.includes("<BrandMark") && app.includes("function LooharBrand("), "Homepage no longer uses the old shield brand mark");
assertCheck(!publicHome.includes("dangerouslySetInnerHTML"), "Homepage does not inject raw HTML");
assertCheck(packageJson.scripts?.["test:homepage-ui"] === "node scripts/homepage-ui-test.mjs", "Homepage UI test script is registered");

if (failures.length) {
  console.error(`homepage-ui-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("homepage-ui-test passed.");

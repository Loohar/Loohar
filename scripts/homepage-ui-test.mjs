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
assertCheck(/\.marketing-hero\s*\{[\s\S]*?min-height:\s*40rem;/.test(styles) && /@media \(max-width: 1180px\)[\s\S]*?\.marketing-hero\s*\{[\s\S]*?min-height:\s*38rem;/.test(styles), "Hero height stays within the approved desktop and laptop range");
assertCheck(/\.marketing-hero-content\s*\{[\s\S]*?max-width:\s*80rem;[\s\S]*?padding:\s*4\.5rem clamp\(2rem, 4vw, 4\.5rem\) 3\.75rem clamp\(3rem, 7vw, 8\.5rem\);[\s\S]*?text-align:\s*left;/.test(styles), "Hero content uses a controlled desktop width, responsive left inset, and left alignment");
assertCheck(styles.includes(".marketing-hero-copy") && styles.includes("max-width: 38.75rem"), "Hero copy is constrained so text does not stretch across the image");
assertCheck(styles.includes("--font-size-hero: 3rem;") && styles.includes("font-size: 2.75rem;") && styles.includes("font-size: 2.45rem;"), "Hero heading uses approved desktop, tablet, and mobile scale");
assertCheck(styles.includes("font-size: 1.03rem;") && styles.includes("font-size: 0.96rem;"), "Hero supporting text is smaller and responsive");
assertCheck(/\.marketing-hero-actions \.public-button\s*\{[\s\S]*?min-height:\s*3\.05rem;[\s\S]*?font-size:\s*0\.96rem;/.test(styles), "Hero CTA buttons keep the approved compact scale");
assertCheck(/\.marketing-hero-badges\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*max-content max-content minmax\(20rem, 1fr\);/.test(styles), "Hero trust badges use a desktop grid that keeps the third badge on the first row");
assertCheck(/\.marketing-hero-badges span\s*\{[\s\S]*?min-height:\s*3\.25rem;[\s\S]*?font-size:\s*0\.84rem;[\s\S]*?white-space:\s*nowrap;/.test(styles), "Hero trust badges keep compact typography, equal height, and no desktop text wrapping");
assertCheck(/\.marketing-hero-badges span:nth-child\(3\)\s*\{[\s\S]*?min-width:\s*20rem;/.test(styles), "The third hero trust badge is allowed to grow wider than the compact badges");
assertCheck(/@media \(max-width: 767px\)[\s\S]*?\.marketing-hero-badges\s*\{[\s\S]*?grid-template-columns:\s*1fr;/.test(styles), "Mobile hero trust badges stack cleanly in a single column");
assertCheck(styles.includes("padding: 3.5rem 1.25rem 2.8rem;"), "Mobile hero content uses reduced padding instead of the desktop inset");
assertCheck(styles.includes("overflow: hidden") && styles.includes("object-fit: cover"), "Hero image is framed predictably");
assertCheck(!/letter-spacing\s*:\s*-[^;]+/.test(styles), "Public CSS does not use negative letter spacing");
assertCheck(!/font-size\s*:\s*clamp\([^;]*(vw|vh)/i.test(styles), "Public CSS does not scale font size directly with viewport width");
assertCheck(styles.includes("--font-family-public") && styles.includes("--font-size-hero") && styles.includes("--font-weight-semibold"), "Public typography uses shared design tokens");
assertCheck(publicNavbar.includes("PublicDropdown") && publicDropdown.includes("ChevronDown") && publicDropdown.includes('aria-haspopup="menu"'), "Desktop Product and Resources dropdowns are accessible menu buttons");
assertCheck(publicNavbar.includes('aria-expanded={mobileOpen}') && publicNavbar.includes('aria-controls="public-mobile-menu"'), "Mobile menu is announced to assistive technology");
assertCheck(publicNavbar.includes("pointerdown") && publicNavbar.includes("Escape") && publicNavbar.includes("loohar:navigate"), "Public navbar closes on outside click, Escape, and route changes");
assertCheck(publicNavbar.includes("document.body.style.overflow") && publicNavbar.includes("mobileCloseRef.current?.focus()"), "Mobile drawer manages page scroll and initial focus");
assertCheck(app.includes("Restaurant websites") && app.includes("Restaurant onboarding"), "Public dropdowns include product and resource destinations");
assertCheck(publicHome.includes('fetchpriority="high"') && publicHome.includes('alt="Premium restaurant interior'), "Hero image has priority loading and meaningful alt text");
assertCheck(publicHome.includes("No setup fees") && publicHome.includes("Launch in minutes") && publicHome.includes("Restaurant-owned customer relationships"), "Hero trust badges remain visible in the homepage markup");
assertCheck(featureRoutes.every((route) => app.includes(`href: "${route}"`)), "All six homepage feature cards have dedicated feature-page routes");
assertCheck(publicHome.includes("marketing-feature-link-card") && publicHome.includes("href={href}") && publicHome.includes("marketing-card-learn-more"), "Homepage feature cards click through to matching detail pages");
const featureGrid = sliceBetween(publicHome, '<section className="marketing-feature-grid"', "\n        </section>");
assertCheck(!featureGrid.includes('href="/pricing"') && featureGrid.includes("href={href}"), "Homepage feature cards do not route directly to pricing");
assertCheck(!publicHome.includes("<BrandMark") && app.includes("function LooharPlatformBrand("), "Homepage uses the shared LooharPlatformBrand instead of the old shield brand mark");
assertCheck(!publicHome.includes("dangerouslySetInnerHTML"), "Homepage does not inject raw HTML");
assertCheck(packageJson.scripts?.["test:homepage-ui"] === "node scripts/homepage-ui-test.mjs", "Homepage UI test script is registered");

if (failures.length) {
  console.error(`homepage-ui-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("homepage-ui-test passed.");

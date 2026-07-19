import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const indexHtml = readFileSync(join(root, "apps/web/index.html"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const heroPath = join(root, "apps/web/public/marketing/loohar-restaurant-hero.png");
const logoPath = join(root, "apps/web/public/marketing/loohar-mark.svg");
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
const homeSeo = sliceBetween(app, "function applyHomepageSeo(", "\nfunction applyPublicSeo");
const fakeMetricPatterns = [
  /500\+/,
  /50K\+/i,
  /1M\+/i,
  /\$30M\+/i,
  /99\.9\s*%/,
  /24\/7\s+support/i
];

assertCheck(publicHome.includes("Restaurant direct ordering platform"), "Homepage keeps the restaurant direct ordering positioning");
assertCheck(publicHome.includes("Restaurant websites, direct ordering, pickup, delivery, loyalty, and operations"), "Hero copy describes the restaurant SaaS product");
assertCheck(publicHome.includes('href="/register"') && publicHome.includes('href="/pricing"') && publicHome.includes('href="/login"'), "Homepage CTAs link to registration, pricing, and sign in routes");
assertCheck(["#product", "#features", "#pricing-overview", "#resources", "#about", "#security", "#how-it-works"].every((id) => publicHome.includes(id)), "Homepage includes all required navigation anchors");
assertCheck(["Restaurant Website", "Direct Online Ordering", "Delivery Management", "Loyalty and Marketing", "Analytics and Reports", "Operations Tools"].every((title) => publicHome.includes(title)), "Homepage renders the six required feature cards");
assertCheck(["Starter+", "Professional+", "Enterprise"].every((label) => publicHome.includes(label)), "Feature cards disclose plan availability");
assertCheck(publicHome.includes("Restaurant-owned ordering") && publicHome.includes("Direct customer relationships") && publicHome.includes("Multi-tenant operations"), "Trust strip uses non-numeric restaurant platform statements");
assertCheck(!fakeMetricPatterns.some((pattern) => pattern.test(publicHome)), "Homepage does not include fake scale metrics or unsupported 24/7 support claims");
assertCheck(!publicHome.includes("images.unsplash.com") && !app.includes("images.unsplash.com"), "Homepage and fallback images do not depend on external Unsplash hotlinks");
assertCheck(publicHome.includes("/marketing/loohar-restaurant-hero.png") && publicHome.includes('width="1792"') && publicHome.includes('height="1024"'), "Hero image is a committed asset with explicit dimensions");
assertCheck(publicHome.includes("/marketing/loohar-mark.svg"), "Homepage uses the provided Loohar logo asset");
assertCheck(existsSync(heroPath) && statSync(heroPath).size > 100_000, "Committed hero image asset exists");
assertCheck(existsSync(logoPath) && readFileSync(logoPath, "utf8").includes("<svg"), "Committed Loohar logo SVG exists");
assertCheck(homeSeo.includes("Loohar | Restaurant Websites, Direct Ordering and Delivery SaaS") && homeSeo.includes("https://loohar.com/"), "Runtime homepage SEO sets title and canonical URL");
assertCheck(indexHtml.includes("Loohar | Restaurant Websites, Direct Ordering and Delivery SaaS"), "Static HTML title is production-ready");
assertCheck(indexHtml.includes('<link rel="canonical" href="https://loohar.com/"'), "Static HTML includes canonical homepage URL");
assertCheck(indexHtml.includes('property="og:image"') && indexHtml.includes("/marketing/loohar-restaurant-hero.png"), "Static HTML includes homepage social image");
assertCheck(indexHtml.includes('"@type": "Organization"') && indexHtml.includes('"@type": "SoftwareApplication"') && indexHtml.includes('"@type": "WebSite"'), "Homepage includes Organization, SoftwareApplication, and WebSite schema");
assertCheck(packageJson.scripts?.["test:homepage"] === "node scripts/homepage-test.mjs", "Homepage static test script is registered");

if (failures.length) {
  console.error(`homepage-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("homepage-test passed.");

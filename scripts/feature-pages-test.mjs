import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_PLATFORM_SLUGS, validatePublicSlug } from "../apps/shared/reservedSlugs.js";

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

const featureRoutes = [
  {
    slug: "restaurant-website",
    href: "/features/restaurant-website",
    title: "Restaurant Website",
    seoTitle: "Restaurant Website Builder for Direct Ordering | Loohar"
  },
  {
    slug: "direct-online-ordering",
    href: "/features/direct-online-ordering",
    title: "Direct Online Ordering",
    seoTitle: "Direct Online Ordering for Restaurants | Loohar"
  },
  {
    slug: "delivery-management",
    href: "/features/delivery-management",
    title: "Delivery Management",
    seoTitle: "Restaurant Delivery Management Software | Loohar"
  },
  {
    slug: "loyalty-marketing",
    href: "/features/loyalty-marketing",
    title: "Loyalty and Marketing",
    seoTitle: "Restaurant Loyalty and Marketing Tools | Loohar"
  },
  {
    slug: "analytics-reports",
    href: "/features/analytics-reports",
    title: "Analytics and Reports",
    seoTitle: "Restaurant Analytics and Reports | Loohar"
  },
  {
    slug: "operations-tools",
    href: "/features/operations-tools",
    title: "Operations Tools",
    seoTitle: "Restaurant Operations Management Tools | Loohar"
  }
];

const featureData = sliceBetween(app, "const publicFeatureCards = [", "\nconst publicFeatureBySlug");
const featureDetailPage = sliceBetween(app, "function FeatureDetailPage(", "\nconst publicPageContent");
const appRouter = app.slice(app.indexOf("export default function App()"));

assertCheck(packageJson.scripts?.["test:feature-pages"] === "node scripts/feature-pages-test.mjs", "Feature page test script is registered");
assertCheck(RESERVED_PLATFORM_SLUGS.includes("features"), "Features is a reserved platform slug");
assertCheck(validatePublicSlug("features").ok === false, "Feature route slug cannot be claimed by a tenant");
assertCheck(featureRoutes.every((feature) => featureData.includes(`slug: "${feature.slug}"`) && featureData.includes(`href: "${feature.href}"`) && featureData.includes(`title: "${feature.title}"`)), "All six feature pages have complete feature definitions");
assertCheck(featureRoutes.every((feature) => app.includes(feature.seoTitle)), "All six feature pages have dedicated SEO titles");
assertCheck(app.includes("function FeatureHero(") && app.includes("function FeatureBenefits(") && app.includes("function FeatureUseCases("), "Feature pages use reusable section components");
assertCheck(app.includes("function FeatureCapabilities(") && app.includes("function FeatureWorkflow(") && app.includes("function FeaturePlanAvailability("), "Feature pages include capabilities, workflow, and plan availability sections");
assertCheck(featureDetailPage.includes("applyMarketingSeo") && featureDetailPage.includes("applyFeatureSchema(feature)") && featureDetailPage.includes("loohar-feature-jsonld"), "Feature pages update SEO metadata and JSON-LD schema");
assertCheck(app.includes('className="public-button primary large" href="/register"') && app.includes('className="public-button inverse large" href="/pricing"') && featureDetailPage.includes("<FeatureCTA feature={feature} />"), "Feature pages include registration and pricing CTAs");
assertCheck(featureDetailPage.includes("<RelatedFeatures features={relatedFeatures} />"), "Feature detail pages cross-link related Loohar features");
assertCheck(appRouter.includes('const isFeatureRoute = initialPath === "/features" || initialPath.startsWith("/features/");'), "Router identifies /features as a marketing route");
assertCheck(appRouter.includes("if (isFeatureRoute)") && appRouter.indexOf("if (isFeatureRoute)") < appRouter.indexOf("if (isSiteRoute)"), "Feature routes render before tenant public-site routes");
assertCheck(appRouter.includes('!initialPath.startsWith("/features")'), "Tenant-host path routing excludes feature pages");
assertCheck(styles.includes(".feature-detail-page") && styles.includes(".feature-detail-hero") && styles.includes(".feature-plan-grid"), "Feature detail page styles are present");
assertCheck(styles.includes(".feature-related-grid") && styles.includes(".feature-cta"), "Feature related links and CTA styles are present");
assertCheck(!/font-size\s*:\s*clamp\([^;]*(vw|vh)/i.test(styles), "Public feature typography does not scale directly with viewport width");

if (failures.length) {
  console.error(`feature-pages-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("feature-pages-test passed.");

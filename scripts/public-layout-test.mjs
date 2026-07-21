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

const registrationShell = sliceBetween(app, "function RegistrationShell(", "\nfunction PublicHome");
const publicHome = sliceBetween(app, "function PublicHome(", "\nconst publicPageContent");
const publicInfoPage = sliceBetween(app, "function PublicInfoPage(", "\nfunction PricingPage");
const pricingPage = sliceBetween(app, "function PricingPage(", "\nfunction RegistrationPage");
const authPage = sliceBetween(app, "function AuthPage(", "\nfunction ForgotPasswordPage");
const forgotPasswordPage = sliceBetween(app, "function ForgotPasswordPage(", "\nfunction ResetPasswordPage");
const resetPasswordPage = sliceBetween(app, "function ResetPasswordPage(", "\nfunction AdminCreateBusinessPage");
const siteRouteBlock = sliceBetween(app, "if (isSiteRoute)", "\n  if (orderRouteSlug)");

assertCheck(app.includes("function PublicLayout(") && app.includes("public-page-transition"), "PublicLayout provides one shared animated public shell");
assertCheck(registrationShell.includes("<PublicLayout") && registrationShell.includes("registration-shell"), "Registration pages use PublicLayout through RegistrationShell");
assertCheck(publicHome.includes("<PublicLayout") && publicHome.includes('className="marketing-page"'), "Homepage uses the shared public layout");
assertCheck(publicInfoPage.includes("<PublicLayout") && publicInfoPage.includes('className="public-info-page"'), "Public information pages use the shared public layout");
assertCheck(pricingPage.includes("<RegistrationShell>"), "Pricing page uses the registration/public shell");
assertCheck(authPage.includes("<PublicLayout compactNav") && forgotPasswordPage.includes("<PublicLayout compactNav") && resetPasswordPage.includes("<PublicLayout compactNav"), "Login and password recovery pages use compact public layout");
assertCheck(app.includes("const publicPageContent =") && app.includes("function PublicInfoPage("), "Public info content is centralized");
assertCheck(app.includes('"/about", "/security", "/support", "/privacy", "/terms", "/resources"') && app.includes("initialPath.startsWith(\"/resources/\")"), "Public info routes are explicitly routed");
assertCheck(app.indexOf("if (isPublicInfoRoute)") > -1 && app.indexOf("if (isSiteRoute)") > -1 && app.indexOf("if (isPublicInfoRoute)") < app.indexOf("if (isSiteRoute)"), "Public platform routes resolve before tenant restaurant catch-all routes");
assertCheck(siteRouteBlock.includes("<PremiumRestaurantSite") && !siteRouteBlock.includes("<PublicLayout"), "Tenant restaurant websites are not wrapped in PublicLayout");
assertCheck(styles.includes("--public-content-max-width") && styles.includes("--public-content-padding") && styles.includes(".public-container"), "Public layout tokens and container are defined");
assertCheck(styles.includes("scrollbar-gutter: stable;"), "Root layout reserves a stable scrollbar gutter across short and tall public pages");
assertCheck(styles.includes("*,\n*::before,\n*::after") && styles.includes("box-sizing: inherit;"), "Global box sizing reset includes pseudo elements");
assertCheck(styles.includes("html,\nbody") && styles.includes("padding: 0;"), "HTML and body reset margin and padding");
assertCheck(styles.includes("max-width: calc(var(--public-content-max-width) + (2 * var(--public-content-padding)));") && styles.includes("padding-inline: var(--public-content-padding);"), "Public container uses one padded max-width standard");
assertCheck(styles.includes(".public-footer-grid") && styles.includes(".public-info-grid") && styles.includes(".public-auth-grid"), "Footer, info pages, and auth pages share responsive grid rules");
assertCheck(styles.includes("@media (prefers-reduced-motion: reduce)") && styles.includes(".public-page-transition"), "Public layout respects reduced motion preferences");
assertCheck(!styles.includes(".marketing-header") && !styles.includes(".marketing-footer"), "Old homepage-specific header/footer styles were removed");
assertCheck(packageJson.scripts?.["test:public-layout"] === "node scripts/public-layout-test.mjs", "Public layout test script is registered");

if (failures.length) {
  console.error(`public-layout-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("public-layout-test passed.");

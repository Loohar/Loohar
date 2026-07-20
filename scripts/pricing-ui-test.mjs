import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
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

const pricingPage = sliceBetween(app, "function PricingPage(", "\nfunction RegistrationPage");

assertCheck(pricingPage.includes("<RegistrationShell>"), "Pricing is rendered inside the shared public registration shell");
assertCheck(pricingPage.includes("/api/registration/plans"), "Pricing loads plan configuration from the live registration API");
assertCheck(pricingPage.includes("PLAN_CONFIG_STATUS") && pricingPage.includes("checkoutStatusForPlan"), "Pricing uses explicit checkout availability state");
assertCheck(pricingPage.includes("Checking secure checkout availability"), "Pricing shows a neutral loading state while checking plans");
assertCheck(pricingPage.includes("Retry") && pricingPage.includes("setPlanRequestKey"), "Pricing provides a retry path when plan loading fails");
assertCheck(pricingPage.includes("billingInterval") && pricingPage.includes("MONTHLY") && pricingPage.includes("ANNUAL"), "Pricing supports monthly and annual plan display");
assertCheck(pricingPage.includes("/register?plan=") && pricingPage.includes("Select plan"), "Pricing plan CTAs route into registration with selected plan context");
assertCheck(app.includes("Checkout temporarily unavailable") && pricingPage.includes("Start setup"), "Pricing explains disabled checkout states");
assertCheck(!pricingPage.includes("marketing-header") && !pricingPage.includes("marketing-nav"), "Pricing does not render legacy homepage-only navigation");
assertCheck(packageJson.scripts?.["test:pricing-ui"] === "node scripts/pricing-ui-test.mjs", "Pricing UI test script is registered");

if (failures.length) {
  console.error(`pricing-ui-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("pricing-ui-test passed.");

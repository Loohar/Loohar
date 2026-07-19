import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
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
const registrationPage = sliceBetween(app, "function RegistrationPage(", "\nfunction RegistrationStatusPage");
const appRouter = app;

assertCheck(app.includes("const PLAN_CONFIG_STATUS ="), "Plan config uses an explicit state machine");
assertCheck(app.includes('IDLE: "IDLE"') && app.includes('LOADING: "LOADING"') && app.includes('READY: "READY"') && app.includes('ERROR: "ERROR"'), "Plan config declares IDLE, LOADING, READY, and ERROR states");
assertCheck(app.includes("function PlanCardSkeletons("), "Plan loading has a stable skeleton component");
assertCheck(pricingPage.includes('apiMode === "CHECKING"'), "Pricing distinguishes API checking from offline");
assertCheck(pricingPage.includes("Checking secure checkout availability"), "Pricing shows neutral checkout checking copy");
assertCheck(!pricingPage.includes("Live checkout is temporarily unavailable"), "Pricing does not show unavailable copy while API status is unknown");
assertCheck(registrationPage.includes("planConfigPending(planConfigStatus)"), "Registration derives pending plan config state explicitly");
assertCheck(registrationPage.includes("planConfigStatus === PLAN_CONFIG_STATUS.READY && planCheckoutAvailable"), "Registration enables checkout only after plan config is ready");
assertCheck(!registrationPage.includes("Loading plan settings..."), "Registration Step 1 does not show global plan-loading copy");
assertCheck(registrationPage.includes("Plan details are still loading. Please wait a moment."), "Checkout submit has a loading-specific message");
assertCheck(registrationPage.includes("Checkout availability could not be confirmed. Please retry plan details."), "Checkout submit has an error-specific message");
assertCheck(appRouter.includes("<PricingPage apiMode={apiMode} apiOnline={apiOnline} />"), "Pricing receives API mode from app router");
assertCheck(appRouter.includes("<RegistrationPage apiMode={apiMode} apiOnline={apiOnline} />"), "Registration receives API mode from app router");

if (failures.length) {
  console.error(`loading-state failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("loading-state passed.");

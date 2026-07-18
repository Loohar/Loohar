import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const appPath = join(root, "apps/web/src/App.jsx");
const serviceWorkerPath = join(root, "apps/web/public/sw.js");
const app = readFileSync(appPath, "utf8");
const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
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

const registrationInputIndex = app.indexOf("function RegistrationInput(");
const registrationPageIndex = app.indexOf("function RegistrationPage(");
const registrationPage = sliceBetween(app, "function RegistrationPage(", "\nfunction RegistrationStatusPage");
const updateField = sliceBetween(registrationPage, "function updateField(", "\n  async function checkSlug");

assertCheck(registrationInputIndex >= 0, "RegistrationInput exists");
assertCheck(registrationInputIndex >= 0 && registrationPageIndex >= 0 && registrationInputIndex < registrationPageIndex, "RegistrationInput is module-scoped before RegistrationPage");
assertCheck(!/function\s+Input\s*\(/.test(registrationPage), "RegistrationPage does not declare an inline input component");
assertCheck(!/<Input\b/.test(registrationPage), "RegistrationPage renders the stable RegistrationInput component");
assertCheck(/<form\s+className="panel mt-5"\s+noValidate\s+onSubmit=\{currentStep === "checkout" \? submitRegistration : continueStep\}/.test(registrationPage), "Registration steps use one stable form submit boundary");
assertCheck(/type="submit"\s+disabled=\{submitting \|\| !checkoutReady\}/.test(registrationPage), "Checkout action submits through the form");
assertCheck(/type="submit">Continue<\/button>/.test(registrationPage), "Continue action submits through the form");
assertCheck(/type="button"\s+disabled=\{stepIndex === 0\}/.test(registrationPage), "Back action remains a non-submit button");
assertCheck(registrationPage.includes("registrationVisibleErrors(errors, currentStep)") && registrationPage.includes("Please fix these fields:"), "Validation summary uses human-readable messages for the visible step");
assertCheck(!registrationPage.includes("Object.keys(currentErrors)") && !registrationPage.includes("currentErrors"), "Validation summary no longer exposes raw internal field identifiers");
assertCheck(updateField && !/api\s*\(/.test(updateField), "Typing only updates local draft state and never calls the API");
assertCheck(!/\[[^\]]*\bform\b[^\]]*\]/.test(sliceBetween(registrationPage, "useEffect(() =>", "\n  function updateField")), "Registration data-loading effect does not depend on mutable form state");

const unstableKeyPatterns = [
  /key=\{form\b/,
  /key=\{JSON\.stringify/,
  /key=\{registration\b/,
  /key=\{registration\?\.updatedAt/,
  /key=\{Date\.now\(\)/,
  /key=\{Math\.random\(\)/,
  /key=\{location\.pathname/,
  /key=\{currentStep\b/,
  /key=\{email\b/,
  /key=\{preferredSlug\b/
];
assertCheck(!unstableKeyPatterns.some((pattern) => pattern.test(registrationPage)), "Registration page has no form-value or timestamp based keys");

const passwordStoragePattern = /(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(\s*["'][^"']*(password|passwordHash|registrationPassword|confirmPassword)[^"']*["']/i;
assertCheck(!passwordStoragePattern.test(app), "Registration password is not stored in browser storage");
assertCheck(serviceWorker.includes('"/api/"') && serviceWorker.includes("NETWORK_ONLY_PATHS"), "Service worker keeps API requests network-only");

if (failures.length) {
  console.error(`registration-ui failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("registration-ui passed.");

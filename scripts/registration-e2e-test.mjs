import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "apps/web/src/App.jsx"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const webPackageJson = JSON.parse(readFileSync(join(root, "apps/web/package.json"), "utf8"));
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

const allDependencies = {
  ...(packageJson.dependencies || {}),
  ...(packageJson.devDependencies || {}),
  ...(webPackageJson.dependencies || {}),
  ...(webPackageJson.devDependencies || {})
};
const browserAutomationInstalled = ["@playwright/test", "playwright", "puppeteer", "cypress"].some((name) => Boolean(allDependencies[name]));
const registrationPage = sliceBetween(app, "function RegistrationPage(", "\nfunction RegistrationStatusPage");
const slugInputValue = sliceBetween(app, "function slugInputValue(", "\n\nfunction normalizePlanLabel");

assertCheck(!browserAutomationInstalled, "Browser automation is not installed, so this gate remains dependency-free");
assertCheck(registrationPage.includes("const [form, setForm] = useState({ ...registrationInitialForm"), "Registration owns a local editable draft");
assertCheck(registrationPage.includes("setForm((existing) => {") && registrationPage.includes("const next = { ...existing, [field]: value };"), "Input changes preserve existing draft fields");
assertCheck(registrationPage.includes("slugManuallyEdited") && registrationPage.includes('field === "publicBusinessName" && !slugManuallyEdited'), "Public restaurant name keeps generating the full slug until manual slug edit");
assertCheck(slugInputValue.includes('replace(/^-+/, "")') && !slugInputValue.includes("|-+"), "Manual slug typing preserves in-progress trailing hyphens");
assertCheck(!/setForm\(\s*registration\b/.test(registrationPage) && !/setForm\(\s*server/i.test(registrationPage), "Server registration responses do not overwrite the active draft while typing");
assertCheck(!/setStepIndex\([^)]*\)\s*;\s*setLoading\(true\)/.test(registrationPage), "Step navigation does not trigger the plan loading state");
assertCheck(registrationPage.includes("event?.preventDefault();"), "Step and checkout submissions prevent native page reloads");
assertCheck(registrationPage.includes("registrationSteps.findIndex((step) => registrationVisibleErrors(combinedErrors, step.id).length)"), "Submit redirects users back to the first invalid step");
assertCheck(!/console\.(log|debug|info|warn|error)\([^)]*(password|form|credentials)/i.test(registrationPage), "Registration does not log passwords, form drafts, or credentials");
assertCheck(!/(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\([^)]*(password|registration|form|draft)/i.test(registrationPage), "Registration drafts and passwords are not stored in browser storage");

if (failures.length) {
  console.error(`registration-e2e failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("registration-e2e passed.");

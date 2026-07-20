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

const authPage = sliceBetween(app, "function AuthPage(", "\nfunction ForgotPasswordPage");
const forgotPasswordPage = sliceBetween(app, "function ForgotPasswordPage(", "\nfunction ResetPasswordPage");
const resetPasswordPage = sliceBetween(app, "function ResetPasswordPage(", "\nfunction AdminCreateBusinessPage");

assertCheck(authPage.includes("<PublicLayout compactNav") && authPage.includes('className="public-auth-page"'), "Login pages use compact public layout");
assertCheck(forgotPasswordPage.includes("<PublicLayout compactNav") && resetPasswordPage.includes("<PublicLayout compactNav"), "Password recovery pages use compact public layout");
assertCheck(authPage.includes('const [password, setPassword] = useState("");'), "Login password state initializes empty");
assertCheck(!/useState\(["'][^"']*(Owner|Admin|Welcome|ChangeMe|2026|password)[^"']*["']\)/i.test(authPage), "Login state does not seed passwords");
assertCheck(authPage.includes('type="email"') && authPage.includes('name="email"') && authPage.includes('autoComplete="username"'), "Login email field uses secure username autocomplete");
assertCheck(authPage.includes('type="password"') && authPage.includes('autoComplete="current-password"'), "Login password field uses current-password autocomplete");
assertCheck(authPage.includes("<form className=\"panel grid gap-4\" noValidate onSubmit={submitLogin}>"), "Login form uses a single noValidate submit handler");
assertCheck(authPage.includes("const canSubmitLogin = loginEmailValid && loginPasswordReady && !loading;"), "Login readiness only requires a valid email, non-empty password, and idle submit state");
assertCheck(authPage.includes("disabled={!canSubmitLogin}") && !authPage.includes("disabled={loading || !apiOnline}"), "Login button is not blocked by stale API health state");
assertCheck(authPage.includes("Live API health is unavailable. You can still submit") && !authPage.includes("Start the API before using secure login."), "Offline health copy is informative instead of a hard login blocker");
assertCheck(authPage.includes("/api/auth/login") && authPage.includes("Authorization") === false, "Login form delegates token handling to the API client");
assertCheck(authPage.includes("/api/auth/demo-login") && authPage.includes("body: { role:"), "Development demo login uses backend role-based demo endpoint");
assertCheck(!authPage.includes("disabled={loading || !apiOnline}") && authPage.includes("disabled={loading} onClick={submitDemoLogin}"), "Development demo login is routed through the backend and not disabled by health polling");
assertCheck(authPage.includes("clearLoginFields") && authPage.includes("pageshow") && authPage.includes("setPassword(\"\")"), "Login page clears stale password autofill state on mount/pageshow");
assertCheck(!authPage.includes("BrandMark") && !forgotPasswordPage.includes("BrandMark") && !resetPasswordPage.includes("BrandMark"), "Public auth pages do not render the old shield brand mark");
assertCheck(!/(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(\s*["'][^"']*password/i.test(app), "Frontend does not store passwords in browser storage");
assertCheck(packageJson.scripts?.["test:login-ui"] === "node scripts/login-ui-test.mjs", "Login UI test script is registered");

if (failures.length) {
  console.error(`login-ui-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("login-ui-test passed.");

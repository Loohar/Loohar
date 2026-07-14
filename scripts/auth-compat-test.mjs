import { readFileSync } from "node:fs";

const checks = [];

function read(path) {
  return readFileSync(path, "utf8");
}

function pass(name) {
  checks.push({ name, ok: true });
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail });
}

function includes(path, needle, name) {
  const content = read(path);
  if (content.includes(needle)) pass(name);
  else fail(name, `${path} is missing ${needle}`);
}

function excludes(path, needle, name) {
  const content = read(path);
  if (!content.includes(needle)) pass(name);
  else fail(name, `${path} still contains ${needle}`);
}

includes("apps/web/src/lib/api.js", "https://api.loohar.com", "Web API default uses api.loohar.com");
includes("apps/web/src/lib/api.js", "credentials: options.credentials || \"include\"", "Fetch includes credentials for compatible CORS");
includes("apps/web/src/lib/api.js", "skipAuth", "API client supports auth-free login requests");
includes("apps/web/src/lib/api.js", "cache: options.cache || (isAuthPath(path) ? \"no-store\" : \"default\")", "Auth requests are no-store");
includes("apps/web/src/shared/browserStorage.js", "sessionStorage", "Browser storage falls back to sessionStorage");
includes("apps/web/src/App.jsx", "verifyAuthenticatedSession", "Login verifies /auth/me before redirect");
includes("apps/web/src/App.jsx", "skipAuth: true", "Login requests do not attach stale bearer tokens");
includes("apps/web/src/App.jsx", "refreshSession(refreshToken)", "App boot attempts refresh before clearing session");
includes("apps/web/src/App.jsx", "name=\"password\"", "Primary login password field uses standard name");
includes("apps/web/src/apps/driver/components/DriverLogin.jsx", "name=\"password\"", "Driver login password field uses standard name");
includes("apps/web/public/sw.js", "driver-pwa-shell-v4", "Service worker cache version bumped");
includes("apps/web/public/sw.js", "NETWORK_ONLY_PATHS", "Service worker excludes auth/API paths");
includes("apps/api/src/config/urls.js", "https://api.loohar.com", "Backend API URL default uses api.loohar.com");
includes("render.yaml", "https://api.loohar.com", "Render blueprint uses api.loohar.com");
includes("apps/web/vercel.json", "https://api.loohar.com", "Vercel rewrites target api.loohar.com");
excludes("apps/web/vercel.json", ["loohar-api", "onrender", "com"].join("."), "Vercel rewrites do not expose Render hostname");
excludes("apps/web/src/lib/api.js", ["loohar-api", "onrender", "com"].join("."), "Web bundle source does not expose Render hostname");

const failed = checks.filter((check) => !check.ok);
checks.forEach((check) => {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
});
console.log(`Auth compatibility: ${checks.length - failed.length} passed, ${failed.length} failed`);

if (failed.length) process.exit(1);

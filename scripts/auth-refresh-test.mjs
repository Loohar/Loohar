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

includes("apps/web/src/lib/api.js", "../shared/auth.js", "API client imports canonical auth helpers");
excludes("apps/web/src/lib/api.js", "../shared/browserStorage.js", "API client no longer reads browser storage directly");
includes("apps/web/src/lib/api.js", "let refreshPromise = null", "API client keeps a single refresh promise");
includes("apps/web/src/lib/api.js", "if (refreshPromise) return refreshPromise", "Concurrent refreshes share one request");
includes("apps/web/src/lib/api.js", "getRefreshToken()", "Refresh reads the canonical refresh token at request time");
includes("apps/web/src/lib/api.js", "storeSession(payload)", "Refresh persists the returned session through canonical storage");
includes("apps/web/src/lib/api.js", "options.authRetry !== false", "API retry can be disabled for auth bootstrap calls");
includes("apps/web/src/lib/api.js", "refreshed?.accessToken", "Original request retries with refreshed access token");
includes("apps/web/src/lib/api.js", "getSessionRevision()", "Request dedupe keys are tied to session revision");
includes("apps/web/src/lib/api.js", "clearStoredSessionForToken(token", "Final unauthorized response clears matching stale sessions");

includes("apps/web/src/shared/auth.js", "AUTH_EXPIRED_EVENT", "Shared auth exposes the expired-session event");
includes("apps/web/src/shared/auth.js", "AUTH_SESSION_UPDATED_EVENT", "Shared auth exposes the session-updated event");
includes("apps/web/src/shared/auth.js", "export function getAccessToken", "Shared auth exposes current access token");
includes("apps/web/src/shared/auth.js", "export function getRefreshToken", "Shared auth exposes current refresh token");
includes("apps/web/src/shared/auth.js", "export function getSessionRevision", "Shared auth exposes session revision");
includes("apps/web/src/shared/auth.js", "options.emit !== false", "Shared auth can clear without re-emitting expiration");
includes("apps/web/src/shared/auth.js", "\"temporaryPassword\"", "Shared auth removes cached temporary password flags");
includes("apps/web/src/shared/auth.js", "\"sessionVersion\"", "Shared auth removes cached session version");

includes("apps/web/src/App.jsx", "AUTH_EXPIRED_EVENT", "App listens to canonical auth expiration events");
includes("apps/web/src/App.jsx", "AUTH_SESSION_UPDATED_EVENT", "App listens to canonical session update events");
includes("apps/web/src/App.jsx", "loginHrefWithReturnTo(\"/admin/login\"", "Admin routes redirect to admin login on session failure");
includes("apps/web/src/App.jsx", "headers: { \"Idempotency-Key\": idempotencyKey }", "Add Business sends an idempotency key");
excludes("apps/web/src/App.jsx", "api(\"/api/admin/tenants\", { method: \"POST\", token", "Add Business does not capture a stale token");

[
  "AUTH_ACCESS_TOKEN_MISSING",
  "AUTH_ACCESS_TOKEN_EXPIRED",
  "AUTH_ACCESS_TOKEN_INVALID",
  "AUTH_SESSION_REVOKED",
  "AUTH_USER_INACTIVE",
  "AUTH_ROLE_FORBIDDEN",
  "AUTH_TENANT_FORBIDDEN"
].forEach((code) => includes("apps/api/src/middleware/auth.js", code, `Backend middleware returns ${code}`));

[
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_REFRESH_TOKEN_MISSING",
  "AUTH_REFRESH_TOKEN_EXPIRED",
  "AUTH_REFRESH_TOKEN_INVALID",
  "AUTH_SESSION_REVOKED",
  "AUTH_USER_INACTIVE"
].forEach((code) => includes("apps/api/src/routes/auth.js", code, `Auth routes return ${code}`));
includes("apps/api/src/routes/auth.js", "user: publicUser(req.user)", "Auth me response uses sanitized user data");

includes("apps/api/src/routes/superAdmin.js", "req.get(\"Idempotency-Key\")", "Super Admin create reads the idempotency key");
includes("apps/api/src/routes/superAdmin.js", "idempotencyKey ? { idempotencyKey } : undefined", "Super Admin audit records the idempotency key without sensitive data");

const failed = checks.filter((check) => !check.ok);
checks.forEach((check) => {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
});
console.log(`Auth refresh hotfix: ${checks.length - failed.length} passed, ${failed.length} failed`);

if (failed.length) process.exit(1);

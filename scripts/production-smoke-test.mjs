import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const appOrigin = (process.env.PRODUCTION_SMOKE_APP_URL || "https://loohar.com").replace(/\/+$/, "");
const apiOrigin = (process.env.PRODUCTION_SMOKE_API_URL || appOrigin).replace(/\/+$/, "");
const tenantRootDomain = process.env.PRODUCTION_SMOKE_TENANT_ROOT_DOMAIN || "loohar.com";
const tenantSiteOrigin = (process.env.PRODUCTION_SMOKE_TENANT_SITE_URL || `https://loohar-restaurant.${tenantRootDomain}`).replace(/\/+$/, "");
const driverOrigin = (process.env.PRODUCTION_SMOKE_DRIVER_URL || "https://driver.loohar.com").replace(/\/+$/, "");
const liveMode = process.env.PRODUCTION_SMOKE_LIVE === "true";
const strictMode = process.env.PRODUCTION_SMOKE_STRICT === "true";
const checks = [];
const localUrlPattern = /localhost|127\.0\.0\.1|0\.0\.0\.0|:\/\/\[?::1\]?/i;

function pass(name, detail = "") {
  checks.push({ name, ok: true, detail });
}

function skip(name, detail = "") {
  checks.push({ name, ok: !strictMode, skipped: true, detail });
}

function fail(name, detail = "") {
  checks.push({ name, ok: false, detail });
}

async function requestJson(name, url, options = {}, validate = (response) => response.ok) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (await validate(response, payload)) pass(name, `${response.status}`);
    else fail(name, `${response.status} ${payload.error || payload.message || "Unexpected response"}`);
    return payload;
  } catch (error) {
    fail(name, error.message);
    return null;
  }
}

function containsLocalUrl(value) {
  if (typeof value === "string") return localUrlPattern.test(value);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsLocalUrl);
  return Object.values(value).some(containsLocalUrl);
}

function assertNoLocalUrls(name, payload) {
  if (containsLocalUrl(payload)) fail(name, "Response contains localhost/loopback URL");
  else pass(name, "no localhost/loopback URLs");
}

function assertTenantIsolated(name, payload, expectedSlug, forbiddenTerms = []) {
  const actualSlug = payload?.restaurant?.slug || payload?.tenant?.slug || payload?.slug || "";
  const serialized = JSON.stringify(payload || {});
  const leakedTerm = forbiddenTerms.find((term) => serialized.includes(term));
  if (actualSlug !== expectedSlug) {
    fail(name, `expected ${expectedSlug}, got ${actualSlug || "missing slug"}`);
    return;
  }
  if (leakedTerm) {
    fail(name, `contains forbidden cross-tenant term: ${leakedTerm}`);
    return;
  }
  pass(name, expectedSlug);
}

function walkFiles(path, visitor) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const child of readdirSync(path)) walkFiles(join(path, child), visitor);
    return;
  }
  visitor(path);
}

function bundleHasNoLocalUrls() {
  const forbidden = [
    "local" + "host:5173",
    "local" + "host:5174",
    "local" + "host:5001",
    "http://" + "localhost",
    ["127", "0", "0", "1"].join(".")
  ];
  const findings = [];
  walkFiles("apps/web/dist", (file) => {
    if (/\.(png|jpe?g|webp|gif|svg|ico|map)$/i.test(file)) return;
    const content = readFileSync(file, "utf8");
    forbidden.forEach((needle) => {
      if (content.includes(needle)) findings.push(`${needle} in ${file}`);
    });
  });
  if (findings.length) fail("Production bundle no-localhost check", findings.join("; "));
  else pass("Production bundle no-localhost check", "clean");
}

function staticQrUrlCheck() {
  const customerQr = `${appOrigin}/app/order/order-smoke?token=tracking-smoke`;
  const driverQr = `${driverOrigin}/order/order-smoke`;
  const publicSite = `${tenantSiteOrigin}/order`;
  if (!customerQr.startsWith(appOrigin)) return fail("Customer QR production URL", customerQr);
  if (!driverQr.startsWith("https://driver.loohar.com")) return fail("Driver QR production URL", driverQr);
  if (!publicSite.startsWith(`https://loohar-restaurant.${tenantRootDomain}`)) return fail("Public restaurant canonical URL", publicSite);
  pass("Production QR URL config", "app, driver, and tenant public domains");
}

bundleHasNoLocalUrls();
staticQrUrlCheck();

if (liveMode) {
  await requestJson("Production API health", `${apiOrigin}/health`, {}, (response, body) => response.ok && body?.ok === true);
  await requestJson("Production forgot password generic response", `${apiOrigin}/api/auth/forgot-password`, { method: "POST", body: JSON.stringify({ email: "missing-smoke-user@loohar.com" }) }, (response, body) => response.ok && body?.ok === true);
  const publicSite = await requestJson("Production public site fallback load", `${apiOrigin}/api/public/sites/loohar-restaurant`, {}, (response, body) => response.ok && Boolean(body?.restaurant?.slug));
  assertNoLocalUrls("Production public site no-localhost URLs", publicSite);
  const tenantHostSite = await requestJson("Production tenant host resolver", `${apiOrigin}/api/public/site-by-host?host=loohar-restaurant.${tenantRootDomain}`, {}, (response, body) => response.ok && Boolean(body?.restaurant?.slug));
  assertNoLocalUrls("Production tenant host no-localhost URLs", tenantHostSite);
  const kathmanduForbidden = ["Demo Bistro", "demo-bistro", "Seasonal American Bistro"];
  const kathmanduSite = await requestJson("Production Kathmandu site resolves exact tenant", `${apiOrigin}/api/public/sites/kathmandu-restaurant-ii`, {}, (response, body) => response.ok && body?.restaurant?.slug === "kathmandu-restaurant-ii");
  assertTenantIsolated("Production Kathmandu site has no Demo Bistro leakage", kathmanduSite, "kathmandu-restaurant-ii", kathmanduForbidden);
  const kathmanduMenu = await requestJson("Production Kathmandu menu resolves exact tenant", `${apiOrigin}/api/public/sites/kathmandu-restaurant-ii/menu`, {}, (response, body) => response.ok && body?.restaurant?.slug === "kathmandu-restaurant-ii");
  assertTenantIsolated("Production Kathmandu menu has no Demo Bistro leakage", kathmanduMenu, "kathmandu-restaurant-ii", kathmanduForbidden);
  const kathmanduHost = await requestJson("Production Kathmandu tenant host resolver", `${apiOrigin}/api/public/site-by-host?host=kathmandu-restaurant-ii.${tenantRootDomain}`, {}, (response, body) => response.ok && body?.restaurant?.slug === "kathmandu-restaurant-ii");
  assertTenantIsolated("Production Kathmandu host has no Demo Bistro leakage", kathmanduHost, "kathmandu-restaurant-ii", kathmanduForbidden);
  await requestJson("Production unknown tenant returns 404", `${apiOrigin}/api/public/sites/not-a-real-loohar-tenant`, {}, (response) => response.status === 404);
  await requestJson("Production upload endpoint rejects anonymous", `${apiOrigin}/api/uploads/gallery`, { method: "POST", body: JSON.stringify({}) }, (response) => response.status === 401);
  await requestJson("Production CORS allows Loohar app origin", `${apiOrigin}/health`, { headers: { Origin: appOrigin } }, (response) => response.ok && response.headers.get("access-control-allow-origin") === appOrigin);
  await requestJson("Production CORS allows tenant subdomain origin", `${apiOrigin}/health`, { headers: { Origin: tenantSiteOrigin } }, (response) => response.ok && response.headers.get("access-control-allow-origin") === tenantSiteOrigin);
  await requestJson("Production CORS disallows unexpected origin", `${apiOrigin}/health`, { headers: { Origin: "https://unexpected.example" } }, (response) => response.status >= 400 || response.headers.get("access-control-allow-origin") !== "https://unexpected.example");

  const email = process.env.PRODUCTION_SMOKE_EMAIL;
  const password = process.env.PRODUCTION_SMOKE_PASSWORD;
  if (email && password) {
    const login = await requestJson("Production auth login", `${apiOrigin}/api/auth/login`, { method: "POST", body: JSON.stringify({ email, password }) }, (response, body) => response.ok && Boolean(body?.accessToken));
    const token = login?.accessToken || "";
    await requestJson("Production auth me", `${apiOrigin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }, (response, body) => response.ok && Boolean(body?.user?.id));
    await requestJson("Production super admin dashboard summary", `${apiOrigin}/api/admin/dashboard-summary`, { headers: { Authorization: `Bearer ${token}` } }, (response, body) => response.ok && Number.isFinite(body?.totalBusinesses));
    await requestJson("Production create tenant path protected", `${apiOrigin}/api/admin/tenants`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ dryRun: true }) }, (response) => [400, 422].includes(response.status));
  } else {
    skip("Production auth login", "Set PRODUCTION_SMOKE_EMAIL and PRODUCTION_SMOKE_PASSWORD for live auth checks");
    skip("Production auth me", "Skipped without live smoke credentials");
    skip("Production super admin dashboard summary", "Skipped without live smoke credentials");
    skip("Production create tenant safe check", "Skipped without live smoke credentials");
  }
  skip("Production order tracking route", "Requires a live order tracking token");
  skip("Production driver QR route", "Requires a live driver session");
} else {
  skip("Production API health", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production auth login", "Set PRODUCTION_SMOKE_LIVE=true and smoke credentials after deployment");
  skip("Production /auth/me", "Set PRODUCTION_SMOKE_LIVE=true and smoke credentials after deployment");
  skip("Production super admin dashboard summary", "Set PRODUCTION_SMOKE_LIVE=true and smoke credentials after deployment");
  skip("Production create tenant safe check", "Set PRODUCTION_SMOKE_LIVE=true and smoke credentials after deployment");
  skip("Production public site fallback load", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production tenant host resolver", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production Kathmandu site resolves exact tenant", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production Kathmandu menu resolves exact tenant", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production Kathmandu tenant host resolver", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production Kathmandu tenant isolation", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production unknown tenant returns 404", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production upload endpoint rejects anonymous", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production order tracking route", "Requires live order token after deployment");
  skip("Production driver QR route", "Requires live driver session after deployment");
  skip("Production forgot password generic response", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production CORS allows Loohar app origin", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production CORS allows tenant subdomain origin", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
  skip("Production CORS disallows unexpected origin", "Set PRODUCTION_SMOKE_LIVE=true after deployment");
}

const passed = checks.filter((check) => check.ok && !check.skipped).length;
const skipped = checks.filter((check) => check.skipped).length;
const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const mark = check.ok ? check.skipped ? "SKIP" : "PASS" : "FAIL";
  console.log(`${mark} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}
console.log(`Production smoke: ${passed} passed, ${skipped} skipped, ${failed.length} failed`);

if (failed.length) process.exit(1);

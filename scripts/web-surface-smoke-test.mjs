// Renders every authenticated Loohar surface in a real browser and fails on any runtime exception.
// Source-text assertions cannot catch a crash like reading a binding before it is initialised; this
// can. The built bundle is served locally and every API call is answered from fixtures, so the test
// never touches staging or production.
//
//   npm run build   # produces apps/web/dist
//   node scripts/web-surface-smoke-test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { after, before, test } from "node:test";

const DIST = resolve("apps/web/dist");

// A stale bundle would let this gate pass on code that no longer exists, so rebuild when any source
// file is newer than the build.
function newestSourceMtime(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestSourceMtime(full) : statSync(full).mtimeMs);
  }
  return newest;
}

const builtAt = existsSync(join(DIST, "index.html")) ? statSync(join(DIST, "index.html")).mtimeMs : 0;
const sourceAt = Math.max(newestSourceMtime(resolve("apps/web/src")), statSync(resolve("apps/shared")).mtimeMs);
if (builtAt < sourceAt) {
  console.log("Building apps/web for the surface smoke test...");
  const build = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_API_URL: process.env.VITE_API_URL || "https://loohar-api-staging.onrender.com",
      VITE_REALTIME_URL: process.env.VITE_REALTIME_URL || "https://loohar-api-staging.onrender.com"
    }
  });
  if (build.status !== 0) {
    console.error("web surface smoke test: the web build failed.");
    process.exit(1);
  }
}
if (!existsSync(join(DIST, "index.html"))) {
  console.log("SKIP web surface smoke test: apps/web could not be built.");
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("SKIP web surface smoke test: playwright is not installed.");
  process.exit(0);
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

const RESTAURANT_ID = "rest_smoke";
const RESTAURANT_SLUG = "smoke-diner";

const user = {
  id: "user_smoke",
  email: "owner@smoke.test",
  name: "Smoke Owner",
  role: "TENANT_OWNER",
  restaurantId: RESTAURANT_ID,
  restaurantSlug: RESTAURANT_SLUG,
  restaurantName: "Smoke Diner",
  mfaEnabled: true,
  onboardingStatus: "COMPLETED",
  onboardingCurrentStep: "DONE",
  websitePublishedAt: new Date().toISOString()
};

const restaurant = {
  id: RESTAURANT_ID,
  slug: RESTAURANT_SLUG,
  name: "Smoke Diner",
  businessName: "Smoke Diner",
  businessType: "RESTAURANT",
  status: "ACTIVE",
  timezone: "America/Denver",
  enabledModules: ["RESTAURANT_ORDERING", "PICKUP", "FOOD_CATALOG"],
  pickupEnabled: true,
  deliveryEnabled: false,
  deliveryFeeCents: 0,
  onboardingStatus: "COMPLETED",
  onboardingCurrentStep: "DONE",
  categories: []
};

// One permissive body keeps unknown endpoints from crashing a surface: anything the app destructures
// is present and empty rather than undefined.
const genericBody = {
  ok: true,
  user,
  restaurant,
  restaurants: [restaurant],
  locations: [{ id: "loc_main", name: "Main", active: true, address: "1 Main St" }],
  orders: [],
  items: [],
  categories: [],
  customers: [],
  drivers: [],
  employees: [],
  staff: [],
  zones: [],
  payments: [],
  refunds: [],
  tickets: [],
  devices: [],
  readers: [],
  programs: [],
  plans: [],
  invoices: [],
  events: [],
  settings: {},
  summary: {},
  metrics: {},
  charts: {},
  totals: {},
  range: { day: "2026-09-18", from: new Date().toISOString(), to: new Date().toISOString(), timezone: "America/Denver" },
  entitlements: { features: [], usage: [] },
  permissions: ["POS_ACCESS", "POS_CREATE_ORDER", "POS_ACCEPT_CASH", "POS_ACCEPT_CARD", "POS_MANAGE_DEVICES"],
  fulfillment: { pickup: true, delivery: false },
  reconciliation: { netCollectedCents: 0, awaitingPaymentCount: 0, awaitingPaymentCents: 0, failedPaymentCount: 0, ordersWithoutSettledPaymentCount: 0, platformFeeCents: 0 },
  hasMore: false
};

const routeBodies = new Map([
  ["/api/auth/me", { user, restaurant }],
  ["/api/restaurants/me", { user, restaurant, introductoryProgram: null }],
  ["/api/health", { ok: true, service: "api" }],
  ["/api/version", { service: "api", environment: "test", commitSha: "smoke" }]
]);

let server;
let baseUrl;
let browser;

function bodyForPath(pathname) {
  for (const [key, value] of routeBodies) {
    if (pathname.endsWith(key)) return { ...genericBody, ...value };
  }
  return genericBody;
}

before(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const filePath = join(DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const exists = existsSync(filePath) && statSync(filePath).isFile();
    const served = exists ? filePath : join(DIST, "index.html");
    response.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(served)] || "application/octet-stream" });
    createReadStream(served).pipe(response);
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function renderSurface(path, { expect: expectedText, role = "TENANT_OWNER" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const failures = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(`uncaught: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Network noise from blocked sockets and images is not a render failure.
    if (/Failed to load resource|net::ERR_|socket|favicon/i.test(text)) return;
    failures.push(`console: ${text}`);
  });

  // Every API call is answered locally; nothing leaves this machine.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseUrl) return route.continue();
    if (url.pathname.includes("/socket.io/") || url.hostname.includes("js.stripe.com")) {
      return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(bodyForPath(url.pathname))
    });
  });

  await context.addInitScript(([storedUser, storedRole]) => {
    window.localStorage.setItem("accessToken", "smoke-access-token");
    window.localStorage.setItem("refreshToken", "smoke-refresh-token");
    window.localStorage.setItem("user", JSON.stringify({ ...storedUser, role: storedRole }));
  }, [user, role]);

  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  await context.close();
  return { failures, bodyText };
}

const surfaces = [
  { name: "restaurant dashboard", path: `/restaurant/${RESTAURANT_SLUG}/dashboard` },
  { name: "payments and refunds", path: `/restaurant/${RESTAURANT_SLUG}/payments`, expect: /payments|refund/i },
  { name: "orders", path: `/restaurant/${RESTAURANT_SLUG}/orders` },
  { name: "reports", path: `/restaurant/${RESTAURANT_SLUG}/reports` },
  { name: "POS register", path: `/restaurant/${RESTAURANT_SLUG}/pos` },
  { name: "kitchen display", path: `/kitchen/${RESTAURANT_SLUG}` },
  { name: "customer storefront", path: `/order/${RESTAURANT_SLUG}` }
];

for (const surface of surfaces) {
  test(`${surface.name} renders without a runtime exception`, async () => {
    const { failures, bodyText } = await renderSurface(surface.path);
    assert.deepEqual(failures, [], `${surface.name} raised ${failures.join(" | ")}`);
    assert.ok(bodyText.trim().length > 0, `${surface.name} rendered an empty page`);
    if (surface.expect) assert.match(bodyText, surface.expect);
  });
}

test("the super admin surface renders without a runtime exception", async () => {
  const { failures, bodyText } = await renderSurface("/admin", { role: "SUPER_ADMIN" });
  assert.deepEqual(failures, [], `super admin raised ${failures.join(" | ")}`);
  assert.ok(bodyText.trim().length > 0);
});

import { spawn } from "node:child_process";
import process from "node:process";

const browsers = ["chromium", "webkit"];
const viewports = [
  { name: "desktop", width: 1440, height: 950 },
  { name: "ipad", width: 820, height: 1180, hasTouch: true },
  { name: "iphone", width: 390, height: 844, isMobile: true, hasTouch: true }
];
let serverProcess;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    fail([
      "Playwright is required for the homepage browser gate.",
      "Install it before release verification:",
      "  npm install -D playwright",
      "  npx playwright install chromium webkit",
      `Import error: ${error.message}`
    ].join("\n"));
  }
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Vite homepage test server.")), 30_000);
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/Local:\s+(http:\/\/[^\s/]+:\d+\/)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1].replace(/\/$/, ""));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`Homepage test server exited early with ${code}.\n${output.trim()}`)));
  });
}

async function resolveBaseUrl() {
  if (process.env.HOMEPAGE_BROWSER_BASE_URL) return process.env.HOMEPAGE_BROWSER_BASE_URL.replace(/\/$/, "");
  serverProcess = spawn("npm", ["--workspace", "apps/web", "run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_API_URL: "/api", VITE_API_HEALTH_URL: "/health" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return waitForServer(serverProcess);
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Homepage horizontally overflows by ${overflow}px.`);
}

async function installNetworkGuards(context, counters) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/health" || url.pathname === "/api/health") {
      counters.health += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, service: "api", test: "homepage-e2e" }) });
    }
    if (/^\/api\/(admin|restaurants|driver|customer|kitchen|orders)\b/.test(url.pathname)) {
      counters.privateApis.push(url.pathname);
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Homepage requested private API" }) });
    }
    return route.continue();
  });
}

async function runScenario(browserType, viewport, baseUrl) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: Boolean(viewport.hasTouch),
      isMobile: Boolean(viewport.isMobile)
    });
    const counters = { health: 0, privateApis: [] };
    await installNetworkGuards(context, counters);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Loohar", level: 1 }).waitFor();
    if ((await page.title()) !== "Loohar | Restaurant Websites, Direct Ordering and Delivery SaaS") throw new Error("Homepage title is not production SEO title.");
    await assertNoHorizontalOverflow(page);
    if (counters.privateApis.length) throw new Error(`Homepage loaded private APIs: ${counters.privateApis.join(", ")}`);

    const heroLoaded = await page.locator(".marketing-hero-image").evaluate((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    if (!heroLoaded) throw new Error("Hero image did not load.");

    const pricingHref = await page.getByRole("link", { name: "View Pricing" }).first().getAttribute("href");
    const registerHref = await page.getByRole("link", { name: "Register Your Restaurant" }).first().getAttribute("href");
    if (pricingHref !== "/pricing") throw new Error(`View Pricing link points to ${pricingHref}.`);
    if (registerHref !== "/register") throw new Error(`Register link points to ${registerHref}.`);

    const featureCard = page.locator('a.marketing-feature-link-card[href="/features/restaurant-website"]').first();
    await featureCard.waitFor();
    await featureCard.click();
    await page.waitForURL(/\/features\/restaurant-website$/);
    await page.getByRole("heading", { name: "Restaurant Website", level: 1 }).waitFor();
    const featurePricingHref = await page.getByRole("link", { name: "View plan availability" }).first().getAttribute("href");
    const featureRegisterHref = await page.getByRole("link", { name: "Register Your Restaurant" }).first().getAttribute("href");
    if (featurePricingHref !== "/pricing?feature=restaurant-website") throw new Error(`Feature pricing CTA points to ${featurePricingHref}.`);
    if (featureRegisterHref !== "/register") throw new Error(`Feature registration CTA points to ${featureRegisterHref}.`);
    await assertNoHorizontalOverflow(page);
    await context.close();
  } finally {
    await browser.close();
  }
}

const playwright = await loadPlaywright();
const baseUrl = await resolveBaseUrl();
const results = [];
try {
  for (const browserName of browsers) {
    const browserType = playwright[browserName];
    if (!browserType) throw new Error(`Playwright browser "${browserName}" is unavailable.`);
    for (const viewport of viewports) {
      await runScenario(browserType, viewport, baseUrl);
      const label = `${browserName} ${viewport.name} ${viewport.width}x${viewport.height}`;
      results.push(label);
      console.log(`PASS ${label}`);
    }
  }
} finally {
  if (serverProcess) serverProcess.kill("SIGTERM");
}

console.log(`homepage-e2e passed ${results.length} scenarios.`);

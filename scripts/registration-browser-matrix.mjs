import { spawn } from "node:child_process";
import process from "node:process";

const browsers = ["chromium", "webkit"];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "ipad-pro", width: 1024, height: 1366, hasTouch: true },
  { name: "ipad-air", width: 820, height: 1180, hasTouch: true },
  { name: "iphone-12", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "iphone-15", width: 393, height: 852, isMobile: true, hasTouch: true },
  { name: "iphone-plus", width: 430, height: 932, isMobile: true, hasTouch: true }
];

const ownerValues = {
  firstName: "Safari",
  lastName: "Tester",
  email: "safari.registration@example.com",
  phone: "3035550199",
  password: "LooharBrowser2026!",
  confirmPassword: "LooharBrowser2026!"
};

const restaurantValues = {
  businessName: "Safari Matrix Restaurant LLC",
  publicBusinessName: "Safari Matrix Cafe",
  cuisine: "Nepali fusion",
  businessEmail: "hello@safarimatrix.example",
  businessPhone: "3035550144",
  address: "1200 Market Street",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
  timezone: "America/Denver"
};

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
      "Playwright is required for the cross-browser registration gate.",
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
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Vite registration test server.")), 30_000);
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
    child.on("exit", (code) => reject(new Error(`Registration test server exited early with ${code}.\n${output.trim()}`)));
  });
}

async function resolveBaseUrl() {
  if (process.env.REGISTRATION_BROWSER_BASE_URL) return process.env.REGISTRATION_BROWSER_BASE_URL.replace(/\/$/, "");
  serverProcess = spawn("npm", ["--workspace", "apps/web", "run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_API_URL: "/api", VITE_API_HEALTH_URL: "/health" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return waitForServer(serverProcess);
}

async function installMockApi(context) {
  let startRequests = 0;
  let checkoutRequests = 0;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/health")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, service: "api", test: "registration-browser-matrix" }) });
    }
    if (url.pathname === "/api/registration/plans") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          plans: [
            {
              code: "STARTER",
              displayName: "Starter",
              description: "Browser matrix test plan.",
              monthlyPriceCents: 4900,
              annualPriceCents: 49000,
              features: ["Ordering", "Pickup"],
              checkoutAvailable: true,
              monthlyCheckoutAvailable: true,
              annualCheckoutAvailable: true
            }
          ]
        })
      });
    }
    if (url.pathname.startsWith("/api/registration/slug/")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: true, slug: url.pathname.split("/").pop() }) });
    }
    if (url.pathname === "/api/registration/start" && request.method() === "POST") {
      startRequests += 1;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          registration: {
            id: "reg-browser-matrix",
            status: "PENDING_PAYMENT",
            restaurantName: restaurantValues.publicBusinessName,
            planCode: "STARTER",
            billingInterval: "MONTHLY"
          }
        })
      });
    }
    if (url.pathname === "/api/registration/checkout" && request.method() === "POST") {
      checkoutRequests += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ checkoutUrl: `${url.origin}/register/status?registrationId=reg-browser-matrix&session_id=test_browser_matrix` }) });
    }
    return route.continue();
  });
  return {
    get startRequests() {
      return startRequests;
    },
    get checkoutRequests() {
      return checkoutRequests;
    }
  };
}

async function typeAndKeepFocus(page, selector, value) {
  const locator = page.locator(selector);
  await locator.click();
  await locator.fill("");
  let typed = "";
  for (const char of value) {
    typed += char;
    await locator.pressSequentially(char);
    const actual = await locator.inputValue();
    if (actual !== typed) throw new Error(`${selector} lost typed value. Expected "${typed}", got "${actual}".`);
    const stillFocused = await locator.evaluate((node) => document.activeElement === node);
    if (!stillFocused) throw new Error(`${selector} lost focus while typing "${typed}".`);
  }
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Page horizontally overflows by ${overflow}px.`);
}

async function runScenario(browserType, viewport, baseUrl) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: Boolean(viewport.hasTouch),
      isMobile: Boolean(viewport.isMobile)
    });
    const apiCounters = await installMockApi(context);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/register`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /register your restaurant/i }).waitFor();
    await assertNoHorizontalOverflow(page);

    for (const [field, value] of Object.entries(ownerValues)) {
      await typeAndKeepFocus(page, `#registration-${field}`, value);
    }
    await page.locator("#registration-termsAccepted").check();
    await page.locator("#registration-privacyAccepted").check();
    await page.getByRole("button", { name: "2. Restaurant" }).evaluate((node) => {
      if (!node.disabled) throw new Error("Future progress step should stay disabled before account validation.");
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: /restaurant information/i }).waitFor();
    await assertNoHorizontalOverflow(page);

    for (const [field, value] of Object.entries(restaurantValues)) {
      await typeAndKeepFocus(page, `#registration-${field}`, value);
    }
    const autoSlug = await page.locator("#registration-preferredSlug").inputValue();
    if (autoSlug !== "safari-matrix-cafe") throw new Error(`Auto slug did not track public name. Got "${autoSlug}".`);
    await typeAndKeepFocus(page, "#registration-preferredSlug", "safari-matrix-cafe-denver");
    await page.getByRole("button", { name: "Check URL" }).click();
    await page.getByText("This restaurant URL is available.").waitFor();

    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("heading", { name: /owner account/i }).waitFor();
    if ((await page.locator("#registration-email").inputValue()) !== ownerValues.email) throw new Error("Back navigation did not preserve owner email.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: /restaurant information/i }).waitFor();
    if ((await page.locator("#registration-preferredSlug").inputValue()) !== "safari-matrix-cafe-denver") throw new Error("Forward navigation did not preserve manual slug.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: /choose plan/i }).waitFor();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: /secure checkout/i }).waitFor();
    await page.getByRole("button", { name: /start secure checkout/i }).click();
    await page.waitForURL(/register\/status/);
    if (apiCounters.startRequests !== 1) throw new Error(`Expected one registration start request, saw ${apiCounters.startRequests}.`);
    if (apiCounters.checkoutRequests !== 1) throw new Error(`Expected one checkout request, saw ${apiCounters.checkoutRequests}.`);
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

console.log(`registration-browser-matrix passed ${results.length} scenarios.`);

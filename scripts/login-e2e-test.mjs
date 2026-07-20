import { spawn } from "node:child_process";
import process from "node:process";

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
      "Playwright is required for the login browser gate.",
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
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Vite login test server.")), 30_000);
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
    child.on("exit", (code) => reject(new Error(`Login test server exited early with ${code}.\n${output.trim()}`)));
  });
}

async function resolveBaseUrl() {
  if (process.env.LOGIN_BROWSER_BASE_URL) return process.env.LOGIN_BROWSER_BASE_URL.replace(/\/$/, "");
  serverProcess = spawn("npm", ["--workspace", "apps/web", "run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_API_URL: "/api", VITE_API_HEALTH_URL: "/health" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return waitForServer(serverProcess);
}

async function runLoginScenario(browserType, baseUrl) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 }
    });
    const counters = { health: 0, login: 0, me: 0 };
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/health" || url.pathname === "/api/health") {
        counters.health += 1;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, test: "login-e2e" }) });
      }
      if (url.pathname === "/api/auth/login") {
        counters.login += 1;
        const body = request.postDataJSON();
        if (body.email !== "owner@example.com" || body.password !== "CorrectHorseBattery1!") {
          return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Unexpected login payload" }) });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            accessToken: "test-access-token",
            refreshToken: "test-refresh-token",
            user: {
              id: "user-login-e2e",
              name: "Owner Example",
              email: "owner@example.com",
              role: "RESTAURANT_OWNER",
              status: "ACTIVE",
              restaurantId: "restaurant-login-e2e",
              restaurantSlug: "demo-bistro"
            },
            memberships: [
              { restaurantId: "restaurant-login-e2e", restaurantSlug: "demo-bistro", role: "RESTAURANT_OWNER" }
            ]
          })
        });
      }
      if (url.pathname === "/api/auth/me") {
        counters.me += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: "user-login-e2e",
              name: "Owner Example",
              email: "owner@example.com",
              role: "RESTAURANT_OWNER",
              status: "ACTIVE",
              restaurantId: "restaurant-login-e2e",
              restaurantSlug: "demo-bistro"
            },
            memberships: [
              { restaurantId: "restaurant-login-e2e", restaurantSlug: "demo-bistro", role: "RESTAURANT_OWNER" }
            ]
          })
        });
      }
      return route.continue();
    });

    const page = await context.newPage();
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Sign in", level: 2 }).waitFor();
    const loginButton = page.getByRole("button", { name: /login/i });
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("CorrectHorseBattery1!");
    await loginButton.waitFor({ state: "visible" });
    if (!(await loginButton.isEnabled())) throw new Error("Login button remained disabled after valid credentials when health was unavailable.");
    await loginButton.click();
    await page.waitForURL(/\/restaurant\/demo-bistro/, { timeout: 8_000 });
    if (counters.health === 0) throw new Error("Login scenario did not exercise API health polling.");
    if (counters.login !== 1) throw new Error(`Expected one /api/auth/login request, received ${counters.login}.`);
    if (counters.me < 1) throw new Error("Login did not verify the authenticated session with /api/auth/me.");
    await context.close();
  } finally {
    await browser.close();
  }
}

const playwright = await loadPlaywright();
const baseUrl = await resolveBaseUrl();
try {
  await runLoginScenario(playwright.chromium, baseUrl);
  console.log("PASS chromium login remains usable when health is unavailable");
  console.log("login-e2e passed.");
} finally {
  if (serverProcess) serverProcess.kill("SIGTERM");
}

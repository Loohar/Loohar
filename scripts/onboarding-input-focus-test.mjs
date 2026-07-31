import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";

const DEFAULT_HOURS = {
  sunday: { open: "11:00", close: "21:00", closed: false, note: "" },
  monday: { open: "11:00", close: "21:00", closed: false, note: "" },
  tuesday: { open: "11:00", close: "21:00", closed: false, note: "" },
  wednesday: { open: "11:00", close: "21:00", closed: false, note: "" },
  thursday: { open: "11:00", close: "21:00", closed: false, note: "" },
  friday: { open: "11:00", close: "22:00", closed: false, note: "" },
  saturday: { open: "11:00", close: "22:00", closed: false, note: "" }
};

const browserName = process.env.ONBOARDING_INPUT_FOCUS_BROWSER || "chromium";
const baseUrlFromEnv = process.env.ONBOARDING_INPUT_FOCUS_BASE_URL || "";
const routeSlug = "coriander";
let viteProcess = null;
let mutationRequests = 0;
let failNextPatch = false;
let serverPayload = createOnboardingPayload();

function createOnboardingPayload(overrides = {}) {
  const websiteSettings = {
    logoUrl: "https://assets.loohar.test/logo.svg",
    heroImageUrl: "https://assets.loohar.test/hero.jpg",
    mobileHeroImageUrl: "",
    faviconUrl: "",
    brandColor: "#0f766e",
    accentColor: "#2563EB",
    buttonColor: "#111827",
    headingFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
    heroTitle: "Coriander",
    heroSubtitle: "Fresh food for every table.",
    tagline: "Order direct from Coriander.",
    cuisineType: "Restaurant",
    aboutTitle: "About Coriander",
    aboutStory: "A local restaurant focused on fresh meals.",
    missionStatement: "",
    ownerStory: "",
    specialOfferText: "",
    ctaText: "Start an order",
    contactMessage: "",
    cateringMessage: "",
    publicEmail: "hello@coriander.test",
    seoTitle: "Coriander Restaurant",
    seoDescription: "Order direct from Coriander.",
    seoKeywords: "",
    canonicalUrl: "",
    ogImageUrl: "",
    indexingEnabled: true,
    storeHoursJson: DEFAULT_HOURS,
    sectionSettingsJson: {
      hero: true,
      featuredMenu: true,
      story: true,
      gallery: true,
      loyalty: true,
      catering: true,
      contact: true,
      brandPreviewMode: "desktop-public-site",
      brandPublishState: "draft",
      brandTheme: {
        mode: "SOLID",
        brandColor: "#0f766e",
        accentColor: "#2563EB",
        buttonColor: "#111827",
        headingFont: "Inter, ui-sans-serif, system-ui, sans-serif",
        bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif",
        opacity: 1,
        overlayOpacity: 0.35,
        gradientAngle: 135,
        gradientStops: [
          { color: "#0f766e", position: 0, opacity: 1 },
          { color: "#111827", position: 100, opacity: 1 }
        ]
      },
      heroMedia: {
        mode: "IMAGE",
        imageBehavior: "cover",
        transition: "fade",
        intervalSeconds: 6,
        reducedMotionFallback: true,
        slides: [
          {
            id: "slide-1",
            imageUrl: "https://assets.loohar.test/hero.jpg",
            mobileImageUrl: "",
            title: "Welcome",
            altText: "Dining room",
            published: true
          }
        ],
        video: { url: "", posterUrl: "", captionsUrl: "", muted: true, loop: true, controls: false }
      }
    }
  };

  return {
    restaurant: {
      id: "restaurant-focus",
      name: "Coriander LLC.",
      businessName: "Coriander LLC.",
      publicBusinessName: "Coriander",
      slug: routeSlug,
      businessType: "RESTAURANT",
      categoryLabel: "Restaurant",
      description: "Initial restaurant description.",
      email: "hello@coriander.test",
      businessEmail: "hello@coriander.test",
      phone: "3035550101",
      address: "100 Main St",
      city: "Denver",
      state: "CO",
      zip: "80202",
      timezone: "America/Denver",
      pickupEnabled: true,
      deliveryEnabled: true,
      deliveryFeeCents: 399,
      deliveryRadiusMiles: 3,
      plan: "STARTER",
      settingsJson: {
        categoryLabel: "Restaurant",
        minimumOrderCents: 1500,
        averagePrepMinutes: 20,
        tipsEnabled: true
      }
    },
    owner: { name: "Coriander Owner", email: "development@loohar.com", phone: "3035550101" },
    website: websiteSettings,
    domain: {
      defaultSubdomain: routeSlug,
      customDomain: "",
      dnsTarget: "cname.vercel-dns.com",
      defaultUrl: `https://${routeSlug}.loohar.com`
    },
    categories: [
      {
        id: "cat-1",
        name: "Lunch",
        items: [
          {
            id: "item-1",
            name: "Rice Bowl",
            description: "Herbed rice, vegetables, and sauce.",
            priceCents: 1295,
            imageUrl: "https://assets.loohar.test/item.jpg",
            available: true
          }
        ]
      }
    ],
    gallery: [
      {
        id: "gallery-1",
        imageUrl: "https://assets.loohar.test/gallery.jpg",
        title: "",
        altText: "",
        caption: "",
        category: "food",
        sortOrder: 0,
        published: true
      }
    ],
    socialLinks: [],
    deliveryZones: [
      {
        id: "zone-1",
        name: "Local Delivery",
        radiusMiles: 3,
        deliveryFeeCents: 399,
        minimumOrderCents: 1500
      }
    ],
    readiness: {
      websiteReady: false,
      orderingReady: false,
      completionPercentage: 40,
      paymentStatus: "NOT_CONNECTED",
      sections: {
        business: false,
        owner: false,
        branding: false,
        content: false,
        hours: false,
        fulfillment: false,
        menu: false,
        gallery: false,
        domain: false,
        payments: false,
        review: false
      },
      blockers: [],
      warnings: [],
      counts: { activeCategories: 1, availableItems: 1 }
    },
    progress: { currentStep: "business" },
    ...overrides
  };
}

const testUser = {
  id: "user-owner-focus",
  name: "Coriander Owner",
  email: "development@loohar.com",
  role: "TENANT_OWNER",
  status: "ACTIVE",
  restaurantId: "restaurant-focus",
  restaurantSlug: routeSlug,
  restaurantName: "Coriander LLC.",
  onboardingStatus: "IN_PROGRESS",
  onboardingCurrentStep: "business"
};

const testMembership = {
  tenantId: "restaurant-focus",
  tenantSlug: routeSlug,
  tenantName: "Coriander LLC.",
  role: "TENANT_OWNER",
  status: "ACTIVE",
  onboardingStatus: "IN_PROGRESS",
  onboardingCurrentStep: "business"
};

function applyStepPatch(step, body = {}) {
  if (step === "business") {
    Object.assign(serverPayload.restaurant, {
      businessName: body.businessName ?? serverPayload.restaurant.businessName,
      publicBusinessName: body.publicBusinessName ?? serverPayload.restaurant.publicBusinessName,
      businessType: body.businessType ?? serverPayload.restaurant.businessType,
      categoryLabel: body.categoryLabel ?? serverPayload.restaurant.categoryLabel,
      description: body.description ?? serverPayload.restaurant.description,
      businessEmail: body.businessEmail ?? serverPayload.restaurant.businessEmail,
      email: body.businessEmail ?? serverPayload.restaurant.email,
      phone: body.phone ?? serverPayload.restaurant.phone,
      address: body.address ?? serverPayload.restaurant.address,
      city: body.city ?? serverPayload.restaurant.city,
      state: body.state ?? serverPayload.restaurant.state,
      zip: body.zip ?? serverPayload.restaurant.zip,
      timezone: body.timezone ?? serverPayload.restaurant.timezone
    });
  }
  if (step === "owner") {
    serverPayload.owner = { ...serverPayload.owner, ...body };
  }
  if (step === "branding" || step === "content" || step === "domain") {
    serverPayload.website = { ...serverPayload.website, ...body };
    if (body.defaultSubdomain || body.customDomain) {
      serverPayload.domain = { ...serverPayload.domain, ...body };
    }
  }
  if (step === "hours") {
    serverPayload.website.storeHoursJson = body.storeHoursJson || serverPayload.website.storeHoursJson;
  }
  if (step === "fulfillment") {
    Object.assign(serverPayload.restaurant, {
      pickupEnabled: body.pickupEnabled ?? serverPayload.restaurant.pickupEnabled,
      deliveryEnabled: body.deliveryEnabled ?? serverPayload.restaurant.deliveryEnabled,
      deliveryFeeCents: body.deliveryFeeCents ?? serverPayload.restaurant.deliveryFeeCents,
      deliveryRadiusMiles: body.deliveryRadiusMiles ?? serverPayload.restaurant.deliveryRadiusMiles
    });
  }
  serverPayload.readiness = {
    ...serverPayload.readiness,
    sections: { ...serverPayload.readiness.sections, [step]: true },
    completionPercentage: Math.max(serverPayload.readiness.completionPercentage, 55)
  };
  serverPayload.progress = { currentStep: step };
}

async function startViteServer() {
  if (baseUrlFromEnv) return baseUrlFromEnv.replace(/\/+$/, "");

  viteProcess = spawn("npm", ["--workspace", "apps/web", "run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_API_URL: "/api", VITE_API_HEALTH_URL: "/health" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for Vite server.\n${output}`));
    }, 30000);

    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/) || output.match(/Local:\s+(http:\/\/localhost:\d+\/)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1].replace(/\/+$/, ""));
      }
    };

    viteProcess.stdout.on("data", onData);
    viteProcess.stderr.on("data", onData);
    viteProcess.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    viteProcess.once("exit", (code) => {
      if (code) {
        clearTimeout(timeout);
        reject(new Error(`Vite exited with code ${code}.\n${output}`));
      }
    });
  });
}

function stopViteServer() {
  if (!viteProcess || viteProcess.killed) return;
  viteProcess.kill("SIGTERM");
}

function selectorForField(field) {
  return `[data-onboarding-field="${field}"]`;
}

function stepButtonPattern(label) {
  return new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

async function routeApi(page) {
  await page.route("**://assets.loohar.test/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"80\"><rect width=\"120\" height=\"80\" fill=\"#0f766e\"/></svg>"
    });
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/health" || path === "/api/health") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, service: "api" }) });
      return;
    }
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    if (path === "/api/auth/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: testUser, memberships: [testMembership] }) });
      return;
    }
    if (path === "/api/platform-billing/subscription") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ subscription: { status: "TRIALING", plan: { code: "STARTER" }, currentPeriodEnd: "2026-10-27T00:00:00.000Z" } })
      });
      return;
    }
    if (path === "/api/order-payments/merchant-account") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ merchantAccount: { status: "NOT_STARTED", stripeChargesEnabled: false, stripePayoutsEnabled: false } })
      });
      return;
    }
    if (path === `/api/restaurants/${routeSlug}/onboarding` && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(serverPayload) });
      return;
    }
    const stepMatch = path.match(new RegExp(`^/api/restaurants/${routeSlug}/onboarding/([^/]+)$`));
    if (stepMatch && request.method() === "PATCH") {
      mutationRequests += 1;
      if (failNextPatch) {
        failNextPatch = false;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Synthetic save failure" }) });
        return;
      }
      const postData = request.postData();
      const body = postData ? JSON.parse(postData) : {};
      applyStepPatch(stepMatch[1], body);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(serverPayload) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: `Unhandled test route: ${request.method()} ${path}` }) });
  });
}

async function openStep(page, label) {
  await page.getByRole("button", { name: stepButtonPattern(label) }).click();
  await page.getByRole("heading", { name: label }).waitFor({ state: "visible" });
}

async function fieldHandle(page, field) {
  const locator = page.locator(selectorForField(field)).first();
  await locator.waitFor({ state: "visible" });
  return { locator, handle: await locator.elementHandle() };
}

async function assertSameFocusedNode(handle, selector, label) {
  const sameNodeAndFocus = await handle.evaluate((node, fieldSelector) => document.querySelector(fieldSelector) === node && document.activeElement === node, selector);
  assert.equal(sameNodeAndFocus, true, `${label} should keep the same focused DOM node`);
}

async function typeIntoField(page, field, value, label = field) {
  const selector = selectorForField(field);
  const { locator } = await fieldHandle(page, field);
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await locator.fill("");
  const { locator: editableLocator, handle } = await fieldHandle(page, field);
  await editableLocator.click();
  for (const character of value) {
    await page.keyboard.type(character);
    await assertSameFocusedNode(handle, selector, label);
  }
  await assert.equal(await editableLocator.inputValue(), value, `${label} should contain typed text`);
}

async function pasteIntoField(page, field, value, label = field) {
  const selector = selectorForField(field);
  const { locator, handle } = await fieldHandle(page, field);
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await page.evaluate((text) => navigator.clipboard.writeText(text), value).catch(async () => {
    await locator.fill(value);
  });
  await locator.evaluate((node) => {
    node.focus();
    if (typeof node.select === "function") node.select();
  });
  await page.keyboard.press("Backspace");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V").catch(async () => {
    await locator.fill(value);
  });
  await assertSameFocusedNode(handle, selector, label);
  assert.equal(await locator.inputValue(), value, `${label} should contain pasted text`);
}

async function replaceSelection(page, field, initialValue, replacement, start, end, expected, label = field) {
  const selector = selectorForField(field);
  const { locator, handle } = await fieldHandle(page, field);
  await locator.click();
  await locator.evaluate((node) => {
    node.focus();
    if (typeof node.select === "function") node.select();
  });
  await page.keyboard.type(initialValue);
  await locator.evaluate((node, range) => node.setSelectionRange(range.start, range.end), { start, end });
  await page.keyboard.type(replacement);
  await assertSameFocusedNode(handle, selector, label);
  assert.equal(await locator.inputValue(), expected, `${label} should support replacing selected text`);
}

async function arrowAndBackspace(page, field, value, expected, label = field) {
  const selector = selectorForField(field);
  const { locator, handle } = await fieldHandle(page, field);
  await locator.click();
  await locator.evaluate((node) => {
    node.focus();
    if (typeof node.select === "function") node.select();
  });
  await page.keyboard.type(value);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await assertSameFocusedNode(handle, selector, label);
  assert.equal(await locator.inputValue(), expected, `${label} should support arrow/backspace editing`);
}

async function selectField(page, field, value, label = field) {
  const selector = selectorForField(field);
  const { locator, handle } = await fieldHandle(page, field);
  await locator.selectOption(value);
  const sameNode = await handle.evaluate((node, fieldSelector) => document.querySelector(fieldSelector) === node, selector);
  assert.equal(sameNode, true, `${label} select should not be replaced`);
  assert.equal(await locator.inputValue(), value, `${label} should keep selected value`);
}

async function expectNoApiMutations(label) {
  assert.equal(mutationRequests, 0, `${label} should not call save APIs while typing`);
}

async function run() {
  const { [browserName]: browserLauncher } = await import("playwright");
  if (!browserLauncher) throw new Error(`Unknown Playwright browser: ${browserName}`);

  const baseUrl = await startViteServer();
  const browser = await browserLauncher.launch();
  const context = await browser.newContext({ baseURL: baseUrl });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl }).catch(() => {});
  await context.addInitScript((payload) => {
    window.localStorage.setItem("accessToken", "focus-access-token");
    window.localStorage.setItem("refreshToken", "focus-refresh-token");
    window.localStorage.setItem("user", JSON.stringify(payload.user));
  }, { user: testUser });
  const page = await context.newPage();
  await routeApi(page);

  await page.goto(`/restaurant/${routeSlug}/onboarding`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Business" }).waitFor({ state: "visible" });

  await typeIntoField(page, "description", "Development Restaurant serves fresh meals daily.", "business description");
  await expectNoApiMutations("Business step typing");

  await openStep(page, "Owner");
  await typeIntoField(page, "ownerPhone", "303-555-0199", "owner phone");
  await expectNoApiMutations("Owner step typing");

  await openStep(page, "Branding");
  await selectField(page, "brandPreviewMode", "mobile-ordering", "brand preview mode");
  await selectField(page, "headingFont", "\"Playfair Display\", Georgia, serif", "heading font");
  await selectField(page, "bodyFont", "Inter, ui-sans-serif, system-ui, sans-serif", "body font");
  await typeIntoField(page, "brandColor", "#123456", "brand color");
  await typeIntoField(page, "accentColor", "#234567", "accent color");
  await typeIntoField(page, "buttonColor", "#345678", "button color");
  await selectField(page, "brand-color-mode", "LINEAR_GRADIENT", "brand color mode");
  const gradientColor = await fieldHandle(page, "brand-gradient-color-0");
  await gradientColor.locator.click();
  await assertSameFocusedNode(gradientColor.handle, selectorForField("brand-gradient-color-0"), "gradient color");
  await selectField(page, "heroMediaMode", "VIDEO", "hero media mode");
  await typeIntoField(page, "hero-video-url", "https://cdn.example.com/hero.mp4", "hero video URL");
  await expectNoApiMutations("Branding step typing");

  await openStep(page, "Content");
  await typeIntoField(page, "heroTitle", "Coriander Direct", "hero title");
  await typeIntoField(page, "tagline", "Local food, direct ordering.", "tagline");
  await typeIntoField(page, "cuisineType", "Modern Nepali", "cuisine type");
  await typeIntoField(page, "ctaText", "Order direct", "CTA text");
  await pasteIntoField(page, "heroSubtitle", "Fresh meals, pickup, and delivery from one local restaurant.", "hero subtitle paste");
  await typeIntoField(page, "aboutStory", "We built Coriander for regulars who want a simple way to order directly.", "about story");
  await replaceSelection(page, "missionStatement", "Serve every guest quickly", "local guest", 12, 17, "Serve every local guest quickly", "mission statement");
  await arrowAndBackspace(page, "ownerStory", "Owner story", "Owner stoy", "owner story");
  await typeIntoField(page, "specialOfferText", "Free delivery this week.", "special offer");
  await typeIntoField(page, "contactMessage", "Call us for questions.", "contact message");
  await typeIntoField(page, "cateringMessage", "Catering for teams and family events.", "catering message");
  await expectNoApiMutations("Content step typing");

  await openStep(page, "Hours");
  await typeIntoField(page, "hours-note-monday", "Closed early on holidays.", "Monday hours note");
  await expectNoApiMutations("Hours step typing");

  await openStep(page, "Menu");
  await typeIntoField(page, "menu-category-name", "Dinner specials", "quick category");
  await typeIntoField(page, "menu-item-name", "Spiced momo", "quick item name");
  await typeIntoField(page, "menu-item-description", "Steamed dumplings with house sauce.", "quick item description");
  await typeIntoField(page, "menu-item-price-cents", "1495", "quick item price");
  await expectNoApiMutations("Menu step typing");

  await openStep(page, "Gallery & Social");
  await typeIntoField(page, "gallery-title-gallery-1", "Chef specials", "gallery title");
  await typeIntoField(page, "gallery-category-gallery-1", "dining", "gallery category");
  await typeIntoField(page, "gallery-alt-gallery-1", "A plated house special.", "gallery alt text");
  await typeIntoField(page, "gallery-caption-gallery-1", "A guest favorite for dinner.", "gallery caption");
  await selectField(page, "social-platform", "facebook", "social platform");
  await typeIntoField(page, "social-url", "https://facebook.com/coriander", "social URL");
  await expectNoApiMutations("Gallery step typing");

  await openStep(page, "Domain & SEO");
  await typeIntoField(page, "seoTitle", "Coriander Direct Ordering", "SEO title");
  await typeIntoField(page, "seoDescription", "Order pickup and delivery directly from Coriander.", "SEO description");
  await typeIntoField(page, "seoKeywords", "restaurant, pickup, delivery", "SEO keywords");
  await typeIntoField(page, "customDomain", "coriander.example.com", "custom domain");
  await expectNoApiMutations("Domain step typing");

  await openStep(page, "Business");
  await typeIntoField(page, "description", "Unsaved local draft survives refetch.", "dirty draft description");
  serverPayload = createOnboardingPayload({
    restaurant: { ...serverPayload.restaurant, description: "Server overwrite should not win." },
    progress: { currentStep: "business" }
  });
  await page.evaluate(() => window.dispatchEvent(new Event("loohar:onboarding-refetch")));
  await page.getByText(/Fresh server data is available\. Save your current edits before reloading this step\./i).waitFor({ state: "visible" });
  assert.equal(await page.locator(selectorForField("description")).inputValue(), "Unsaved local draft survives refetch.", "Dirty draft survives background refresh");

  await openStep(page, "Domain & SEO");
  await typeIntoField(page, "seoTitle", "Failure Preserves Title", "SEO title failure setup");
  failNextPatch = true;
  await page.getByRole("button", { name: /save step/i }).click();
  await page.locator(".error-box", { hasText: "Synthetic save failure" }).waitFor({ state: "visible" });
  assert.equal(await page.locator(selectorForField("seoTitle")).inputValue(), "Failure Preserves Title", "Failed save preserves typed text");

  await openStep(page, "Business");
  await typeIntoField(page, "description", "Saved onboarding copy persists after refresh.", "saved description");
  await page.getByRole("button", { name: /save step/i }).click();
  await page.getByText("Business saved.", { exact: true }).waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Business" }).waitFor({ state: "visible" });
  assert.equal(await page.locator(selectorForField("description")).inputValue(), "Saved onboarding copy persists after refresh.", "Successful save persists after refresh");

  await openStep(page, "Branding");
  await page.getByRole("button", { name: /save step/i }).click();
  const visibleBrandingSavedMessage = page.locator('div[role="status"].rounded-md', { hasText: "Branding saved." });
  await visibleBrandingSavedMessage.waitFor({ state: "visible" });
  await openStep(page, "Owner");
  await assert.equal(await visibleBrandingSavedMessage.count(), 0, "Branding saved message does not leak into Owner step");

  await browser.close();
  stopViteServer();
  console.log("Onboarding input focus browser test passed.");
}

run().catch((error) => {
  stopViteServer();
  console.error(error);
  process.exit(1);
});

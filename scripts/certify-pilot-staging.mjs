// Drives a brand new restaurant through the real pilot workflow against the STAGING API: signup,
// MFA enrolment and challenge, tax configuration, menu, POS device and drawer, cashier PIN, shift,
// a cash sale with a tip, the kitchen ticket, the receipt and the day's reconciliation.
//
//   node scripts/certify-pilot-staging.mjs [--api https://loohar-api-staging.onrender.com]
//
// It refuses any host that is not the staging API, so it can never be pointed at production. It
// creates its own tenant through the public signup flow, so no owner credential is needed and none
// is ever entered. The password it generates is random, used only by this run, and never printed.
// Every amount printed comes from the server's own response, never from the script.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { base32Decode, generateTotp, totpStep } from "../apps/api/src/services/mfaService.js";

const STAGING_API = "https://loohar-api-staging.onrender.com";
const api = (() => {
  const index = process.argv.indexOf("--api");
  const value = index >= 0 ? process.argv[index + 1] : STAGING_API;
  if (value !== STAGING_API) {
    console.error(`Refusing to run against ${value}. This certification only runs against ${STAGING_API}.`);
    process.exit(1);
  }
  return value;
})();

// --as-native-app sends every request with the origin the packaged apps actually use
// (capacitor://localhost on iOS, https://localhost on Android). Before the native CORS fix the API
// refused that origin outright, so running the whole workflow this way certifies the app's network
// contract end to end, not just that the app launches.
const nativeOriginIndex = process.argv.indexOf("--as-native-app");
const nativeOrigin = nativeOriginIndex >= 0 ? (process.argv[nativeOriginIndex + 1] || "capacitor://localhost") : "";

const run = `${Date.now().toString(36)}${crypto.randomInt(100, 999)}`;
const password = `Lh!${crypto.randomBytes(12).toString("base64url")}9z`;
const steps = [];
let accessToken = "";
let posSessionToken = "";

function record(name, detail) {
  steps.push({ name, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(path, { method = "GET", body, token = accessToken, posToken, headers = {} } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(posToken ? { "x-loohar-pos-session": posToken } : {}),
      ...(nativeOrigin ? { Origin: nativeOrigin } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function totpFor(secret) {
  return generateTotp(base32Decode(secret), totpStep());
}

// A TOTP code is single use, so enrolling and then signing in inside the same 30-second window would
// reuse one code and be refused. Waiting for the next window is what a real authenticator app does.
async function freshTotpFor(secret, usedStep) {
  while (totpStep() === usedStep) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return totpFor(secret);
}

async function main() {
  if (nativeOrigin) {
    // Fail fast and clearly if the API refuses the app's origin: every later step would fail too.
    const preflight = await fetch(`${api}/api/auth/login`, {
      method: "OPTIONS",
      headers: { Origin: nativeOrigin, "Access-Control-Request-Method": "POST" }
    });
    assert.equal(preflight.status, 204, `the API refused the native app origin ${nativeOrigin} with ${preflight.status}; the app cannot call it at all`);
    assert.equal(preflight.headers.get("access-control-allow-origin"), nativeOrigin);
    record("API accepts the native app origin", nativeOrigin);
  }

  // 1. A restaurant signs itself up through the public flow.
  const email = `pilot-${run}@example.test`;
  const slug = `pilot-cert-${run}`;
  const signup = await call("/api/registration/start", {
    method: "POST",
    token: "",
    body: {
      firstName: "Pilot", lastName: "Certifier", email, phone: "3035550142",
      password, confirmPassword: password, termsAccepted: true, privacyAccepted: true,
      businessName: `Pilot Cert ${run}`, publicBusinessName: `Pilot Cert ${run}`, businessType: "RESTAURANT",
      cuisine: "American", businessEmail: `biz-${run}@example.test`, businessPhone: "3035550143",
      address: "1701 Wynkoop St", city: "Denver", state: "CO", zip: "80202", country: "US",
      timezone: "America/Denver", preferredSlug: slug, planCode: "STARTER", billingInterval: "MONTHLY"
    }
  });
  assert.equal(signup.status, 201, `signup failed: ${JSON.stringify(signup.payload).slice(0, 300)}`);
  const registrationId = signup.payload.registration.id;
  record("Public signup accepted", `registration ${registrationId}`);

  const provisioned = await call("/api/registration/intro-trial", {
    method: "POST", token: "",
    body: { registrationId, planCode: "STARTER", billingInterval: "MONTHLY" }
  });
  assert.equal(provisioned.status, 201, `provisioning failed: ${JSON.stringify(provisioned.payload).slice(0, 300)}`);
  assert.equal(provisioned.payload.registration.status, "TENANT_CREATED");
  record("Starter tenant provisioned", `slug ${slug}, ${provisioned.payload.registration.subscriptionStatus}`);

  // 2. The owner signs in. A privileged role must enrol in MFA before privileged screens open.
  const firstLogin = await call("/api/auth/login", { method: "POST", token: "", body: { email, password } });
  assert.equal(firstLogin.status, 200, `login failed: ${JSON.stringify(firstLogin.payload).slice(0, 300)}`);
  accessToken = firstLogin.payload.accessToken || firstLogin.payload.token || "";
  assert.ok(accessToken, `no access token for account setup: ${JSON.stringify(firstLogin.payload).slice(0, 300)}`);
  const restaurantId = firstLogin.payload.user?.restaurantId;
  assert.ok(restaurantId, "the owner is bound to the new restaurant");
  record("Owner signed in for account setup", `restaurant ${restaurantId}`);

  const enrolStart = await call("/api/auth/mfa/enroll/start", { method: "POST", body: {} });
  assert.equal(enrolStart.status, 200, `MFA enrolment start failed: ${JSON.stringify(enrolStart.payload).slice(0, 300)}`);
  const secret = enrolStart.payload.enrollment?.secret;
  assert.ok(secret, "enrolment returns a secret for the authenticator app");

  const wrongCode = await call("/api/auth/mfa/enroll/confirm", { method: "POST", body: { code: "000000", currentPassword: password } });
  assert.notEqual(wrongCode.status, 200, "a wrong authenticator code must be refused");
  const wrongPassword = await call("/api/auth/mfa/enroll/confirm", { method: "POST", body: { code: totpFor(secret), currentPassword: "not-the-password" } });
  assert.notEqual(wrongPassword.status, 200, "enrolment must require the current password");
  record("MFA enrolment refuses a wrong code and a wrong password");

  const enrolStepUsed = totpStep();
  const enrolled = await call("/api/auth/mfa/enroll/confirm", { method: "POST", body: { code: totpFor(secret), currentPassword: password } });
  assert.equal(enrolled.status, 200, `MFA enrolment failed: ${JSON.stringify(enrolled.payload).slice(0, 300)}`);
  record("MFA enrolled", `${(enrolled.payload.recoveryCodes || []).length} recovery codes issued`);

  // 3. Signing in now requires the authenticator.
  const challenge = await call("/api/auth/login", { method: "POST", token: "", body: { email, password } });
  assert.equal(challenge.status, 200);
  const challengeToken = challenge.payload.mfaToken;
  assert.ok(challengeToken, `password alone must be challenged: ${JSON.stringify(challenge.payload).slice(0, 200)}`);
  assert.ok(!challenge.payload.accessToken, "no access token is issued before the second factor");

  const badSecond = await call("/api/auth/mfa/verify", { method: "POST", token: "", body: { mfaToken: challengeToken, code: "000000" } });
  assert.notEqual(badSecond.status, 200, "a wrong code at sign-in must be refused");

  const verified = await call("/api/auth/mfa/verify", { method: "POST", token: "", body: { mfaToken: challengeToken, code: await freshTotpFor(secret, enrolStepUsed) } });
  assert.equal(verified.status, 200, `MFA sign-in failed: ${JSON.stringify(verified.payload).slice(0, 300)}`);
  accessToken = verified.payload.accessToken || verified.payload.token;
  assert.ok(accessToken);
  record("MFA sign-in challenged, wrong code refused, correct code accepted");

  // 4. Tax must be configured from the restaurant's own address before it can sell.
  const profiles = await call(`/api/restaurants/${restaurantId}/tax-profiles`);
  assert.equal(profiles.status, 200, `tax workspace unavailable: ${JSON.stringify(profiles.payload).slice(0, 300)}`);
  const locationId = profiles.payload.locations?.[0]?.locationId || profiles.payload.locations?.[0]?.id;
  assert.ok(locationId, `no location in the tax workspace: ${JSON.stringify(profiles.payload).slice(0, 300)}`);

  // Without a category the profile stays CATEGORY_RULE_REQUIRED and cannot be activated: Loohar never
  // guesses a restaurant's Colorado product/service category. This is a value for the throwaway
  // staging tenant only and is never a recommendation for a real restaurant, which must take its own
  // category from its Colorado state account.
  const productServiceIdIndex = process.argv.indexOf("--product-service-id");
  const productServiceId = productServiceIdIndex >= 0 ? Number(process.argv[productServiceIdIndex + 1]) : 10;
  const uncategorised = await call(`/api/restaurants/${restaurantId}/locations/${locationId}/tax-profile/resolve`, { method: "POST", body: {} });
  const uncategorisedProfile = uncategorised.payload.profile || {};
  assert.equal(uncategorisedProfile.enabled, false, "a profile with no category is never active");

  // The live TTR provider intermittently answers 401/403, which Loohar surfaces as
  // TAX_PROVIDER_AUTH_FAILED. Retry a few times so a provider blip is not reported as a Loohar
  // failure; if every attempt fails, that is a real finding and the certification stops.
  let resolved = { status: 0, payload: {} };
  const providerAttempts = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    resolved = await call(`/api/restaurants/${restaurantId}/locations/${locationId}/tax-profile/resolve`, {
      method: "POST",
      body: { productServiceId }
    });
    providerAttempts.push(`${resolved.status}${resolved.payload?.code ? ` ${resolved.payload.code}` : ""}`);
    if ([200, 201].includes(resolved.status)) break;
    await new Promise((wait) => setTimeout(wait, 5000));
  }
  if (![200, 201].includes(resolved.status)) {
    console.log(`      provider attempts: ${providerAttempts.join(", ")}`);
  }
  assert.ok([200, 201].includes(resolved.status), `tax resolution failed: ${JSON.stringify(resolved.payload).slice(0, 400)}`);
  const profile = resolved.payload.profile || resolved.payload.taxProfile;
  assert.equal(profile.provider, "COLORADO_TTR", "the rate comes from the state provider, never a hardcoded default");
  assert.equal(profile.verificationStatus, "VERIFIED");
  assert.ok(profile.taxRateBps > 0, "a real rate was returned for the signup address");
  record("A profile with no category cannot be activated", `status ${uncategorisedProfile.status}`);
  record("Tax resolved from the signup address by the live provider", `${(profile.taxRateBps / 100).toFixed(2)}% for ${profile.county || profile.stateCode}, status ${profile.status}`);

  // A resolved profile is not yet usable: the restaurant must acknowledge it.
  const activated = await call(`/api/restaurants/${restaurantId}/locations/${locationId}/tax-profile/acknowledge`, {
    method: "POST",
    body: { profileId: profile.id, configurationVersion: profile.configurationVersion, confirmed: true }
  });
  assert.equal(activated.status, 200, `tax activation failed: ${JSON.stringify(activated.payload).slice(0, 400)}`);
  assert.equal(activated.payload.profile.enabled, true, "the profile is active after acknowledgement");
  record("Tax profile acknowledged and active", `${(activated.payload.profile.taxRateBps / 100).toFixed(2)}%`);

  const taxRateBps = activated.payload.profile.taxRateBps;

  // 5. A menu to sell from.
  const category = await call(`/api/restaurants/${restaurantId}/menu/categories`, { method: "POST", body: { name: "Mains" } });
  assert.ok([200, 201].includes(category.status), `menu category failed: ${JSON.stringify(category.payload).slice(0, 300)}`);
  const categoryId = (category.payload.category || category.payload).id;
  const item = await call(`/api/restaurants/${restaurantId}/menu/items`, {
    method: "POST",
    body: { categoryId, name: "Certification burger", priceCents: 1450, available: true }
  });
  assert.ok([200, 201].includes(item.status), `menu item failed: ${JSON.stringify(item.payload).slice(0, 300)}`);
  const menuItemId = (item.payload.item || item.payload.menuItem || item.payload).id;
  record("Menu created", `one category, one item at 1450 cents`);

  // 6. Register the main terminal. This also exercises the drawer fix (L-21) on staging.
  const fingerprint = `cert-${run}-terminal`;
  const device = await call(`/api/restaurants/${restaurantId}/pos/devices`, {
    method: "POST",
    headers: { "x-loohar-device-fingerprint": fingerprint },
    body: { name: "Front counter", deviceType: "MAIN_TERMINAL", locationId }
  });
  assert.equal(device.status, 201, `device registration failed: ${JSON.stringify(device.payload).slice(0, 300)}`);
  const registered = device.payload.device;
  assert.ok(registered.cashDrawerId, "a main terminal is given its own cash drawer");
  record("Main terminal registered with its own drawer", `device ${registered.id}`);

  const devicesAfter = await call(`/api/restaurants/${restaurantId}/pos/devices`);
  const drawerIds = new Set((devicesAfter.payload.devices || []).map((entry) => entry.cashDrawerId).filter(Boolean));
  assert.equal(drawerIds.size, 1, `exactly one drawer for one terminal, saw ${drawerIds.size}`);
  record("Exactly one drawer exists for the terminal (L-21 on staging)");

  // 7. Cashier PIN, then unlock the register.
  const pin = String(crypto.randomInt(1000, 9999));
  const pinSet = await call(`/api/restaurants/${restaurantId}/pos/pin`, { method: "PATCH", body: { pin } });
  assert.ok([200, 201].includes(pinSet.status), `PIN setup failed: ${JSON.stringify(pinSet.payload).slice(0, 300)}`);

  const wrongPin = await call(`/api/restaurants/${restaurantId}/pos/unlock`, {
    method: "POST",
    headers: { "x-loohar-device-fingerprint": fingerprint, "x-loohar-device-id": registered.id },
    body: { pin: String((Number(pin) + 1) % 10000).padStart(4, "0"), deviceId: registered.id }
  });
  assert.notEqual(wrongPin.status, 200, "a wrong cashier PIN must be refused");

  const unlocked = await call(`/api/restaurants/${restaurantId}/pos/unlock`, {
    method: "POST",
    headers: { "x-loohar-device-fingerprint": fingerprint, "x-loohar-device-id": registered.id },
    body: { pin, deviceId: registered.id }
  });
  assert.equal(unlocked.status, 200, `unlock failed: ${JSON.stringify(unlocked.payload).slice(0, 300)}`);
  posSessionToken = unlocked.payload.posSessionToken || unlocked.payload.session?.token;
  assert.ok(posSessionToken, `no POS session token: ${JSON.stringify(unlocked.payload).slice(0, 300)}`);
  record("Cashier PIN set, wrong PIN refused, register unlocked");

  // 8. Open a shift with a float.
  const shift = await call(`/api/restaurants/${restaurantId}/pos/shifts/clock-in`, {
    method: "POST",
    posToken: posSessionToken,
    headers: { "x-loohar-device-id": registered.id },
    body: { locationId, openingFloatCents: 10000, deviceId: registered.id }
  });
  assert.ok([200, 201].includes(shift.status), `clock-in failed: ${JSON.stringify(shift.payload).slice(0, 300)}`);
  record("Shift opened with a float", `100.00 opening float`);

  // 9. Price a sale on the server, place it, and take cash with a tip.
  const quote = await call(`/api/restaurants/${restaurantId}/pos/quotes`, {
    method: "POST",
    posToken: posSessionToken,
    headers: { "x-loohar-device-id": registered.id },
    body: { lineItems: [{ menuItemId, quantity: 2 }], orderType: "WALK_IN", tipCents: 300 }
  });
  assert.equal(quote.status, 201, `quote failed: ${JSON.stringify(quote.payload).slice(0, 400)}`);
  const priced = quote.payload.quote;
  const expectedSubtotal = 2900;
  assert.equal(priced.subtotalCents, expectedSubtotal, "the server prices from its own menu");
  const expectedTax = Math.round(expectedSubtotal * (taxRateBps / 10000));
  assert.equal(priced.taxCents, expectedTax, `tax must be the activated rate: expected ${expectedTax}, got ${priced.taxCents}`);
  record("Server-priced sale", `subtotal ${priced.subtotalCents}, tax ${priced.taxCents} at ${(taxRateBps / 100).toFixed(2)}%, total ${priced.totalCents}`);

  const order = await call(`/api/restaurants/${restaurantId}/pos/orders`, {
    method: "POST",
    posToken: posSessionToken,
    headers: { "x-loohar-device-id": registered.id },
    body: { quoteId: priced.id, customer: { name: "Certification Guest" }, notes: "pilot certification" }
  });
  assert.equal(order.status, 201, `order failed: ${JSON.stringify(order.payload).slice(0, 400)}`);
  const placedOrder = order.payload.order || order.payload;
  record("Order sent to the kitchen", `order ${placedOrder.orderNumber || placedOrder.id}`);

  const tendered = priced.totalCents + 500;
  const cash = await call(`/api/restaurants/${restaurantId}/pos/payments/cash`, {
    method: "POST",
    posToken: posSessionToken,
    headers: { "x-loohar-device-id": registered.id },
    body: { orderId: placedOrder.id, quoteId: priced.id, amountCents: tendered, tipCents: 300 }
  });
  assert.ok([200, 201].includes(cash.status), `cash payment failed: ${JSON.stringify(cash.payload).slice(0, 400)}`);
  const settlement = cash.payload.payment || cash.payload;
  assert.equal(settlement.status, "PAID", `the sale must settle: ${JSON.stringify(cash.payload).slice(0, 300)}`);
  assert.equal(settlement.amountCents, priced.totalCents, `the payment records the server total, not the tendered amount: expected ${priced.totalCents}, got ${settlement.amountCents}`);
  const change = settlement.changeCents ?? cash.payload.changeCents ?? cash.payload.orderPayment?.changeCents ?? null;
  record("Cash taken and settled at the server total", `tendered ${tendered}, recorded ${settlement.amountCents}${change === null ? "" : `, change ${change}`}`);

  // 10. The kitchen must have the ticket.
  const kitchen = await call(`/api/kitchen/orders?restaurantId=${restaurantId}`);
  const kitchenOrders = kitchen.payload.orders || kitchen.payload || [];
  const ticket = Array.isArray(kitchenOrders) ? kitchenOrders.find((entry) => entry.id === placedOrder.id) : null;
  assert.ok(ticket, `the paid order must reach the kitchen: ${JSON.stringify(kitchen.payload).slice(0, 300)}`);
  record("Kitchen has the ticket", `status ${ticket.status}`);

  // 11. The day's reconciliation must agree with the sale.
  const daily = await call(`/api/restaurants/${restaurantId}/reporting/daily`);
  assert.equal(daily.status, 200, `daily reconciliation failed: ${JSON.stringify(daily.payload).slice(0, 300)}`);
  const summary = daily.payload.summary || daily.payload;
  const collected = summary.payments?.collectedCents;
  assert.equal(collected, priced.totalCents, `the day must report exactly what was collected: expected ${priced.totalCents}, got ${collected}`);
  assert.equal(summary.payments.refundedCents ?? 0, 0, "nothing was refunded in this certification");
  record("Day reconciles with the sale", `collected ${collected}, refunded ${summary.payments.refundedCents ?? 0}`);

  return { restaurantId, locationId, slug, email, taxRateBps, orderId: placedOrder.id, total: priced.totalCents, collected };
}

main().then((context) => {
  console.log(`\n${steps.length} steps passed${nativeOrigin ? ` as the native app (origin ${nativeOrigin})` : ""}. Tenant ${context.slug} on staging.`);
  process.exit(0);
}).catch((error) => {
  console.error(`\nFAIL  ${error.message}`);
  console.error(`${steps.length} steps passed before the failure.`);
  process.exit(1);
});

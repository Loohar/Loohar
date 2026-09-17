#!/usr/bin/env node
// Captures the staging evidence that needs a privileged sign-in, without any credential reaching a
// transcript. Run it yourself:
//
//   node scripts/staging-privileged-evidence.mjs
//
// It asks for a STAGING email, password and (if MFA is on) an authenticator code. The password is
// masked while typed and is never stored. It refuses to run against anything but the staging API.
// The evidence file it writes holds statuses, ids and timings only: no passwords, tokens, secrets or
// recovery codes.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import readline from "node:readline";

const API = process.env.LOOHAR_STAGING_API || "https://loohar-api-staging.onrender.com";
if (API !== "https://loohar-api-staging.onrender.com") {
  console.error("Refusing to run: this script is for the staging API only.");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (question) => new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

// Masked input: the terminal shows dots instead of the password.
function askSecret(question) {
  return new Promise((resolve) => {
    let masking = false;
    const originalWrite = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (text) => {
      if (!masking) return originalWrite ? originalWrite(text) : rl.output.write(text);
      if (text.includes(question)) return rl.output.write(question);
      return rl.output.write(".");
    };
    masking = true;
    rl.question(question, (answer) => {
      masking = false;
      if (originalWrite) rl._writeToOutput = originalWrite;
      rl.output.write("\n");
      resolve(answer.trim());
    });
  });
}

const steps = [];
function record(name, detail) {
  steps.push({ name, ...detail });
  const outcome = detail.pass === undefined ? "     " : detail.pass ? "PASS " : "FAIL ";
  console.log(`${outcome}${name}${detail.note ? ` - ${detail.note}` : ""}`);
}

async function call(path, { method = "GET", body, token } = {}) {
  const started = Date.now();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload, ms: Date.now() - started };
}

let email = "";
let session = null;

function writeEvidence() {
  const file = `staging-privileged-evidence-${(version.payload.commitSha || "unknown").slice(0, 7)}.json`;
  writeFileSync(file, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    stagingApi: API,
    commitSha: version.payload.commitSha,
    account: { emailDomain: email.split("@")[1] || null, role: session?.user?.role || null },
    steps
  }, null, 2)}\n`);
  console.log(`\nWrote ${file}. It contains no passwords, tokens, secrets or recovery codes, so it is safe to share.`);
}

const version = await call("/version");
console.log(`Staging API ${version.payload.commitSha || "unknown"} (${version.payload.environment || "?"})\n`);
record("staging identity", { pass: Boolean(version.payload.commitSha), commitSha: version.payload.commitSha, environment: version.payload.environment });

email = await ask("Staging account email: ");
const password = await askSecret("Staging password (hidden): ");

// 1. A wrong password must be refused.
const wrongPassword = await call("/api/auth/login", { method: "POST", body: { email, password: `${password}-wrong-${randomUUID().slice(0, 8)}` } });
record("wrong password refused", { pass: wrongPassword.status === 401, status: wrongPassword.status, code: wrongPassword.payload.code });

// 2. Real sign-in. A privileged role must be challenged for MFA instead of being handed a session.
const login = await call("/api/auth/login", { method: "POST", body: { email, password } });
if (login.status !== 200) {
  record("sign-in", { pass: false, status: login.status, code: login.payload.code, note: "check the email and password" });
  writeEvidence();
  rl.close();
  process.exit(1);
}
const mfaRequired = Boolean(login.payload.mfaRequired);
record("sign-in challenged for MFA", {
  pass: mfaRequired,
  mfaRequired,
  note: mfaRequired ? "a password alone does not create a session" : "this account has no MFA enabled"
});

session = login.payload;
if (mfaRequired) {
  // 3. A wrong authenticator code must be refused.
  const wrongCode = await call("/api/auth/mfa/verify", { method: "POST", body: { mfaToken: login.payload.mfaToken, code: "000000" } });
  record("wrong MFA code refused", { pass: wrongCode.status >= 400, status: wrongCode.status, code: wrongCode.payload.code });

  const code = await ask("Authenticator code (6 digits): ");
  const verified = await call("/api/auth/mfa/verify", { method: "POST", body: { mfaToken: login.payload.mfaToken, code } });
  record("MFA verification", { pass: verified.status === 200, status: verified.status, code: verified.payload.code, method: verified.payload.mfa?.method });
  if (verified.status !== 200) {
    writeEvidence();
    rl.close();
    process.exit(1);
  }
  session = verified.payload;
}

const token = session.accessToken || session.token;
const user = session.user || {};
record("session established", { pass: Boolean(token), role: user.role, mfaEnabled: user.mfaEnabled, restaurantId: user.restaurantId || null });

// 4. What the signed-in account can actually do.
if (user.restaurantId && token) {
  const summary = await call(`/api/restaurants/${user.restaurantId}/reporting/daily`, { token });
  record("daily sales summary", {
    pass: summary.status === 200,
    status: summary.status,
    ms: summary.ms,
    collectedCents: summary.payload?.payments?.collectedCents,
    netCollectedCents: summary.payload?.reconciliation?.netCollectedCents,
    byMethod: summary.payload?.payments?.byMethod
  });

  const kitchen = await call(`/api/kitchen/${user.restaurantId}/tickets`, { token });
  record("kitchen queue", {
    pass: [200, 403].includes(kitchen.status),
    status: kitchen.status,
    ms: kitchen.ms,
    tickets: Array.isArray(kitchen.payload?.tickets) ? kitchen.payload.tickets.length : null
  });

  const pos = await call(`/api/restaurants/${user.restaurantId}/pos/config`, { token });
  record("POS register configuration", {
    pass: [200, 403].includes(pos.status),
    status: pos.status,
    ms: pos.ms,
    permissions: pos.payload?.permissions?.length ?? null
  });

  const orders = await call(`/api/restaurants/${user.restaurantId}/orders?limit=5`, { token });
  record("recent orders", { pass: orders.status === 200, status: orders.status, count: Array.isArray(orders.payload?.orders) ? orders.payload.orders.length : null });
}

// 5. Another tenant's data must stay out of reach (this id is the production Loohar restaurant, which
// does not exist in the staging database).
if (token) {
  const crossTenant = await call("/api/restaurants/cmr6hochz00i0agya6w5yeglj/orders", { token });
  record("cross-tenant read refused", { pass: [403, 404].includes(crossTenant.status), status: crossTenant.status });
}

writeEvidence();
rl.close();

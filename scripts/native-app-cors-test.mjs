// CORS policy, including the Loohar POS and Driver native apps.
//
// Policy checks always run. The runtime check boots the real API in production mode and sends real
// Origin headers; it needs a disposable database:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node --test scripts/native-app-cors-test.mjs
//
// Found 2026-09-19: normalizeCorsOrigin discards any non-http(s) scheme, so the iOS app's origin
// `capacitor://localhost` could never be allowed, and the Android app's `https://localhost` was only
// allowed where local-development CORS was on, which it is not in production. Every API call from a
// native app would have been refused with 403 CORS_ORIGIN_DENIED.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { test } from "node:test";

const { createCorsPolicy, NATIVE_APP_ORIGINS } = await import("../apps/api/src/config/corsPolicy.js");

const PRODUCTION = { NODE_ENV: "production", CORS_ORIGINS: "https://loohar.com" };

test("the native allowance is exactly two origins", () => {
  assert.deepEqual([...NATIVE_APP_ORIGINS], ["capacitor://localhost", "https://localhost"]);
});

test("production refuses native-app origins unless ALLOW_NATIVE_APP_ORIGINS=true", () => {
  const policy = createCorsPolicy(PRODUCTION);
  assert.equal(policy.allowNativeAppOrigins, false);
  assert.equal(policy.isCorsOriginAllowed("capacitor://localhost"), false);
  assert.equal(policy.isCorsOriginAllowed("https://localhost"), false);
});

test("with the flag, production allows exactly the iOS and Android app origins", () => {
  const policy = createCorsPolicy({ ...PRODUCTION, ALLOW_NATIVE_APP_ORIGINS: "true" });
  assert.equal(policy.isCorsOriginAllowed("capacitor://localhost"), true);
  assert.equal(policy.isCorsOriginAllowed("https://localhost"), true);
  for (const origin of [
    "https://localhost:8443",
    "http://localhost",
    "http://localhost:5173",
    "capacitor://localhost:8080",
    "capacitor://evil.example",
    "capacitor://localhost.evil.example",
    "https://localhost.evil.example",
    "ionic://localhost",
    "https://evil.example"
  ]) {
    assert.equal(policy.isCorsOriginAllowed(origin), false, `${origin} must stay refused`);
  }
  assert.equal(policy.configuredCorsOrigins.includes("https://localhost"), false, "native origins are not added to the general allowlist");
});

test("existing production behaviour is unchanged", () => {
  const policy = createCorsPolicy({ ...PRODUCTION, ALLOW_NATIVE_APP_ORIGINS: "true" });
  assert.equal(policy.isCorsOriginAllowed(""), true, "same-origin and server-to-server requests carry no Origin");
  assert.equal(policy.isCorsOriginAllowed("https://loohar.com"), true);
  assert.equal(policy.isCorsOriginAllowed("https://driver.loohar.com"), true, "production allowlist is always merged");
  assert.equal(policy.isCorsOriginAllowed("https://evil.example"), false);
  assert.equal(policy.isCorsOriginAllowed("https://pizza.loohar.com"), false, "tenant subdomains are off unless enabled");
  assert.equal(policy.allowLocalCors, false);
  assert.throws(() => createCorsPolicy({ NODE_ENV: "production", CORS_ORIGINS: "*" }), /Wildcard CORS is not allowed/);
});

test("tenant subdomains and local development keep their previous rules", () => {
  const tenants = createCorsPolicy({ ...PRODUCTION, ALLOW_TENANT_SUBDOMAIN_CORS: "true" });
  assert.equal(tenants.isCorsOriginAllowed("https://pizza.loohar.com"), true);
  assert.equal(tenants.isCorsOriginAllowed("https://a.b.loohar.com"), false);
  assert.equal(tenants.isCorsOriginAllowed("http://pizza.loohar.com"), false);
  const development = createCorsPolicy({ NODE_ENV: "development" });
  assert.equal(development.allowLocalCors, true);
  assert.equal(development.isCorsOriginAllowed("http://localhost:5173"), true);
  assert.equal(development.isCorsOriginAllowed("capacitor://localhost"), false, "native origins need the explicit flag everywhere");
});

test("EXTRA_CORS_ORIGINS adds exact origins without touching the configured list", () => {
  const preview = "https://loohar-kds-staging-git-releas-6d6149-subashsunar-8870s-projects.vercel.app";
  const policy = createCorsPolicy({ ...PRODUCTION, EXTRA_CORS_ORIGINS: `${preview}, https://second.example` });
  assert.equal(policy.isCorsOriginAllowed(preview), true);
  assert.equal(policy.isCorsOriginAllowed("https://second.example"), true);
  assert.equal(policy.isCorsOriginAllowed("https://loohar.com"), true, "CORS_ORIGINS is still honoured");
  assert.equal(policy.isCorsOriginAllowed("https://evil.example"), false);
  assert.equal(policy.isCorsOriginAllowed("http://loohar-kds-staging-git-releas-6d6149-subashsunar-8870s-projects.vercel.app"), false, "http is a different origin");
  assert.equal(policy.isCorsOriginAllowed(`${preview}.evil.example`), false, "no suffix matching");
  // The production wildcard guard applies to this source too.
  assert.throws(() => createCorsPolicy({ NODE_ENV: "production", CORS_ORIGINS: "https://loohar.com", EXTRA_CORS_ORIGINS: "*" }), /Wildcard CORS is not allowed/);
});

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";

async function bootApi(extraEnv) {
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["apps/api/src/server.js"], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      CORS_ORIGINS: "https://loohar.com",
      JWT_SECRET: crypto.randomBytes(32).toString("hex"),
      REFRESH_TOKEN_SECRET: crypto.randomBytes(32).toString("hex"),
      MFA_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const started = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 20000);
    child.stdout.on("data", () => {
      if (output.includes("CORS native apps:")) { clearTimeout(timer); resolve(true); }
    });
    child.on("exit", () => { clearTimeout(timer); resolve(false); });
  });
  return { child, port, started, output: () => output };
}

async function preflight(port, origin) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" }
  });
  return { status: response.status, allowOrigin: response.headers.get("access-control-allow-origin") };
}

test("runtime: the API boots in production mode and answers native-app preflights over HTTP", { skip: !databaseUrl && "set LOOHAR_TEST_DATABASE_URL to a disposable local database" }, async () => {
  const off = await bootApi({});
  try {
    assert.ok(off.started, `API failed to start:\n${off.output()}`);
    assert.match(off.output(), /CORS native apps: disabled/);
    assert.equal((await preflight(off.port, "capacitor://localhost")).status, 403);
    assert.equal((await preflight(off.port, "https://loohar.com")).status, 204);
  } finally {
    off.child.kill();
  }

  const on = await bootApi({ ALLOW_NATIVE_APP_ORIGINS: "true" });
  try {
    assert.ok(on.started, `API failed to start:\n${on.output()}`);
    assert.match(on.output(), /CORS native apps: enabled/);
    for (const origin of ["capacitor://localhost", "https://localhost"]) {
      const result = await preflight(on.port, origin);
      assert.equal(result.status, 204, `${origin} preflight`);
      assert.equal(result.allowOrigin, origin);
    }
    assert.equal((await preflight(on.port, "https://localhost:8443")).status, 403);
    assert.equal((await preflight(on.port, "https://evil.example")).status, 403);
    const health = await fetch(`http://127.0.0.1:${on.port}/health`, { headers: { Origin: "capacitor://localhost" } });
    assert.equal(health.status, 200);
  } finally {
    on.child.kill();
  }
});

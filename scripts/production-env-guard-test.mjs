// The 2026-09-23 production incident, reproduced.
//
//   node --test scripts/production-env-guard-test.mjs
//
// The release added a hard production requirement for MFA_ENCRYPTION_KEY. Production did not have
// it. Nothing noticed: the API started, /health reported ok, and every privileged user's two-step
// verification enrolment returned 500 with no log entry at all.
//
// Four things failed at once. These cover the two that live in the API.
import assert from "node:assert/strict";
import { test } from "node:test";

const { assertProductionEnv, missingProductionEnv, REQUIRED_PRODUCTION_ENV } =
  await import("../apps/api/src/config/requiredEnv.js");
const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");

// Exactly what production had on the morning of the incident: everything the previous release
// needed, and nothing the new one added.
const PRODUCTION_BEFORE_THE_FIX = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user@db.example/loohar",
  JWT_SECRET: "a".repeat(48),
  STRIPE_CONNECT_SECRET_KEY: "sk_test_not_a_real_key"
};

test("the API refuses to start in the exact configuration that shipped broken", () => {
  assert.throws(
    () => assertProductionEnv(PRODUCTION_BEFORE_THE_FIX),
    (error) => {
      assert.match(error.message, /Refusing to start/);
      assert.match(error.message, /MFA_ENCRYPTION_KEY is not set/);
      // The message must say what breaks, so whoever reads it at 3am knows the consequence.
      assert.match(error.message, /two-step verification/i);
      // And why adding the variable alone was not enough.
      assert.match(error.message, /cannot see variables added after it started/);
      return true;
    },
    "the boot check must reject the configuration that caused the outage"
  );
});

test("with the key present it starts", () => {
  const fixed = { ...PRODUCTION_BEFORE_THE_FIX, MFA_ENCRYPTION_KEY: "k".repeat(48) };
  assert.deepEqual(assertProductionEnv(fixed), [], "a complete production configuration starts cleanly");
});

test("a key too short to be a real key is rejected, not quietly accepted", () => {
  const weak = { ...PRODUCTION_BEFORE_THE_FIX, MFA_ENCRYPTION_KEY: "short" };
  assert.throws(() => assertProductionEnv(weak), /shorter than 32 characters/);
});

test("card payments are reported but do not stop a deployment that excludes them", () => {
  const noCards = { ...PRODUCTION_BEFORE_THE_FIX, MFA_ENCRYPTION_KEY: "k".repeat(48) };
  delete noCards.STRIPE_CONNECT_SECRET_KEY;
  const warnings = assertProductionEnv(noCards);
  assert.equal(warnings.length, 1, "it is a warning, not a boot failure");
  assert.equal(warnings[0].name, "STRIPE_CONNECT_SECRET_KEY");
});

test("nothing is enforced outside production", () => {
  assert.deepEqual(assertProductionEnv({ NODE_ENV: "development" }), []);
  assert.deepEqual(assertProductionEnv({ NODE_ENV: "test" }), []);
});

test("every required variable explains what breaks without it", () => {
  for (const variable of REQUIRED_PRODUCTION_ENV) {
    assert.ok(variable.why && variable.why.length > 20, `${variable.name} needs a real explanation`);
  }
  assert.equal(missingProductionEnv({}).length, REQUIRED_PRODUCTION_ENV.length);
});

// --- the silent 500 ---

function captureErrorHandler(error) {
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);
  let body = null;
  let status = 0;
  const res = {
    headersSent: false,
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; }
  };
  const req = { method: "POST", originalUrl: "/api/auth/mfa/enroll/start?token=secret-tracking-token", baseUrl: "/api/auth", route: { path: "/mfa/enroll/start" }, get: () => undefined };
  try {
    errorHandler(error, req, res, () => {});
  } finally {
    console.error = originalError;
  }
  return { logged, body, status };
}

test("the failure that produced no log entry is now logged", () => {
  const thrown = new Error("MFA_ENCRYPTION_KEY must be set in production");
  const { logged, status, body } = captureErrorHandler(thrown);

  assert.equal(status, 500);
  assert.ok(logged.length > 0, "an unhandled 500 must not be silent");
  const [message, detail] = logged[0];
  assert.match(message, /Unhandled API error/);
  assert.equal(detail.message, "MFA_ENCRYPTION_KEY must be set in production", "the real cause is in the log");
  assert.ok(detail.stack, "with a stack, so it can be located");
  assert.equal(detail.route, "/api/auth/mfa/enroll/start");
  assert.ok(detail.requestId, "and a request id a person can quote");
});

test("the log records the route pattern, never the URL with its tokens", () => {
  const { logged } = captureErrorHandler(new Error("boom"));
  const serialised = JSON.stringify(logged);
  assert.doesNotMatch(serialised, /secret-tracking-token/, "a URL token must never reach the log");
});

test("the response still reveals nothing, but can be traced", () => {
  const { body } = captureErrorHandler(new Error("postgresql://user:hunter2@db.example/loohar unreachable"));
  assert.equal(body.error, "Internal server error", "a 500 never returns its message");
  assert.doesNotMatch(JSON.stringify(body), /hunter2/, "and never leaks a connection string");
  assert.ok(body.requestId, "but carries a request id to match against the log");
});

test("an ordinary handled error is unchanged and stays quiet", () => {
  const handled = new Error("Wrong cashier PIN.");
  handled.status = 401;
  const { logged, status, body } = captureErrorHandler(handled);
  assert.equal(status, 401);
  assert.equal(body.error, "Wrong cashier PIN.");
  assert.equal(logged.length, 0, "expected failures must not become log noise");
});

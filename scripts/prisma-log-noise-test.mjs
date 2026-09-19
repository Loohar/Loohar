// Prisma error-log classification.
//
// Unit checks always run. The runtime check needs a disposable database:
//   LOOHAR_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/db node scripts/prisma-log-noise-test.mjs
//
// Found on staging (2026-09-18): every correctly deduplicated Stripe webhook redelivery was logged
// as `prisma:error ... Unique constraint failed on the fields: (providerEventId)`, which makes
// log-based alerting either page on normal traffic or ignore real database faults.

import assert from "node:assert/strict";
import { test } from "node:test";

const { classifyPrismaErrorLog, emitPrismaErrorLog, uniqueConstraintTarget } = await import("../apps/api/src/utils/prismaLogFilter.js");

const UNIQUE_MESSAGE = "\nInvalid `prisma.restaurantPaymentEvent.create()` invocation:\n\n\nUnique constraint failed on the fields: (`providerEventId`)";

function recorder() {
  const calls = { info: [], error: [], warn: [] };
  return { calls, logger: { info: (m) => calls.info.push(m), error: (m) => calls.error.push(m), warn: (...a) => calls.warn.push(a) } };
}

test("a unique-constraint collision is classified apart from real errors", () => {
  assert.equal(classifyPrismaErrorLog(UNIQUE_MESSAGE), "unique-constraint");
  assert.equal(classifyPrismaErrorLog("Foreign key constraint violated on the constraint: `x_fkey`"), "error");
  assert.equal(classifyPrismaErrorLog("Can't reach database server at `db:5432`"), "error");
  assert.equal(classifyPrismaErrorLog(""), "error");
});

test("a unique-constraint collision logs at info with only the constraint fields", () => {
  const { calls, logger } = recorder();
  emitPrismaErrorLog({ message: UNIQUE_MESSAGE }, logger);
  assert.equal(calls.error.length, 0);
  assert.deepEqual(calls.info, ["prisma:unique-constraint target=providerEventId"]);
  assert.equal(uniqueConstraintTarget("Unique constraint failed on the fields: (`restaurantId`,`slug`)"), "restaurantId,slug");
});

test("every other Prisma error is still logged as an error", () => {
  const { calls, logger } = recorder();
  emitPrismaErrorLog({ message: "Can't reach database server at `db:5432`" }, logger);
  assert.equal(calls.info.length, 0);
  assert.equal(calls.error.length, 1);
  assert.match(calls.error[0], /^prisma:error Can't reach database server/);
});

test("an unhandled unique violation reaching errorHandler is logged with its route pattern, not its URL", async () => {
  const { errorHandler } = await import("../apps/api/src/middleware/errorHandler.js");
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    let status;
    const res = { headersSent: false, status(code) { status = code; return this; }, json() { return this; } };
    const req = {
      method: "POST",
      baseUrl: "/api/receipts",
      route: { path: "/:token/reissue" },
      originalUrl: "/api/receipts/SECRET_TRACKING_TOKEN/reissue?token=SECRET_QUERY"
    };
    errorHandler({ code: "P2002", meta: { target: ["providerEventId"] } }, req, res, () => {});
    assert.equal(status, 409);
    assert.equal(warnings.length, 1);
    const logged = JSON.stringify(warnings[0]);
    assert.match(logged, /\/api\/receipts\/:token\/reissue/);
    assert.match(logged, /providerEventId/);
    assert.doesNotMatch(logged, /SECRET_TRACKING_TOKEN|SECRET_QUERY/);
  } finally {
    console.warn = originalWarn;
  }
});

const databaseUrl = process.env.LOOHAR_TEST_DATABASE_URL || "";

test("runtime: a deduplicated Stripe redelivery no longer logs prisma:error, while a real fault still does", { skip: !databaseUrl && "set LOOHAR_TEST_DATABASE_URL to a disposable local database" }, async () => {
  Object.assign(process.env, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: "test" });
  const { prisma } = await import("../apps/api/src/config/prisma.js");
  const { processStripeWebhookEventOnce } = await import("../apps/api/src/modules/paymentProviders/stripeWebhookEvents.js");

  const infos = [];
  const errors = [];
  const original = { info: console.info, error: console.error };
  console.info = (...args) => infos.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
  const providerEventId = `evt_log_noise_${Date.now()}`;
  try {
    const data = { provider: "stripe_connect", providerEventId, eventType: "payment_intent.succeeded" };
    let applied = 0;
    const first = await processStripeWebhookEventOnce(data, async () => { applied += 1; return { received: true }; });
    const second = await processStripeWebhookEventOnce(data, async () => { applied += 1; return { received: true }; });
    await settle();

    assert.deepEqual(first, { received: true });
    assert.deepEqual(second, { received: true, duplicate: true });
    assert.equal(applied, 1, "the redelivery must not apply side effects twice");
    assert.equal(errors.filter((line) => /Unique constraint/i.test(line)).length, 0, `handled duplicate logged as an error: ${errors.join(" | ")}`);
    assert.ok(infos.some((line) => line === "prisma:unique-constraint target=providerEventId"), `expected a demoted log line, saw: ${infos.join(" | ")}`);

    errors.length = 0;
    await assert.rejects(prisma.restaurantPaymentEvent.create({
      data: { provider: "stripe_connect", providerEventId: `${providerEventId}_fk`, eventType: "x", restaurantId: "missing-restaurant" }
    }));
    await settle();
    assert.ok(errors.some((line) => /^prisma:error /.test(line)), "a real database fault must still be logged as an error");
  } finally {
    console.info = original.info;
    console.error = original.error;
    await prisma.restaurantPaymentEvent.deleteMany({ where: { providerEventId: { startsWith: providerEventId } } });
    await prisma.$disconnect();
  }
});

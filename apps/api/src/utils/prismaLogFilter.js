// Prisma logs every failed query at "error" before the caller sees the exception. Loohar relies on
// unique-constraint violations for race-safe idempotency (the Stripe event ledger, checkout keys,
// driver claims, POS reconciliation, tax profiles), and each of those callers catches P2002 and
// continues. Logging them as errors made every correctly handled Stripe redelivery look like a
// database failure, which leaves log-based alerting either paging on normal traffic or tuned so
// loosely that it misses real faults. A unique violation nobody handles still reaches errorHandler,
// which logs it as a warning with its route, so demoting these lines hides nothing.
const UNIQUE_CONSTRAINT_PATTERN = /Unique constraint failed/i;

export function classifyPrismaErrorLog(message = "") {
  return UNIQUE_CONSTRAINT_PATTERN.test(String(message)) ? "unique-constraint" : "error";
}

// Only the constraint's field names are logged for a unique violation, never the query arguments,
// which can carry customer data.
export function uniqueConstraintTarget(message = "") {
  const fields = String(message).match(/fields: \(([^)]*)\)/)?.[1];
  return fields ? fields.replace(/`/g, "").trim() : "unknown";
}

export function emitPrismaErrorLog(event, logger = console) {
  const message = event?.message || "";
  if (classifyPrismaErrorLog(message) === "unique-constraint") {
    logger.info(`prisma:unique-constraint target=${uniqueConstraintTarget(message)}`);
    return;
  }
  logger.error(`prisma:error ${message}`);
}

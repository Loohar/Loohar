import { ZodError } from "zod";

export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

function requestIdFor(req) {
  return req.get?.("x-request-id")
    || req.get?.("x-loohar-request-id")
    || req.get?.("x-loohar-pos-request-id")
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function structuredOperationalError({ req, res, status = 503, code, message }) {
  const requestId = requestIdFor(req);
  console.error("Operational API error.", { requestId, code, path: req.originalUrl, method: req.method });
  return res.status(status).json({
    error: { code, message, requestId }
  });
}

function isPrismaMissingColumn(error) {
  return error?.code === "P2022"
    || /column .* does not exist/i.test(error?.message || "")
    || /The column .* does not exist in the current database/i.test(error?.message || "");
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: error.flatten() });
  }
  if (error.code === "P2002") {
    return res.status(409).json({ error: "Unique constraint violation", details: error.meta });
  }
  if (["P1000", "P1001", "P1002", "P1017"].includes(error.code)) {
    console.error("Database unavailable. Start PostgreSQL and verify DATABASE_URL.", error.message);
    return res.status(503).json({ error: "Database unavailable. Start PostgreSQL and verify DATABASE_URL." });
  }
  if (isPrismaMissingColumn(error)) {
    if (req.originalUrl?.includes("/pos/")) {
      return structuredOperationalError({
        req,
        res,
        code: "POS_CONFIGURATION_UNAVAILABLE",
        message: "The POS configuration could not be loaded."
      });
    }
    return structuredOperationalError({
      req,
      res,
      code: "DATABASE_SCHEMA_MISMATCH",
      message: "The service is temporarily unavailable while the database schema is updated."
    });
  }
  const status = error.status || 500;
  if (status === 403 && error.code && String(error.code).startsWith("FEATURE_")) {
    return res.status(status).json({
      error: error.message,
      code: error.code,
      feature: error.feature,
      featureLabel: error.featureLabel,
      currentPlan: error.currentPlan,
      requiredPlan: error.requiredPlan,
      subscriptionStatus: error.subscriptionStatus,
      upgradeRequired: error.code === "FEATURE_NOT_INCLUDED"
    });
  }
  if (status === 403 && ["SUBSCRIPTION_READ_ONLY", "SUBSCRIPTION_SUSPENDED", "PLAN_NOT_INCLUDED"].includes(error.code)) {
    return res.status(status).json({
      error: error.message,
      code: error.code,
      feature: error.feature,
      featureLabel: error.featureLabel,
      currentPlan: error.currentPlan,
      requiredPlan: error.requiredPlan,
      subscriptionStatus: error.subscriptionStatus,
      upgradeRequired: error.code === "PLAN_NOT_INCLUDED"
    });
  }
  if (status === 403 && error.code === "USAGE_LIMIT_REACHED") {
    return res.status(status).json({
      error: error.message,
      code: error.code,
      limitCode: error.limitCode,
      limitLabel: error.limitLabel,
      currentPlan: error.currentPlan,
      used: error.used,
      requestedIncrement: error.requestedIncrement,
      maxAllowed: error.maxAllowed,
      upgradeRequired: Boolean(error.upgradeRequired)
    });
  }
  res.status(status).json({
    error: status === 500 ? "Internal server error" : error.message
  });
}

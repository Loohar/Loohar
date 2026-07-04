import { ZodError } from "zod";

export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
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
  const status = error.status || 500;
  res.status(status).json({
    error: status === 500 ? "Internal server error" : error.message,
    detail: process.env.NODE_ENV === "production" ? undefined : error.message
  });
}

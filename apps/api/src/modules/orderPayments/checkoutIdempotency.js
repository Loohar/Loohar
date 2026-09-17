import crypto from "node:crypto";

// Pure helpers for customer checkout idempotency. Kept free of Prisma/Stripe imports so
// they can be exercised directly by release tests.

export const CHECKOUT_IDEMPOTENCY_HEADER = "Idempotency-Key";
const CHECKOUT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/;
const TRACKING_TOKEN_SECRET_FALLBACK = "dev-checkout-tracking-secret";

function checkoutError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function normalizeCheckoutIdempotencyKey(value) {
  const candidate = String(Array.isArray(value) ? value[0] : value || "").trim();
  if (!candidate) {
    throw checkoutError("Checkout requests require an Idempotency-Key header.", 400, "CHECKOUT_IDEMPOTENCY_KEY_REQUIRED");
  }
  if (!CHECKOUT_IDEMPOTENCY_KEY_PATTERN.test(candidate)) {
    throw checkoutError("Checkout Idempotency-Key must be 16-128 letters, digits, colons, underscores, or hyphens.", 400, "CHECKOUT_IDEMPOTENCY_KEY_INVALID");
  }
  return candidate;
}

export function checkoutIdempotencyKeyHash({ restaurantId, idempotencyKey }) {
  return crypto
    .createHash("sha256")
    .update(`loohar:checkout-idempotency:v1|${String(restaurantId || "")}|${idempotencyKey}`)
    .digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

export function checkoutRequestHash(body = {}) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(body))).digest("hex");
}

function trackingTokenSecret(env = process.env) {
  const value = env.ORDER_TRACKING_TOKEN_SECRET || env.JWT_SECRET;
  if (value) return value;
  if (env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production");
  }
  return TRACKING_TOKEN_SECRET_FALLBACK;
}

// Deterministic per checkout attempt so a replayed request returns the same customer
// tracking token without storing the raw token. Only the SHA-256 hash is persisted.
export function checkoutTrackingToken({ keyHash, env = process.env }) {
  return crypto
    .createHmac("sha256", trackingTokenSecret(env))
    .update(`loohar:checkout-tracking-token:v1|${keyHash}`)
    .digest("base64url");
}

export function orderPaymentIntentIdempotencyKey(paymentId = "") {
  return `loohar:order-payment-intent:v1:${paymentId}`;
}

function uniqueTargets(error) {
  const target = error?.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  return target ? [String(target)] : [];
}

export function isUniqueConflictOn(error, field) {
  return error?.code === "P2002" && uniqueTargets(error).some((target) => target.includes(field));
}

// Stripe answers 409 while another request holds the same idempotency key.
export function isStripeIdempotencyInProgress(error) {
  return error?.status === 409
    || error?.code === "idempotency_key_in_use"
    || error?.code === "lock_timeout";
}

export function checkoutInProgressError() {
  return checkoutError("This checkout is still being prepared. Retry the same request in a moment.", 409, "CHECKOUT_IN_PROGRESS");
}

export function checkoutKeyReusedError() {
  return checkoutError("This Idempotency-Key was already used for a different checkout request.", 409, "CHECKOUT_IDEMPOTENCY_KEY_REUSED");
}

export function checkoutAttemptFailedError() {
  return checkoutError("This checkout attempt could not be completed. Start a new checkout.", 409, "CHECKOUT_ATTEMPT_FAILED");
}

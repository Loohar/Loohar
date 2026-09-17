import crypto from "crypto";

const STRIPE_ACCOUNTS_V2_DEFAULT_VERSION = "2026-08-26.dahlia";

export function stripePlatformConfigured() {
  return Boolean(process.env.STRIPE_PLATFORM_SECRET_KEY);
}

export function stripeConnectConfigured() {
  return Boolean(process.env.STRIPE_CONNECT_SECRET_KEY);
}

export function stripePlatformPublishableKey() {
  return process.env.STRIPE_PLATFORM_PUBLIC_KEY || process.env.STRIPE_PUBLIC_KEY || "";
}

export function stripeConnectPublishableKey() {
  return process.env.STRIPE_CONNECT_PUBLIC_KEY || process.env.STRIPE_PUBLIC_KEY || "";
}

export function stripeKeyMode(secretKey = "") {
  if (!secretKey) return "MISSING";
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("pk_test_")) return "TEST";
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("pk_live_")) return "LIVE";
  return "UNKNOWN";
}

function stripeDeploymentEnvironment() {
  return String(process.env.LOOHAR_ENV || process.env.APP_ENV || process.env.DEPLOY_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "").trim().toLowerCase();
}

export function assertStripeConnectModeAllowed() {
  const mode = stripeKeyMode(process.env.STRIPE_CONNECT_SECRET_KEY || "");
  const environment = stripeDeploymentEnvironment();
  const liveAllowed = ["production", "prod", "live"].includes(environment);
  if (mode === "LIVE" && !liveAllowed) {
    const error = new Error("Stripe Connect live credentials are not allowed outside production.");
    error.status = 503;
    error.code = "STRIPE_CONNECT_LIVE_MODE_FORBIDDEN";
    throw error;
  }
  if (mode === "UNKNOWN") {
    const error = new Error("Stripe Connect credential mode could not be verified.");
    error.status = 503;
    error.code = "STRIPE_CONNECT_MODE_UNVERIFIED";
    throw error;
  }
}

export function assertStripePlatformConfigured() {
  if (stripePlatformConfigured()) return;
  const error = new Error("Loohar subscription billing is not configured. Set STRIPE_PLATFORM_SECRET_KEY and Stripe platform price IDs.");
  error.status = 503;
  throw error;
}

export function assertStripeConnectConfigured() {
  if (stripeConnectConfigured()) return;
  const error = new Error("Restaurant order payments are not configured. Set STRIPE_CONNECT_SECRET_KEY before accepting live order payments.");
  error.status = 503;
  throw error;
}

export function stripeForm(data = {}) {
  const form = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    form.set(key, String(value));
  });
  return form;
}

function stripeApiVersion() {
  return process.env.STRIPE_ACCOUNTS_V2_API_VERSION || STRIPE_ACCOUNTS_V2_DEFAULT_VERSION;
}

function sanitizeStripeErrorMessage(message = "") {
  return String(message || "")
    .replace(/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_=-]+/g, "[redacted_stripe_key]")
    .replace(/\bwhsec_[A-Za-z0-9_=-]+/g, "[redacted_webhook_secret]")
    .replace(/\b(?:pi|seti|cs)_[A-Za-z0-9_=-]*_secret_[A-Za-z0-9_=-]+/g, "[redacted_client_secret]");
}

function stripeRequestError({ payload, response }) {
  const stripeError = payload?.error || {};
  const error = new Error(sanitizeStripeErrorMessage(stripeError.message || `Stripe request failed with ${response.status}`));
  error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
  if (stripeError.code) error.code = stripeError.code;
  if (stripeError.type) error.stripeErrorType = stripeError.type;
  return error;
}

export async function stripeRequest({ secretKey, path, body, stripeAccount, idempotencyKey, method = "POST" }) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(stripeAccount ? { "Stripe-Account": stripeAccount } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    ...(method === "DELETE" ? {} : { body })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw stripeRequestError({ payload, response });
  }
  return payload;
}

export async function stripeV2Request({ secretKey, path, method = "POST", body, idempotencyKey, stripeContext }) {
  const response = await fetch(`https://api.stripe.com/v2${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": stripeApiVersion(),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...(stripeContext ? { "Stripe-Context": stripeContext } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw stripeRequestError({ payload, response });
  }
  return payload;
}

function timingSafeEqualHex(left = "", right = "") {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseStripeSignature(signatureHeader = "") {
  return signatureHeader.split(",").reduce((parts, pair) => {
    const [key, value] = pair.split("=");
    if (!key || !value) return parts;
    if (key === "t") parts.timestamp = value;
    if (key === "v1") parts.signatures.push(value);
    return parts;
  }, { timestamp: "", signatures: [] });
}

export function parseRawWebhook(req) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body || {});
  try {
    return { rawBody, payload: JSON.parse(rawBody || "{}") };
  } catch {
    const error = new Error("Invalid webhook JSON payload");
    error.status = 400;
    throw error;
  }
}

export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

export function verifyStripeWebhook({ rawBody, signatureHeader, webhookSecret, toleranceSeconds = STRIPE_WEBHOOK_TOLERANCE_SECONDS, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (!webhookSecret) {
    const error = new Error("Stripe webhook secret is not configured");
    error.status = 503;
    throw error;
  }
  if (!signatureHeader) {
    const error = new Error("Missing Stripe signature");
    error.status = 400;
    throw error;
  }
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!timestamp || signatures.length === 0) {
    const error = new Error("Invalid Stripe signature header");
    error.status = 400;
    throw error;
  }
  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const valid = signatures.some((signature) => timingSafeEqualHex(signature, expectedSignature));
  if (!valid) {
    const error = new Error("Invalid Stripe signature");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(Number(timestamp)) || Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) {
    const error = new Error("Stripe signature timestamp is outside the replay tolerance");
    error.status = 400;
    throw error;
  }
}

import crypto from "crypto";

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function stripeKeyMode(secretKey = "") {
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  if (secretKey) return "unknown";
  return "not_configured";
}

export function stripePlatformConfigured() {
  return Boolean(process.env.STRIPE_PLATFORM_SECRET_KEY);
}

export function stripeConnectConfigured() {
  return Boolean(process.env.STRIPE_CONNECT_SECRET_KEY);
}

export function stripePlatformBillingEnabled() {
  return envFlag("STRIPE_PLATFORM_BILLING_ENABLED", false);
}

export function stripeOrderPaymentsEnabled() {
  return envFlag("STRIPE_ORDER_PAYMENTS_ENABLED", false);
}

export function stripePlatformPublishableKey() {
  return process.env.STRIPE_PLATFORM_PUBLIC_KEY || process.env.STRIPE_PUBLIC_KEY || "";
}

export function stripeConnectPublishableKey() {
  return process.env.STRIPE_CONNECT_PUBLIC_KEY || process.env.STRIPE_PUBLIC_KEY || "";
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

export function assertStripePlatformBillingEnabled() {
  if (!stripePlatformBillingEnabled()) {
    const error = new Error("Loohar subscription billing is disabled. Enable STRIPE_PLATFORM_BILLING_ENABLED only after Stripe test-mode certification passes.");
    error.status = 503;
    throw error;
  }
  assertStripePlatformConfigured();
}

export function assertStripeOrderPaymentsEnabled() {
  if (!stripeOrderPaymentsEnabled()) {
    const error = new Error("Restaurant order payments are disabled. Enable STRIPE_ORDER_PAYMENTS_ENABLED only after Stripe Connect test-mode certification passes.");
    error.status = 503;
    throw error;
  }
  assertStripeConnectConfigured();
}

export function stripeProviderReadiness() {
  return {
    platformBilling: {
      enabled: stripePlatformBillingEnabled(),
      configured: stripePlatformConfigured(),
      mode: stripeKeyMode(process.env.STRIPE_PLATFORM_SECRET_KEY || ""),
      webhookConfigured: Boolean(process.env.STRIPE_PLATFORM_WEBHOOK_SECRET),
      portalConfigured: Boolean(process.env.STRIPE_PLATFORM_PORTAL_CONFIGURATION_ID),
      priceMappingConfigured: ["STARTER", "PROFESSIONAL", "ENTERPRISE"].every((plan) => {
        const prefix = plan === "PROFESSIONAL" ? ["STRIPE_PLATFORM_PROFESSIONAL", "STRIPE_PLATFORM_PRO"] : [`STRIPE_PLATFORM_${plan}`];
        return prefix.some((name) => process.env[`${name}_MONTHLY_PRICE_ID`]) && prefix.some((name) => process.env[`${name}_ANNUAL_PRICE_ID`]);
      })
    },
    orderPayments: {
      enabled: stripeOrderPaymentsEnabled(),
      configured: stripeConnectConfigured(),
      mode: stripeKeyMode(process.env.STRIPE_CONNECT_SECRET_KEY || ""),
      webhookConfigured: Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET),
      connectClientConfigured: Boolean(process.env.STRIPE_CONNECT_CLIENT_ID),
      chargeModel: process.env.STRIPE_CONNECT_CHARGE_MODEL || "destination_charge"
    }
  };
}

export function stripeForm(data = {}) {
  const form = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    form.set(key, String(value));
  });
  return form;
}

export async function stripeRequest({ secretKey, path, body, stripeAccount, idempotencyKey }) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(stripeAccount ? { "Stripe-Account": stripeAccount } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `Stripe request failed with ${response.status}`);
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    error.details = payload.error;
    throw error;
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

export function verifyStripeWebhook({ rawBody, signatureHeader, webhookSecret }) {
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
  const toleranceSeconds = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || 300);
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (Number.isFinite(ageSeconds) && ageSeconds > toleranceSeconds) {
    const error = new Error("Stripe signature timestamp is outside the allowed tolerance");
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
}

export function sanitizeStripePayload(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[Truncated]";
  if (Array.isArray(value)) return value.map((item) => sanitizeStripePayload(item, depth + 1));
  if (typeof value !== "object") return value;
  const sensitiveKeys = new Set([
    "client_secret",
    "secret",
    "secret_key",
    "access_token",
    "refresh_token",
    "fingerprint",
    "number",
    "cvc",
    "account_number",
    "routing_number"
  ]);
  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => {
    if (sensitiveKeys.has(key.toLowerCase())) return [key, "[Redacted]"];
    return [key, sanitizeStripePayload(nestedValue, depth + 1)];
  }));
}

import crypto from "crypto";

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

export async function stripeRequest({ secretKey, path, body, stripeAccount }) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(stripeAccount ? { "Stripe-Account": stripeAccount } : {})
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
  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const valid = signatures.some((signature) => timingSafeEqualHex(signature, expectedSignature));
  if (!valid) {
    const error = new Error("Invalid Stripe signature");
    error.status = 400;
    throw error;
  }
}

import { publicUrlForRestaurant } from "./domainService.js";

export function calculateTechnologyFee(amountCents, technologyFeeBps = 50) {
  return Math.round((amountCents * technologyFeeBps) / 10000);
}

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLIC_KEY);
}

export function assertStripeConfigured() {
  if (stripeConfigured()) return;
  const error = new Error("Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLIC_KEY before accepting live orders.");
  error.status = 503;
  throw error;
}

async function stripeRequest(path, body) {
  assertStripeConfigured();
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
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

function siteOrderUrl(order, suffix) {
  return `${publicUrlForRestaurant(order.restaurant || { slug: order.restaurantSlug || "restaurant" }, "/order")}?orderId=${encodeURIComponent(order.id)}&payment=${suffix}`;
}

async function createStripeCustomer(order) {
  const customer = order.customer || {};
  const body = new URLSearchParams();
  if (customer.email) body.set("email", customer.email);
  if (customer.name) body.set("name", customer.name);
  if (customer.phone) body.set("phone", customer.phone);
  body.set("metadata[restaurantId]", order.restaurantId);
  body.set("metadata[orderId]", order.id);
  return stripeRequest("/customers", body);
}

async function createStripeCheckoutSession({ order, technologyFeeCents }) {
  const stripeCustomer = await createStripeCustomer(order);
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("customer", stripeCustomer.id);
  body.set("success_url", process.env.STRIPE_SUCCESS_URL || siteOrderUrl(order, "success"));
  body.set("cancel_url", process.env.STRIPE_CANCEL_URL || siteOrderUrl(order, "cancelled"));
  body.set("line_items[0][price_data][currency]", (process.env.STRIPE_CURRENCY || "usd").toLowerCase());
  body.set("line_items[0][price_data][product_data][name]", `Order #${order.orderNumber}`);
  body.set("line_items[0][price_data][product_data][description]", `${order.type} order from ${order.restaurant?.businessName || order.restaurant?.name || "Loohar restaurant"}`);
  body.set("line_items[0][price_data][unit_amount]", String(order.totalCents));
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[orderId]", order.id);
  body.set("metadata[restaurantId]", order.restaurantId);
  body.set("metadata[orderNumber]", order.orderNumber);
  body.set("payment_intent_data[metadata][orderId]", order.id);
  body.set("payment_intent_data[metadata][restaurantId]", order.restaurantId);
  body.set("payment_intent_data[metadata][orderNumber]", order.orderNumber);
  body.set("payment_intent_data[metadata][technologyFeeCents]", String(technologyFeeCents));
  body.set("payment_intent_data[metadata][restaurantTipCents]", String(order.restaurantTipCents || 0));
  body.set("payment_intent_data[metadata][driverTipCents]", String(order.driverTipCents ?? order.tipCents ?? 0));
  return { stripeCustomer, session: await stripeRequest("/checkout/sessions", body) };
}

export async function createCheckoutSession({ order, technologyFeeBps = 50 }) {
  assertStripeConfigured();
  const technologyFeeCents = calculateTechnologyFee(order.totalCents, technologyFeeBps);
  const { stripeCustomer, session } = await createStripeCheckoutSession({ order, technologyFeeCents });
  return {
    provider: "stripe",
    providerPaymentId: session.id,
    providerClientSecret: session.client_secret || null,
    stripeCustomerId: stripeCustomer.id,
    stripePaymentIntentId: session.payment_intent || null,
    status: "PENDING",
    amountCents: order.totalCents,
    technologyFeeCents,
    restaurantNetCents: order.totalCents - technologyFeeCents - (order.driverTipCents ?? order.tipCents ?? 0),
    driverTipCents: order.driverTipCents ?? order.tipCents ?? 0,
    checkoutUrl: session.url,
    publishableKey: process.env.STRIPE_PUBLIC_KEY
  };
}

export function normalizeStripeEvent(payload = {}) {
  const eventType = payload.type || payload.eventType;
  const object = payload.data?.object || payload.object || {};
  return {
    eventType,
    providerPaymentId: object.id || payload.providerPaymentId,
    stripePaymentIntentId: object.payment_intent || (eventType?.startsWith("payment_intent.") ? object.id : payload.stripePaymentIntentId),
    stripeCustomerId: object.customer || payload.stripeCustomerId,
    stripeSubscriptionId: eventType?.startsWith("customer.subscription.") ? object.id : payload.stripeSubscriptionId,
    orderId: object.metadata?.orderId || payload.orderId,
    restaurantId: object.metadata?.restaurantId || payload.restaurantId,
    currentPeriodStart: object.current_period_start || payload.currentPeriodStart,
    currentPeriodEnd: object.current_period_end || payload.currentPeriodEnd,
    failureReason: object.last_payment_error?.message || payload.failureReason
  };
}

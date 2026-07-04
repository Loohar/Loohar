export function calculateTechnologyFee(amountCents, technologyFeeBps = 50) {
  return Math.round((amountCents * technologyFeeBps) / 10000);
}

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLIC_KEY);
}

export async function createCheckoutSession({ order, technologyFeeBps = 50 }) {
  const technologyFeeCents = calculateTechnologyFee(order.totalCents, technologyFeeBps);
  const provider = stripeConfigured() ? "stripe" : "stripe_placeholder";
  const providerPaymentId = `${provider}_pi_${order.id}`;
  return {
    provider,
    providerPaymentId,
    providerClientSecret: stripeConfigured() ? `${providerPaymentId}_client_secret` : null,
    status: "PENDING",
    amountCents: order.totalCents,
    technologyFeeCents,
    restaurantNetCents: order.totalCents - technologyFeeCents - order.tipCents,
    driverTipCents: order.tipCents,
    checkoutUrl: stripeConfigured() ? `/checkout/stripe/${order.id}` : `/checkout/placeholder/${order.id}`,
    publishableKey: process.env.STRIPE_PUBLIC_KEY || null
  };
}

export async function createCheckoutPlaceholder(options) {
  return createCheckoutSession(options);
}

export function normalizeStripeEvent(payload = {}) {
  const eventType = payload.type || payload.eventType;
  const object = payload.data?.object || payload.object || {};
  return {
    eventType,
    providerPaymentId: object.id || payload.providerPaymentId,
    orderId: object.metadata?.orderId || payload.orderId,
    failureReason: object.last_payment_error?.message || payload.failureReason
  };
}

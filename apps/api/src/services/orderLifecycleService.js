import { prisma } from "../config/prisma.js";
import { stripeRequest } from "../modules/paymentProviders/stripeRest.js";

// Order status moves forward only; cancelled, rejected and delivered orders are final.
const ORDER_PROGRESS = ["PENDING", "ACCEPTED", "PREPARING", "READY", "PICKED_UP", "ON_THE_WAY", "DELIVERED"];
export const FINAL_ORDER_STATUSES = new Set(["DELIVERED", "CANCELLED", "REJECTED"]);
const SETTLED_ONLINE_PAYMENT_STATUSES = new Set(["AUTHORIZED", "PAID", "PARTIALLY_REFUNDED"]);

function lifecycleError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function assertOrderTransition(from, to) {
  if (!ORDER_PROGRESS.includes(to) && !["CANCELLED", "REJECTED"].includes(to)) {
    throw lifecycleError("Invalid order status", 400, "ORDER_STATUS_INVALID");
  }
  if (FINAL_ORDER_STATUSES.has(from)) throw lifecycleError(`A ${from.toLowerCase()} order cannot be changed.`, 409, "ORDER_STATUS_FINAL");
  if (to === "REJECTED" && from !== "PENDING") throw lifecycleError("Only new orders can be rejected.", 409, "ORDER_STATUS_TRANSITION_INVALID");
  if (to === "CANCELLED" || to === "REJECTED") return;
  if (ORDER_PROGRESS.indexOf(to) < ORDER_PROGRESS.indexOf(from)) {
    throw lifecycleError("Order status cannot move backwards.", 409, "ORDER_STATUS_TRANSITION_INVALID");
  }
}

// Before an order is cancelled or rejected: a paid online payment must be refunded first, and an
// open online checkout is cancelled at Stripe so the customer can no longer pay for it.
export async function closeOnlinePaymentForCancellation(orderId) {
  const payment = await prisma.restaurantOrderPayment.findUnique({ where: { orderId } });
  if (!payment) return null;
  if (SETTLED_ONLINE_PAYMENT_STATUSES.has(payment.status)) {
    throw lifecycleError("This order has been paid. Refund the payment before cancelling it.", 409, "ORDER_REFUND_REQUIRED");
  }
  if (payment.provider !== "STRIPE_CONNECT" || !payment.providerPaymentIntentId || ["FAILED", "CANCELED", "REFUNDED"].includes(payment.status)) {
    return payment;
  }
  const merchant = await prisma.restaurantMerchantAccount.findUnique({
    where: { restaurantId_provider: { restaurantId: payment.restaurantId, provider: "STRIPE_CONNECT" } }
  });
  try {
    await stripeRequest({
      secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
      path: `/payment_intents/${encodeURIComponent(payment.providerPaymentIntentId)}/cancel`,
      body: new URLSearchParams({ cancellation_reason: "abandoned" }),
      stripeAccount: merchant?.stripeAccountId,
      idempotencyKey: `loohar:order-payment-intent-cancel:v1:${payment.id}`
    });
  } catch (error) {
    // Stripe refuses to cancel a PaymentIntent that already succeeded or is processing.
    if (error.code === "payment_intent_unexpected_state") {
      throw lifecycleError("The customer's payment is already processing or complete. Refresh and refund instead of cancelling.", 409, "ORDER_PAYMENT_IN_FLIGHT");
    }
    throw error;
  }
  return prisma.restaurantOrderPayment.update({ where: { id: payment.id }, data: { status: "CANCELED", providerClientSecret: null } });
}

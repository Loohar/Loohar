import { prisma } from "../../config/prisma.js";

// Durable Stripe event ledger. An event is recorded before processing and marked processed
// only after its side effects succeed, so a redelivery of a processed event is skipped while
// a delivery that failed mid-way is retried. `ledger` is the Prisma delegate for the event
// table (restaurant payment events by default, platform billing events for SaaS billing).
// An unprocessed event younger than this is assumed to be owned by a delivery still running.
export const STRIPE_EVENT_PROCESSING_LEASE_MS = 60_000;

export async function beginStripeWebhookEvent(data, ledger = prisma.restaurantPaymentEvent, now = Date.now()) {
  try {
    const event = await ledger.create({ data: { ...data, processedAt: null } });
    return { event, duplicate: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const event = await ledger.findUnique({ where: { providerEventId: data.providerEventId } });
    if (event?.processedAt) return { event, duplicate: true };
    if (event && now - new Date(event.createdAt).getTime() < STRIPE_EVENT_PROCESSING_LEASE_MS) {
      // Concurrent duplicate delivery: let Stripe retry later instead of applying effects twice.
      const inProgress = new Error("Stripe event is already being processed");
      inProgress.status = 409;
      inProgress.code = "STRIPE_EVENT_IN_PROGRESS";
      throw inProgress;
    }
    return { event, duplicate: false };
  }
}

export function completeStripeWebhookEvent(event, ledger = prisma.restaurantPaymentEvent, data = {}) {
  return ledger.update({ where: { id: event.id }, data: { ...data, processedAt: new Date() } });
}

export async function processStripeWebhookEventOnce(data, process, { ledger = prisma.restaurantPaymentEvent, completionData = () => ({}) } = {}) {
  const { event, duplicate } = await beginStripeWebhookEvent(data, ledger);
  if (duplicate) return { received: true, duplicate: true };
  const result = await process();
  await completeStripeWebhookEvent(event, ledger, completionData(result));
  return result;
}

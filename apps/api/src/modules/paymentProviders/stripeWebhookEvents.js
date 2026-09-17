import { prisma } from "../../config/prisma.js";

// Durable Stripe event ledger. An event is recorded before processing and marked processed
// only after its side effects succeed, so a redelivery of a processed event is skipped while
// a delivery that failed mid-way is retried. `ledger` is the Prisma delegate for the event
// table (restaurant payment events by default, platform billing events for SaaS billing).
export async function beginStripeWebhookEvent(data, ledger = prisma.restaurantPaymentEvent) {
  try {
    const event = await ledger.create({ data: { ...data, processedAt: null } });
    return { event, duplicate: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const event = await ledger.findUnique({ where: { providerEventId: data.providerEventId } });
    return { event, duplicate: Boolean(event?.processedAt) };
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

import { prisma } from "../../config/prisma.js";

// Durable Stripe event ledger. An event is recorded before processing and marked processed
// only after its side effects succeed, so a redelivery of a processed event is skipped while
// a delivery that failed mid-way is retried.
export async function beginStripeWebhookEvent(data) {
  try {
    const event = await prisma.restaurantPaymentEvent.create({ data: { ...data, processedAt: null } });
    return { event, duplicate: false };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const event = await prisma.restaurantPaymentEvent.findUnique({ where: { providerEventId: data.providerEventId } });
    return { event, duplicate: Boolean(event?.processedAt) };
  }
}

export function completeStripeWebhookEvent(event) {
  return prisma.restaurantPaymentEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
}

export async function processStripeWebhookEventOnce(data, process) {
  const { event, duplicate } = await beginStripeWebhookEvent(data);
  if (duplicate) return { received: true, duplicate: true };
  const result = await process();
  await completeStripeWebhookEvent(event);
  return result;
}

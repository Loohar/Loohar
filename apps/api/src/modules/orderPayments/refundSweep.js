import { prisma } from "../../config/prisma.js";
import { recordAudit } from "../../services/auditService.js";
import { stripeRequest } from "../paymentProviders/stripeRest.js";

// A refund stays PENDING until a terminal webhook arrives. If that webhook is never delivered the
// row stays PENDING for ever, and because the refundable balance reserves PENDING as well as
// SUCCEEDED amounts, that money can never be refunded again: the restaurant is blocked from
// refunding a customer over an event Stripe already finished (L-20).
//
// This asks the provider what actually happened. It is read-only against Stripe and only ever
// writes the refund row's own status, so it is safe to run repeatedly and against production.
export const STALE_PENDING_REFUND_MS = 15 * 60 * 1000;

function refundStatusFromProvider(providerStatus) {
  if (providerStatus === "succeeded") return { status: "SUCCEEDED", processedAt: new Date() };
  if (providerStatus === "failed") return { status: "FAILED", processedAt: new Date() };
  if (providerStatus === "canceled") return { status: "CANCELED", processedAt: new Date() };
  return null;
}

export async function sweepStalePendingRefunds({ olderThanMs = STALE_PENDING_REFUND_MS, limit = 100, now = Date.now() } = {}) {
  const cutoff = new Date(now - olderThanMs);
  const stale = await prisma.restaurantRefund.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: limit
  });

  const result = { checked: stale.length, resolved: 0, stillPending: 0, needsReview: [], errors: 0 };
  for (const refund of stale) {
    // No provider refund id means the create call never returned one. It may or may not have reached
    // Stripe, so the balance stays reserved and a person decides; guessing here could refund twice.
    if (!refund.providerRefundId) {
      result.needsReview.push({ refundId: refund.id, restaurantId: refund.restaurantId, amountCents: refund.amountCents, reason: "no_provider_refund_id" });
      continue;
    }
    const merchant = await prisma.restaurantMerchantAccount.findUnique({
      where: { restaurantId_provider: { restaurantId: refund.restaurantId, provider: "STRIPE_CONNECT" } },
      select: { stripeAccountId: true }
    });
    if (!merchant?.stripeAccountId) {
      result.needsReview.push({ refundId: refund.id, restaurantId: refund.restaurantId, amountCents: refund.amountCents, reason: "merchant_account_missing" });
      continue;
    }
    let providerRefund;
    try {
      providerRefund = await stripeRequest({
        secretKey: process.env.STRIPE_CONNECT_SECRET_KEY,
        path: `/refunds/${refund.providerRefundId}`,
        method: "GET",
        stripeAccount: merchant.stripeAccountId
      });
    } catch {
      // Provider unreachable: leave the row exactly as it is and try again next run.
      result.errors += 1;
      continue;
    }
    const terminal = refundStatusFromProvider(providerRefund.status);
    if (!terminal) {
      result.stillPending += 1;
      continue;
    }
    // Only a row still PENDING is advanced, so a webhook that arrived meanwhile always wins.
    const updated = await prisma.restaurantRefund.updateMany({
      where: { id: refund.id, status: "PENDING" },
      data: terminal
    });
    if (updated.count === 0) {
      result.stillPending += 1;
      continue;
    }
    result.resolved += 1;
    await recordAudit({
      restaurantId: refund.restaurantId,
      action: "refund.resolved_by_sweep",
      entityType: "RestaurantRefund",
      entityId: refund.id,
      metadata: { providerRefundId: refund.providerRefundId, providerStatus: providerRefund.status, status: terminal.status, amountCents: refund.amountCents }
    });
  }
  return result;
}

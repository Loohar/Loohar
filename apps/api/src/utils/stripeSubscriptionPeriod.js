// Stripe API versions from 2025-03-31.basil (including 2026-06-24.dahlia) report billing periods on
// subscription items (items.data[].current_period_*) instead of the subscription itself. Older
// versions keep them top-level. Read whichever the event carries; for multi-item subscriptions use
// the earliest start and the earliest end (the next renewal).
export function stripeSubscriptionPeriod(subscription = {}) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const pick = (field) => {
    if (Number.isFinite(Number(subscription?.[field])) && Number(subscription[field]) > 0) return Number(subscription[field]);
    const values = items.map((item) => Number(item?.[field])).filter((value) => Number.isFinite(value) && value > 0);
    return values.length ? Math.min(...values) : null;
  };
  return { currentPeriodStart: pick("current_period_start"), currentPeriodEnd: pick("current_period_end") };
}

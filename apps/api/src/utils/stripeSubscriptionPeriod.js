// Stripe API versions from 2025-03-31.basil (including 2026-06-24.dahlia) report billing periods on
// subscription items (items.data[].current_period_*) instead of the subscription itself. Older
// versions keep them top-level. Read whichever the event carries; for multi-item subscriptions use
// the period of the item that renews first, keeping its start and end together.
const unix = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);

export function stripeSubscriptionPeriod(subscription = {}) {
  if (unix(subscription?.current_period_start) || unix(subscription?.current_period_end)) {
    return { currentPeriodStart: unix(subscription.current_period_start), currentPeriodEnd: unix(subscription.current_period_end) };
  }
  const items = (Array.isArray(subscription?.items?.data) ? subscription.items.data : [])
    .filter((item) => unix(item?.current_period_end))
    .sort((a, b) => unix(a.current_period_end) - unix(b.current_period_end));
  const next = items[0];
  return { currentPeriodStart: unix(next?.current_period_start), currentPeriodEnd: unix(next?.current_period_end) };
}

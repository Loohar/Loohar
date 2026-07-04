import { money } from "../utils/status.js";

export function EarningsPage({ earnings }) {
  const deliveryFees = earnings.deliveryFeeCents ?? earnings.earnings ?? 0;
  const tips = earnings.tipsCents ?? earnings.tips ?? 0;
  const total = earnings.totalEarningsCents ?? deliveryFees + tips;

  return (
    <div className="driver-page">
      <section className="driver-earnings-hero">
        <span>Total earnings</span>
        <strong>{money(total)}</strong>
      </section>
      <div className="driver-metrics stacked">
        <div><span>Delivery fees</span><strong>{money(deliveryFees)}</strong></div>
        <div><span>Tips</span><strong>{money(tips)}</strong></div>
        <div><span>Completed</span><strong>{earnings.completedDeliveryCount ?? earnings.deliveries ?? 0}</strong></div>
      </div>
    </div>
  );
}

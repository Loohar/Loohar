import { DriverEmpty } from "../components/DriverStates.jsx";
import { formatStatus, money } from "../utils/status.js";

export function HistoryPage({ history }) {
  return (
    <div className="driver-page">
      <section className="driver-list">
        <h2>Delivery history</h2>
        {history.length === 0 ? <DriverEmpty title="No completed deliveries" detail="Completed deliveries will appear here." /> : history.map((delivery) => (
          <div className="driver-list-row" key={delivery.id}>
            <div>
              <strong>#{delivery.order?.orderNumber || delivery.id}</strong>
              <span>{delivery.order?.restaurant?.name || "Restaurant"} to {delivery.order?.customer?.name || "Customer"}</span>
            </div>
            <div className="text-right">
              <strong>{money((delivery.baseEarningsCents || 0) + (delivery.tipCents || 0))}</strong>
              <span>{formatStatus(delivery.status)}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

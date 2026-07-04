import { DeliveryCard } from "../components/DeliveryCard.jsx";
import { DriverEmpty } from "../components/DriverStates.jsx";
import { money } from "../utils/status.js";

export function TodayPage({ activeDelivery, deliveries, earnings, onAccept, onUpdate }) {
  return (
    <div className="driver-page">
      <div className="driver-metrics">
        <div><span>Today</span><strong>{deliveries.length}</strong></div>
        <div><span>Tips</span><strong>{money(earnings.tipsCents ?? earnings.tips)}</strong></div>
      </div>
      {activeDelivery ? (
        <DeliveryCard delivery={activeDelivery} onAccept={onAccept} onUpdate={onUpdate} />
      ) : (
        <DriverEmpty title="No active delivery" detail="You are clear for the next restaurant assignment." />
      )}
      {deliveries.filter((delivery) => delivery.id !== activeDelivery?.id).length > 0 ? (
        <section className="driver-list">
          <h2>Assigned next</h2>
          {deliveries.filter((delivery) => delivery.id !== activeDelivery?.id).map((delivery) => (
            <div className="driver-list-row" key={delivery.id}>
              <div>
                <strong>#{delivery.order?.orderNumber}</strong>
                <span>{delivery.order?.restaurant?.name}</span>
              </div>
              <span>{delivery.status}</span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

import { MapPin, Navigation, Phone, Store } from "lucide-react";
import { money } from "../utils/status.js";
import { StatusStepper } from "./StatusStepper.jsx";

export function DeliveryCard({ delivery, onAccept, onUpdate }) {
  if (!delivery) return null;

  const restaurant = delivery.order?.restaurant;
  const customer = delivery.order?.customer;

  return (
    <section className="driver-delivery-card">
      <div className="driver-card-head">
        <div>
          <span>Active delivery</span>
          <h2>#{delivery.order?.orderNumber || delivery.id}</h2>
        </div>
        <strong>{money((delivery.baseEarningsCents || 0) + (delivery.tipCents || 0))}</strong>
      </div>

      <div className="driver-stop">
        <Store size={22} />
        <div>
          <span>Pickup</span>
          <strong>{restaurant?.name || "Restaurant"}</strong>
          <p>{delivery.pickupAddress || restaurant?.address}</p>
          {restaurant?.phone ? <a href={`tel:${restaurant.phone}`}><Phone size={16} />{restaurant.phone}</a> : null}
        </div>
      </div>

      <div className="driver-stop">
        <MapPin size={22} />
        <div>
          <span>Dropoff</span>
          <strong>{customer?.name || "Customer"}</strong>
          <p>{delivery.dropoffAddress}</p>
          {customer?.phone ? <a href={`tel:${customer.phone}`}><Phone size={16} />{customer.phone}</a> : null}
        </div>
      </div>

      <a className="driver-button nav" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.dropoffAddress || "")}`} target="_blank" rel="noreferrer">
        <Navigation size={20} />
        Open navigation
      </a>

      <StatusStepper delivery={delivery} onAccept={onAccept} onUpdate={onUpdate} />
    </section>
  );
}

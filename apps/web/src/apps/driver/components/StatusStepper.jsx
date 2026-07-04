import { CheckCircle2 } from "lucide-react";
import { deliveryStatuses, formatStatus } from "../utils/status.js";

export function StatusStepper({ delivery, onAccept, onUpdate }) {
  if (!delivery) return null;

  return (
    <div className="driver-status-card">
      <div>
        <span>Current status</span>
        <strong>{formatStatus(delivery.status)}</strong>
      </div>
      <button className="driver-button secondary" onClick={() => onAccept(delivery.id)}>
        <CheckCircle2 size={20} />
        Accept
      </button>
      <div className="driver-status-grid">
        {deliveryStatuses.map((status) => (
          <button
            className={delivery.status === status.value ? "active" : ""}
            key={status.value}
            onClick={() => onUpdate(delivery.id, status.value)}
          >
            {status.label}
          </button>
        ))}
      </div>
    </div>
  );
}

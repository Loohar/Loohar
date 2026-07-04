export const deliveryStatuses = [
  { value: "ACCEPTED", label: "Accepted" },
  { value: "ARRIVED_AT_RESTAURANT", label: "Arrived" },
  { value: "PICKED_UP", label: "Picked up" },
  { value: "ON_THE_WAY", label: "On the way" },
  { value: "DELIVERED", label: "Delivered" }
];

export function formatStatus(status = "ASSIGNED") {
  return status.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export function isActiveDelivery(delivery) {
  return delivery && !["DELIVERED", "CANCELLED"].includes(delivery.status);
}

export function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

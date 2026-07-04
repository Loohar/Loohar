export const fallbackDriver = {
  id: "demo-driver-available",
  available: true,
  user: { name: "Alex Driver", email: "driver@demobistro.local", phone: "555-0133" }
};

export const fallbackEarnings = {
  completedDeliveryCount: 8,
  deliveryFeeCents: 6200,
  tipsCents: 4100,
  totalEarningsCents: 10300
};

export const fallbackDeliveries = [
  {
    id: "demo-active-delivery",
    status: "ASSIGNED",
    pickupAddress: "Demo Bistro, 100 Main St, Denver, CO",
    dropoffAddress: "2425 Market St, Denver, CO",
    baseEarningsCents: 650,
    tipCents: 600,
    order: {
      orderNumber: "894120",
      customer: { name: "Maya Chen", phone: "555-0166" },
      restaurant: { name: "Demo Bistro", phone: "555-0101", address: "100 Main St, Denver, CO" },
      items: [{ id: "item-1", name: "Harvest Bowl", quantity: 2 }]
    }
  }
];

export const fallbackHistory = [
  {
    id: "demo-history-1",
    status: "DELIVERED",
    pickupAddress: "Demo Bistro, 100 Main St, Denver, CO",
    dropoffAddress: "1800 Blake St, Denver, CO",
    baseEarningsCents: 650,
    tipCents: 900,
    order: { orderNumber: "894118", customer: { name: "Jon Miller" }, restaurant: { name: "Demo Bistro" }, items: [] }
  },
  {
    id: "demo-history-2",
    status: "DELIVERED",
    pickupAddress: "Northside Tacos, 220 North Ave, Denver, CO",
    dropoffAddress: "3000 Tejon St, Denver, CO",
    baseEarningsCents: 700,
    tipCents: 500,
    order: { orderNumber: "771042", customer: { name: "Priya Shah" }, restaurant: { name: "Northside Tacos" }, items: [] }
  }
];

export const unavailableDriver = {
  id: "demo-driver-unavailable",
  available: false,
  user: { name: "Sam Rivera", email: "sam.driver@demobistro.local", phone: "555-0144" }
};

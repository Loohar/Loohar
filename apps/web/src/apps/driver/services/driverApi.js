import { api } from "../../../lib/api.js";

export function loginDriver(credentials) {
  return api("/api/auth/login", { method: "POST", body: credentials, skipAuth: true, authRetry: false, clearOnUnauthorized: false });
}

export function demoLoginDriver() {
  return api("/api/auth/demo-login", { method: "POST", body: { role: "DRIVER" }, skipAuth: true, authRetry: false, clearOnUnauthorized: false });
}

export function getDriverMe(token) {
  return api("/api/driver/me", { token });
}

export function setDriverAvailability(token, available) {
  return api("/api/driver/availability", { method: "PATCH", token, body: { available } });
}

export function getAssignedDeliveries(token) {
  return api("/api/driver/deliveries", { token });
}

export function getDelivery(token, deliveryId) {
  return api(`/api/driver/deliveries/${deliveryId}`, { token });
}

export function acceptDelivery(token, deliveryId) {
  return api(`/api/driver/deliveries/${deliveryId}/accept`, { method: "POST", token });
}

export function updateDeliveryStatus(token, deliveryId, status) {
  return api(`/api/driver/deliveries/${deliveryId}/status`, { method: "PATCH", token, body: { status } });
}

export function getDriverOrder(token, orderId) {
  return api(`/api/driver/orders/${orderId}`, { token });
}

export function claimDriverOrder(token, orderId) {
  return api(`/api/driver/orders/${orderId}/claim`, { method: "POST", token });
}

export function updateDriverOrderStatus(token, orderId, status) {
  return api(`/api/driver/orders/${orderId}/status`, { method: "PATCH", token, body: { status } });
}

export function getDriverEarnings(token) {
  return api("/api/driver/earnings", { token });
}

export function getDeliveryHistory(token) {
  return api("/api/driver/history", { token });
}

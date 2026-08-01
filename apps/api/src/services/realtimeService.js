import crypto from "crypto";
import { prisma } from "../config/prisma.js";
import { entitlementDecision, FEATURE } from "../config/entitlements.js";
import { authenticateAccessToken } from "../middleware/auth.js";
import { loadRestaurantEntitlements } from "../middleware/entitlements.js";

let ioRef = null;
const SOCKET_SESSION_RECHECK_MS = 30_000;

const restaurantRoles = new Set([
  "TENANT_OWNER",
  "RESTAURANT_OWNER",
  "RESTAURANT_ADMIN",
  "RESTAURANT_MANAGER",
  "CASHIER",
  "KITCHEN_STAFF",
  "SUPER_ADMIN"
]);
const kitchenRoles = new Set([
  "TENANT_OWNER",
  "RESTAURANT_OWNER",
  "RESTAURANT_ADMIN",
  "RESTAURANT_MANAGER",
  "CASHIER",
  "KITCHEN_STAFF",
  "SUPER_ADMIN"
]);

function socketError(message, code = "SOCKET_FORBIDDEN") {
  const error = new Error(message);
  error.code = code;
  error.data = { code };
  return error;
}

function restaurantRoom(restaurantId) {
  return `restaurant:${restaurantId}`;
}

function kitchenAllRoom(restaurantId) {
  return `kitchen:${restaurantId}:all`;
}

function kitchenLocationRoom(restaurantId, locationId) {
  return `kitchen:${restaurantId}:location:${locationId}`;
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function safeModifiers(item) {
  const options = item?.optionsJson;
  if (Array.isArray(options)) return options;
  if (Array.isArray(options?.modifiers)) return options.modifiers;
  if (Array.isArray(options?.options)) return options.options;
  return [];
}

export function serializeKitchenOrder(order) {
  return {
    id: order.id,
    restaurantId: order.restaurantId,
    locationId: order.locationId || null,
    orderNumber: order.orderNumber,
    type: order.type,
    status: order.status,
    notes: order.notes || null,
    deliveryAddress: order.deliveryAddress || null,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    deliveryFeeCents: order.deliveryFeeCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
    customer: order.customer
      ? {
          id: order.customer.id,
          name: order.customer.name,
          phone: order.customer.phone || null
        }
      : null,
    location: order.location
      ? {
          id: order.location.id,
          name: order.location.name,
          address: order.location.address || null
        }
      : null,
    items: (order.items || []).map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      optionsJson: item.optionsJson || null,
      modifiers: safeModifiers(item),
      specialInstructions: item.optionsJson?.specialInstructions || null
    })),
    statusHistory: (order.statusHistory || []).map((entry) => ({
      id: entry.id,
      status: entry.status,
      note: entry.note || null,
      createdAt: iso(entry.createdAt)
    }))
  };
}

function kitchenEvent(eventType, order) {
  const ticket = serializeKitchenOrder(order);
  return {
    eventId: crypto.randomUUID(),
    eventType,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    version: ticket.updatedAt,
    restaurantId: ticket.restaurantId,
    locationId: ticket.locationId,
    ticket
  };
}

function hasKitchenSnapshot(order) {
  return Boolean(order && Array.isArray(order.items) && Array.isArray(order.statusHistory));
}

async function authorizeSocket(socket, next) {
  try {
    const auth = socket.handshake.auth || {};
    const scope = String(auth.scope || "").toLowerCase();
    if (!["restaurant", "kitchen", "driver"].includes(scope)) {
      return next(socketError("A valid realtime scope is required.", "SOCKET_SCOPE_INVALID"));
    }

    const user = await authenticateAccessToken(auth.token);
    if (scope === "kitchen" && !kitchenRoles.has(user.role)) {
      return next(socketError("Kitchen realtime access denied.", "SOCKET_ROLE_FORBIDDEN"));
    }
    if (scope === "restaurant" && !restaurantRoles.has(user.role)) {
      return next(socketError("Restaurant realtime access denied.", "SOCKET_ROLE_FORBIDDEN"));
    }

    if (scope === "driver") {
      const driver = await prisma.driver.findFirst({
        where: { userId: user.id },
        select: { id: true, restaurantId: true }
      });
      if (!driver) return next(socketError("Driver realtime access denied.", "SOCKET_DRIVER_FORBIDDEN"));
      socket.data = { user, scope, restaurantId: driver.restaurantId, driverId: driver.id, locationId: null, authToken: auth.token };
      return next();
    }

    const requestedRestaurantId = String(auth.restaurantId || "");
    const restaurantId = user.role === "SUPER_ADMIN" ? requestedRestaurantId : user.restaurantId;
    if (!restaurantId || (requestedRestaurantId && requestedRestaurantId !== restaurantId)) {
      return next(socketError("Tenant realtime access denied.", "SOCKET_TENANT_FORBIDDEN"));
    }
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, status: true }
    });
    if (!restaurant || restaurant.status !== "ACTIVE") {
      return next(socketError("Restaurant is not active.", "SOCKET_TENANT_INACTIVE"));
    }

    let locationId = null;
    if (scope === "kitchen") {
      const entitlement = await loadRestaurantEntitlements(restaurantId);
      const decision = entitlementDecision(entitlement, FEATURE.KITCHEN_DISPLAY, "GET");
      if (!decision.allowed) {
        return next(socketError(decision.error || "Kitchen display is unavailable.", decision.code || "SOCKET_FEATURE_FORBIDDEN"));
      }
      locationId = auth.locationId ? String(auth.locationId) : null;
      if (locationId) {
        const location = await prisma.restaurantLocation.findFirst({
          where: { id: locationId, restaurantId, active: true },
          select: { id: true }
        });
        if (!location) return next(socketError("Kitchen location access denied.", "SOCKET_LOCATION_FORBIDDEN"));
      }
    }

    socket.data = { user, scope, restaurantId, locationId, authToken: auth.token };
    next();
  } catch (error) {
    const code = error.code || (error.name === "TokenExpiredError" ? "AUTH_ACCESS_TOKEN_EXPIRED" : "AUTH_ACCESS_TOKEN_INVALID");
    next(socketError(error.message || "Realtime authentication failed.", code));
  }
}

export function bindRealtime(io) {
  ioRef = io;
  io.use(authorizeSocket);
  io.on("connection", (socket) => {
    if (socket.data.scope === "driver") socket.join(`driver:${socket.data.driverId}`);
    if (socket.data.scope === "restaurant") socket.join(restaurantRoom(socket.data.restaurantId));
    if (socket.data.scope === "kitchen") {
      socket.join(
        socket.data.locationId
          ? kitchenLocationRoom(socket.data.restaurantId, socket.data.locationId)
          : kitchenAllRoom(socket.data.restaurantId)
      );
    }

    socket.emit("realtime:ready", {
      scope: socket.data.scope,
      restaurantId: socket.data.restaurantId,
      locationId: socket.data.locationId || null
    });

    let sessionCheckPending = false;
    const sessionTimer = setInterval(async () => {
      if (sessionCheckPending || !socket.connected) return;
      sessionCheckPending = true;
      try {
        const user = await authenticateAccessToken(socket.data.authToken);
        if (user.id !== socket.data.user.id || user.sessionVersion !== socket.data.user.sessionVersion) {
          throw socketError("Realtime session is no longer valid.", "AUTH_SESSION_REVOKED");
        }
      } catch (error) {
        socket.emit("realtime:session-ended", {
          code: error.code || (error.name === "TokenExpiredError" ? "AUTH_ACCESS_TOKEN_EXPIRED" : "AUTH_ACCESS_TOKEN_INVALID")
        });
        socket.disconnect(true);
      } finally {
        sessionCheckPending = false;
      }
    }, SOCKET_SESSION_RECHECK_MS);
    sessionTimer.unref?.();
    socket.on("disconnect", () => clearInterval(sessionTimer));
  });
}

function emitKitchenEvent(eventName, event) {
  if (!ioRef) return;
  ioRef.to(kitchenAllRoom(event.restaurantId)).emit(eventName, event);
  if (event.locationId) {
    ioRef.to(kitchenLocationRoom(event.restaurantId, event.locationId)).emit(eventName, event);
  }
}

export function emitKitchenTicketCreated(order) {
  if (!hasKitchenSnapshot(order)) return null;
  const event = kitchenEvent("kitchen.ticket.created.v1", order);
  emitKitchenEvent("kitchen.ticket.created.v1", event);
  return event;
}

export function emitOrderUpdate(order) {
  if (!ioRef) return null;
  ioRef.to(restaurantRoom(order.restaurantId)).emit("order:update", serializeKitchenOrder(order));
  if (!hasKitchenSnapshot(order)) return null;
  const event = kitchenEvent("order.status.updated.v1", order);
  emitKitchenEvent("order.status.updated.v1", event);
  return event;
}

export function emitDeliveryUpdate(delivery) {
  if (!ioRef) return;
  ioRef.to(restaurantRoom(delivery.restaurantId)).emit("delivery:update", delivery);
  if (delivery.driverId) ioRef.to(`driver:${delivery.driverId}`).emit("delivery:update", delivery);
}

export function emitKitchenUpdate(order) {
  if (!hasKitchenSnapshot(order)) return null;
  const eventName = ["CANCELLED", "DELIVERED", "PICKED_UP"].includes(order.status)
    ? "kitchen.ticket.cancelled.v1"
    : "kitchen.ticket.updated.v1";
  const event = kitchenEvent(eventName, order);
  emitKitchenEvent(eventName, event);
  return event;
}

let ioRef = null;

export function bindRealtime(io) {
  ioRef = io;
  io.on("connection", (socket) => {
    socket.on("join:restaurant", (restaurantId) => socket.join(`restaurant:${restaurantId}`));
    socket.on("join:order", (orderId) => socket.join(`order:${orderId}`));
    socket.on("join:driver", (driverId) => socket.join(`driver:${driverId}`));
    socket.on("join:kitchen", (restaurantId) => socket.join(`kitchen:${restaurantId}`));
  });
}

export function emitOrderUpdate(order) {
  if (!ioRef) return;
  ioRef.to(`restaurant:${order.restaurantId}`).emit("order:update", order);
  ioRef.to(`order:${order.id}`).emit("order:update", order);
}

export function emitDeliveryUpdate(delivery) {
  if (!ioRef) return;
  ioRef.to(`restaurant:${delivery.restaurantId}`).emit("delivery:update", delivery);
  if (delivery.driverId) ioRef.to(`driver:${delivery.driverId}`).emit("delivery:update", delivery);
}

export function emitKitchenUpdate(order) {
  if (!ioRef) return;
  ioRef.to(`kitchen:${order.restaurantId}`).emit("kitchen:update", order);
}

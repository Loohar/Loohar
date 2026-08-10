import { recordAudit } from "./auditService.js";

const AUTHORIZED_DRAWER_REASONS = new Set([
  "COMPLETED_CASH_SALE",
  "MANAGER_AUTHORIZED_OPEN",
  "CASH_MANAGEMENT"
]);

export async function requestCashDrawerOpen({
  restaurantId,
  actorUserId,
  device,
  cashDrawer,
  shift,
  orderId,
  paymentId,
  reason,
  adapter = null
}) {
  if (!AUTHORIZED_DRAWER_REASONS.has(reason)) throw new Error("Cash drawer open reason is not authorized.");
  if (!restaurantId || !actorUserId || !device?.id || !cashDrawer?.id || !shift?.id) {
    throw new Error("Cash drawer open context is incomplete.");
  }

  let hardwareStatus = "NOT_CONFIGURED";
  let physicalOpenRequested = false;
  if (typeof adapter?.openCashDrawer === "function") {
    await adapter.openCashDrawer({ restaurantId, deviceId: device.id, cashDrawerId: cashDrawer.id, reason });
    hardwareStatus = "REQUESTED";
    physicalOpenRequested = true;
  }

  await recordAudit({
    actorUserId,
    restaurantId,
    action: "pos.cash-drawer.open.requested",
    entityType: "CashDrawer",
    entityId: cashDrawer.id,
    metadata: {
      reason,
      orderId,
      paymentId,
      shiftId: shift.id,
      deviceId: device.id,
      hardwareStatus,
      physicalOpenRequested
    }
  });

  return { requested: true, physicalOpenRequested, hardwareStatus };
}

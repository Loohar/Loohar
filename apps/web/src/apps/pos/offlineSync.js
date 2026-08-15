import { POS_OFFLINE_SYNC_STATUS } from "../../../../shared/posOfflinePricing.js";

const LEGACY_LOCATIONLESS_SHIFT_ERROR = "The cached shift was not valid when this offline cash sale completed.";

export function shouldRetryPosOfflineLocationlessShiftFailure(record) {
  return record?.syncStatus === POS_OFFLINE_SYNC_STATUS.NEEDS_REVIEW
    && record?.lastSyncErrorCode === "POS_OFFLINE_SYNC_FAILED"
    && record?.lastSyncError === LEGACY_LOCATIONLESS_SHIFT_ERROR;
}

export function classifyPosOfflineSyncError(error) {
  const status = Number(error?.status || error?.payload?.status || 0);
  const code = String(error?.payload?.code || error?.code || "POS_OFFLINE_SYNC_FAILED");
  const retryable = !status
    || status >= 500
    || [408, 425, 429].includes(status)
    || code === "POS_OFFLINE_SYNC_IN_PROGRESS"
    || (status === 401 && code.startsWith("POS_SESSION_"));
  return {
    code,
    retryable,
    message: String(error?.message || "Offline transaction synchronization failed.").slice(0, 500)
  };
}

export async function runPosOfflineSyncBatch({
  records,
  updateRecord,
  sendRecord,
  maxTransactions = 10
}) {
  const queue = (Array.isArray(records) ? records : [])
    .filter((record) => [
      POS_OFFLINE_SYNC_STATUS.LOCAL_COMPLETED,
      POS_OFFLINE_SYNC_STATUS.PENDING_SYNC,
      POS_OFFLINE_SYNC_STATUS.FAILED_RETRYABLE,
      POS_OFFLINE_SYNC_STATUS.SYNCING
    ].includes(record.syncStatus))
    .slice(0, Math.max(1, maxTransactions));
  const result = { synced: 0, retryable: 0, needsReview: 0, stopped: false };
  for (const record of queue) {
    const attempts = Number(record.syncAttempts || 0) + 1;
    await updateRecord(record.localTransactionId, {
      syncStatus: POS_OFFLINE_SYNC_STATUS.SYNCING,
      syncAttempts: attempts,
      lastSyncAttemptAt: new Date().toISOString(),
      lastSyncError: ""
    });
    try {
      const response = await sendRecord({ ...record, syncAttempts: attempts, syncStatus: POS_OFFLINE_SYNC_STATUS.SYNCING });
      await updateRecord(record.localTransactionId, {
        syncStatus: POS_OFFLINE_SYNC_STATUS.SYNCED,
        canonicalOrderId: response.order?.id || response.canonicalOrderId || null,
        canonicalPaymentId: response.payment?.id || response.canonicalPaymentId || null,
        canonicalLedgerId: response.ledger?.id || response.canonicalLedgerId || null,
        canonicalReceiptId: response.receipt?.id || response.canonicalReceiptId || null,
        canonicalKitchenReceiptId: response.kitchenReceipt?.id || response.canonicalKitchenReceiptId || null,
        serverSyncedAt: response.serverSyncedAt || new Date().toISOString(),
        lastSyncError: ""
      });
      result.synced += 1;
    } catch (error) {
      const classified = classifyPosOfflineSyncError(error);
      await updateRecord(record.localTransactionId, {
        syncStatus: classified.retryable ? POS_OFFLINE_SYNC_STATUS.FAILED_RETRYABLE : POS_OFFLINE_SYNC_STATUS.NEEDS_REVIEW,
        lastSyncError: classified.message,
        lastSyncErrorCode: classified.code
      });
      if (classified.retryable) {
        result.retryable += 1;
        result.stopped = true;
        break;
      }
      result.needsReview += 1;
    }
  }
  return result;
}

export function posOfflineRetryDelayMs(attempts = 1) {
  return Math.min(30_000, 1_000 * (2 ** Math.min(5, Math.max(0, Number(attempts || 1) - 1))));
}

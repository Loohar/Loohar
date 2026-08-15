import { POS_OFFLINE_SYNC_STATUS, POS_OFFLINE_UNSYNCED_STATUSES } from "../../../../shared/posOfflinePricing.js";

const DATABASE_NAME = "loohar-pos-offline-v1";
const DATABASE_VERSION = 2;
const INITIALIZATION_STORE = "registerInitializations";
const TRANSACTION_STORE = "transactions";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionFinished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

export function posOfflineRegisterKey(restaurantId, terminalId) {
  return `${String(restaurantId || "unknown")}::${String(terminalId || "unknown")}`;
}

export function openPosOfflineDatabase(indexedDb = globalThis.indexedDB) {
  if (!indexedDb?.open) return Promise.reject(new Error("Durable offline storage is unavailable in this browser."));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(INITIALIZATION_STORE)) {
        database.createObjectStore(INITIALIZATION_STORE, { keyPath: "registerKey" });
      }
      if (!database.objectStoreNames.contains(TRANSACTION_STORE)) {
        const store = database.createObjectStore(TRANSACTION_STORE, { keyPath: "localTransactionId" });
        store.createIndex("registerKey", "registerKey", { unique: false });
        store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
        store.createIndex("syncStatus", "syncStatus", { unique: false });
        store.createIndex("completedAt", "completedAt", { unique: false });
      } else {
        const store = request.transaction.objectStore(TRANSACTION_STORE);
        if (!store.indexNames.contains("idempotencyKey")) {
          store.createIndex("idempotencyKey", "idempotencyKey", { unique: true });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Durable offline storage could not be opened."));
    request.onblocked = () => reject(new Error("Durable offline storage upgrade is blocked by another tab."));
  });
}

async function withDatabase(operation, indexedDb) {
  const database = await openPosOfflineDatabase(indexedDb);
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

export async function savePosOfflineInitialization(initialization, indexedDb) {
  if (!initialization?.registerKey) throw new Error("Offline initialization requires a register key.");
  return withDatabase(async (database) => {
    const transaction = database.transaction(INITIALIZATION_STORE, "readwrite");
    transaction.objectStore(INITIALIZATION_STORE).put(initialization);
    await transactionFinished(transaction);
    return initialization;
  }, indexedDb);
}

export async function loadPosOfflineInitialization(registerKey, indexedDb) {
  if (!registerKey) return null;
  return withDatabase(async (database) => {
    const transaction = database.transaction(INITIALIZATION_STORE, "readonly");
    const result = await requestResult(transaction.objectStore(INITIALIZATION_STORE).get(registerKey));
    await transactionFinished(transaction);
    return result || null;
  }, indexedDb);
}

export async function persistPosOfflineTransaction(record, indexedDb) {
  if (!record?.localTransactionId || !record?.idempotencyKey || !record?.registerKey) {
    throw new Error("Offline transaction identity is incomplete.");
  }
  return withDatabase(async (database) => {
    const transaction = database.transaction(TRANSACTION_STORE, "readwrite");
    transaction.objectStore(TRANSACTION_STORE).add(record);
    await transactionFinished(transaction);
    return record;
  }, indexedDb);
}

export async function updatePosOfflineTransaction(localTransactionId, patch, indexedDb) {
  return withDatabase(async (database) => {
    const transaction = database.transaction(TRANSACTION_STORE, "readwrite");
    const store = transaction.objectStore(TRANSACTION_STORE);
    const current = await requestResult(store.get(localTransactionId));
    if (!current) throw new Error("Offline transaction was not found.");
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    store.put(updated);
    await transactionFinished(transaction);
    return updated;
  }, indexedDb);
}

export async function listPosOfflineTransactions(registerKey, { unsyncedOnly = false, indexedDb } = {}) {
  if (!registerKey) return [];
  return withDatabase(async (database) => {
    const transaction = database.transaction(TRANSACTION_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(TRANSACTION_STORE).index("registerKey").getAll(registerKey));
    await transactionFinished(transaction);
    return (records || [])
      .filter((record) => !unsyncedOnly || POS_OFFLINE_UNSYNCED_STATUSES.includes(record.syncStatus))
      .sort((left, right) => String(left.completedAt || left.createdAt).localeCompare(String(right.completedAt || right.createdAt)) || String(left.localTransactionId).localeCompare(String(right.localTransactionId)));
  }, indexedDb);
}

export async function countUnsyncedPosOfflineTransactions(registerKey, indexedDb) {
  const records = await listPosOfflineTransactions(registerKey, { unsyncedOnly: true, indexedDb });
  return records.length;
}

export async function recoverInterruptedPosOfflineTransactions(registerKey, indexedDb) {
  const records = await listPosOfflineTransactions(registerKey, { unsyncedOnly: true, indexedDb });
  const interrupted = records.filter((record) => record.syncStatus === POS_OFFLINE_SYNC_STATUS.SYNCING);
  for (const record of interrupted) {
    await updatePosOfflineTransaction(record.localTransactionId, {
      syncStatus: POS_OFFLINE_SYNC_STATUS.FAILED_RETRYABLE,
      lastSyncError: "Synchronization was interrupted before confirmation."
    }, indexedDb);
  }
  return interrupted.length;
}

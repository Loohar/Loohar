CREATE TABLE "PosOfflineReconciliation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "locationId" TEXT,
    "deviceId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "localTransactionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "configurationVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "payloadJson" JSONB NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "cashLedgerEntryId" TEXT,
    "customerReceiptId" TEXT,
    "kitchenReceiptId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "kdsDispatchedAt" TIMESTAMP(3),
    "cashDrawerDispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOfflineReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosOfflineReconciliation_restaurantId_localTransactionId_key"
ON "PosOfflineReconciliation"("restaurantId", "localTransactionId");

CREATE UNIQUE INDEX "PosOfflineReconciliation_restaurantId_idempotencyKey_key"
ON "PosOfflineReconciliation"("restaurantId", "idempotencyKey");

CREATE INDEX "PosOfflineReconciliation_restaurantId_status_createdAt_idx"
ON "PosOfflineReconciliation"("restaurantId", "status", "createdAt");

CREATE INDEX "PosOfflineReconciliation_deviceId_createdAt_idx"
ON "PosOfflineReconciliation"("deviceId", "createdAt");

ALTER TABLE "PosOfflineReconciliation"
ADD CONSTRAINT "PosOfflineReconciliation_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

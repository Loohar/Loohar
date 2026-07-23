-- Restaurant POS register and kiosk mode foundation.
ALTER TYPE "BusinessModule" ADD VALUE IF NOT EXISTS 'POS_REGISTER';
ALTER TYPE "BusinessModule" ADD VALUE IF NOT EXISTS 'POS_KIOSK_MODE';
ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'DINE_IN';
ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'WALK_IN';

CREATE TYPE "PosDeviceType" AS ENUM ('MAIN_TERMINAL', 'POS_KIOSK', 'APPROVED_MOBILE', 'KITCHEN_DISPLAY', 'MANAGER_DEVICE');
CREATE TYPE "PosDeviceStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE "PosShiftStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED', 'FORCE_CLOSED');
CREATE TYPE "CashDrawerStatus" AS ENUM ('OPEN', 'CLOSED', 'SUSPENDED');
CREATE TYPE "PosOrderSessionStatus" AS ENUM ('ACTIVE', 'HELD', 'SUBMITTED', 'VOIDED');
CREATE TYPE "PosPaymentChannel" AS ENUM ('CASH', 'CARD');
CREATE TYPE "PosReceiptKind" AS ENUM ('CUSTOMER_RECEIPT', 'KITCHEN_TICKET');
CREATE TYPE "PosReceiptStatus" AS ENUM ('CREATED', 'PRINTED', 'SENT', 'FAILED');

CREATE TABLE "PosDevice" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT,
  "name" TEXT NOT NULL,
  "deviceType" "PosDeviceType" NOT NULL DEFAULT 'POS_KIOSK',
  "deviceFingerprintHash" TEXT,
  "registrationTokenHash" TEXT,
  "status" "PosDeviceStatus" NOT NULL DEFAULT 'PENDING',
  "kioskModeEnabled" BOOLEAN NOT NULL DEFAULT false,
  "kioskExitPinHash" TEXT,
  "kioskExitPinUpdatedAt" TIMESTAMP(3),
  "cashDrawerId" TEXT,
  "cardPaymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "lastSeenAt" TIMESTAMP(3),
  "registeredByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "settingsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PosRegister" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT,
  "deviceId" TEXT,
  "cashDrawerId" TEXT,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "settingsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosRegister_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashDrawer" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT,
  "name" TEXT NOT NULL,
  "status" "CashDrawerStatus" NOT NULL DEFAULT 'CLOSED',
  "currentBalanceCents" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashDrawer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeShift" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT,
  "employeeUserId" TEXT NOT NULL,
  "deviceId" TEXT,
  "registerId" TEXT,
  "cashDrawerId" TEXT,
  "status" "PosShiftStatus" NOT NULL DEFAULT 'OPEN',
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pausedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "openingCashCents" INTEGER NOT NULL DEFAULT 0,
  "closingCashCents" INTEGER,
  "expectedCashCents" INTEGER,
  "discrepancyCents" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashDrawerSession" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT,
  "cashDrawerId" TEXT NOT NULL,
  "shiftId" TEXT,
  "openedByUserId" TEXT NOT NULL,
  "closedByUserId" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "openingCashCents" INTEGER NOT NULL DEFAULT 0,
  "closingCashCents" INTEGER,
  "expectedCashCents" INTEGER,
  "discrepancyCents" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashDrawerSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashLedgerEntry" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT,
  "cashDrawerId" TEXT NOT NULL,
  "shiftId" TEXT,
  "orderId" TEXT,
  "paymentId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "entryType" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PosOrderSession" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT,
  "deviceId" TEXT,
  "shiftId" TEXT,
  "orderId" TEXT,
  "quoteId" TEXT,
  "name" TEXT,
  "status" "PosOrderSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "orderType" "OrderType" NOT NULL DEFAULT 'WALK_IN',
  "cartJson" JSONB NOT NULL,
  "quoteJson" JSONB,
  "customerJson" JSONB,
  "heldAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosOrderSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderQuote" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT,
  "deviceId" TEXT,
  "sessionId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "orderType" "OrderType" NOT NULL DEFAULT 'WALK_IN',
  "lineItemsJson" JSONB NOT NULL,
  "subtotalCents" INTEGER NOT NULL,
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents" INTEGER NOT NULL DEFAULT 0,
  "tipCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderQuote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PosReceipt" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "locationId" TEXT,
  "deviceId" TEXT,
  "sessionId" TEXT,
  "orderId" TEXT,
  "receiptNumber" TEXT NOT NULL,
  "kind" "PosReceiptKind" NOT NULL DEFAULT 'CUSTOMER_RECEIPT',
  "status" "PosReceiptStatus" NOT NULL DEFAULT 'CREATED',
  "payloadJson" JSONB NOT NULL,
  "printedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failedReason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosDevice_restaurantId_deviceFingerprintHash_key" ON "PosDevice"("restaurantId", "deviceFingerprintHash");
CREATE INDEX "PosDevice_restaurantId_status_idx" ON "PosDevice"("restaurantId", "status");
CREATE INDEX "PosDevice_restaurantId_deviceType_idx" ON "PosDevice"("restaurantId", "deviceType");
CREATE INDEX "PosDevice_locationId_idx" ON "PosDevice"("locationId");

CREATE UNIQUE INDEX "PosRegister_deviceId_key" ON "PosRegister"("deviceId");
CREATE INDEX "PosRegister_restaurantId_active_idx" ON "PosRegister"("restaurantId", "active");
CREATE INDEX "PosRegister_locationId_idx" ON "PosRegister"("locationId");

CREATE INDEX "CashDrawer_restaurantId_status_idx" ON "CashDrawer"("restaurantId", "status");
CREATE INDEX "CashDrawer_locationId_idx" ON "CashDrawer"("locationId");

CREATE INDEX "EmployeeShift_restaurantId_employeeUserId_status_idx" ON "EmployeeShift"("restaurantId", "employeeUserId", "status");
CREATE INDEX "EmployeeShift_restaurantId_status_idx" ON "EmployeeShift"("restaurantId", "status");
CREATE INDEX "EmployeeShift_locationId_idx" ON "EmployeeShift"("locationId");

CREATE INDEX "CashDrawerSession_restaurantId_cashDrawerId_closedAt_idx" ON "CashDrawerSession"("restaurantId", "cashDrawerId", "closedAt");
CREATE INDEX "CashDrawerSession_locationId_idx" ON "CashDrawerSession"("locationId");

CREATE INDEX "CashLedgerEntry_restaurantId_cashDrawerId_createdAt_idx" ON "CashLedgerEntry"("restaurantId", "cashDrawerId", "createdAt");
CREATE INDEX "CashLedgerEntry_restaurantId_orderId_idx" ON "CashLedgerEntry"("restaurantId", "orderId");
CREATE INDEX "CashLedgerEntry_locationId_idx" ON "CashLedgerEntry"("locationId");

CREATE INDEX "PosOrderSession_restaurantId_status_updatedAt_idx" ON "PosOrderSession"("restaurantId", "status", "updatedAt");
CREATE INDEX "PosOrderSession_restaurantId_orderId_idx" ON "PosOrderSession"("restaurantId", "orderId");
CREATE INDEX "PosOrderSession_locationId_idx" ON "PosOrderSession"("locationId");

CREATE INDEX "OrderQuote_restaurantId_expiresAt_idx" ON "OrderQuote"("restaurantId", "expiresAt");
CREATE INDEX "OrderQuote_restaurantId_sessionId_idx" ON "OrderQuote"("restaurantId", "sessionId");
CREATE INDEX "OrderQuote_locationId_idx" ON "OrderQuote"("locationId");

CREATE UNIQUE INDEX "PosReceipt_restaurantId_receiptNumber_key" ON "PosReceipt"("restaurantId", "receiptNumber");
CREATE INDEX "PosReceipt_restaurantId_orderId_idx" ON "PosReceipt"("restaurantId", "orderId");
CREATE INDEX "PosReceipt_locationId_idx" ON "PosReceipt"("locationId");

ALTER TABLE "PosDevice" ADD CONSTRAINT "PosDevice_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosDevice" ADD CONSTRAINT "PosDevice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PosDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PosDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashDrawerSession" ADD CONSTRAINT "CashDrawerSession_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashDrawerSession" ADD CONSTRAINT "CashDrawerSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashDrawerSession" ADD CONSTRAINT "CashDrawerSession_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashDrawerSession" ADD CONSTRAINT "CashDrawerSession_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "EmployeeShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashLedgerEntry" ADD CONSTRAINT "CashLedgerEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashLedgerEntry" ADD CONSTRAINT "CashLedgerEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashLedgerEntry" ADD CONSTRAINT "CashLedgerEntry_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashLedgerEntry" ADD CONSTRAINT "CashLedgerEntry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "EmployeeShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PosOrderSession" ADD CONSTRAINT "PosOrderSession_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosOrderSession" ADD CONSTRAINT "PosOrderSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PosOrderSession" ADD CONSTRAINT "PosOrderSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PosDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PosOrderSession" ADD CONSTRAINT "PosOrderSession_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "EmployeeShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderQuote" ADD CONSTRAINT "OrderQuote_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderQuote" ADD CONSTRAINT "OrderQuote_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderQuote" ADD CONSTRAINT "OrderQuote_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PosDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderQuote" ADD CONSTRAINT "OrderQuote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PosOrderSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PosReceipt" ADD CONSTRAINT "PosReceipt_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosReceipt" ADD CONSTRAINT "PosReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PosReceipt" ADD CONSTRAINT "PosReceipt_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PosDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PosReceipt" ADD CONSTRAINT "PosReceipt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PosOrderSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

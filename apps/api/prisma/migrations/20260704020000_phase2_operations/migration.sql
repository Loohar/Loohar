ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CASHIER';

ALTER TABLE "RestaurantStaff"
ADD COLUMN "permissionsJson" JSONB;

CREATE TABLE "RestaurantPrinterSettings" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "kitchenPrinterName" TEXT,
  "kitchenPrinterEnabled" BOOLEAN NOT NULL DEFAULT false,
  "frontCounterPrinterName" TEXT,
  "frontCounterPrinterEnabled" BOOLEAN NOT NULL DEFAULT false,
  "autoPrintKitchenTickets" BOOLEAN NOT NULL DEFAULT false,
  "autoPrintCustomerReceipts" BOOLEAN NOT NULL DEFAULT false,
  "provider" TEXT NOT NULL DEFAULT 'browser_print',
  "settingsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantPrinterSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RestaurantNotificationSettings" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "orderConfirmedSms" BOOLEAN NOT NULL DEFAULT false,
  "orderReadySms" BOOLEAN NOT NULL DEFAULT false,
  "outForDeliverySms" BOOLEAN NOT NULL DEFAULT false,
  "deliveredSms" BOOLEAN NOT NULL DEFAULT false,
  "orderConfirmationEmail" BOOLEAN NOT NULL DEFAULT true,
  "receiptEmail" BOOLEAN NOT NULL DEFAULT true,
  "passwordResetEmail" BOOLEAN NOT NULL DEFAULT true,
  "welcomeEmail" BOOLEAN NOT NULL DEFAULT true,
  "providerSettingsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantNotificationSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryZone" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "radiusMiles" DOUBLE PRECISION NOT NULL,
  "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
  "minimumOrderCents" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "mapSettingsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryItem" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL DEFAULT 'unit',
  "costCents" INTEGER NOT NULL DEFAULT 0,
  "lowStockAt" DOUBLE PRECISION,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RestaurantPrinterSettings_restaurantId_key" ON "RestaurantPrinterSettings"("restaurantId");
CREATE UNIQUE INDEX "RestaurantNotificationSettings_restaurantId_key" ON "RestaurantNotificationSettings"("restaurantId");
CREATE UNIQUE INDEX "DeliveryZone_restaurantId_name_key" ON "DeliveryZone"("restaurantId", "name");
CREATE UNIQUE INDEX "InventoryItem_restaurantId_name_key" ON "InventoryItem"("restaurantId", "name");

ALTER TABLE "RestaurantPrinterSettings" ADD CONSTRAINT "RestaurantPrinterSettings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RestaurantNotificationSettings" ADD CONSTRAINT "RestaurantNotificationSettings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

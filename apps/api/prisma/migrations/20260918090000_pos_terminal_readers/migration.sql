-- Stripe Terminal card-present readers (additive).
CREATE TYPE "PosTerminalReaderStatus" AS ENUM ('ACTIVE', 'REMOVED');

ALTER TABLE "RestaurantMerchantAccount" ADD COLUMN "stripeTerminalLocationId" TEXT;

CREATE TABLE "PosTerminalReader" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "locationId" TEXT,
    "stripeReaderId" TEXT NOT NULL,
    "stripeLocationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "deviceTypeLabel" TEXT,
    "serialNumber" TEXT,
    "status" "PosTerminalReaderStatus" NOT NULL DEFAULT 'ACTIVE',
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "registeredByUserId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTerminalReader_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosTerminalReader_stripeReaderId_key" ON "PosTerminalReader"("stripeReaderId");
CREATE INDEX "PosTerminalReader_restaurantId_status_idx" ON "PosTerminalReader"("restaurantId", "status");
CREATE INDEX "PosTerminalReader_locationId_idx" ON "PosTerminalReader"("locationId");

ALTER TABLE "PosTerminalReader" ADD CONSTRAINT "PosTerminalReader_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosTerminalReader" ADD CONSTRAINT "PosTerminalReader_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

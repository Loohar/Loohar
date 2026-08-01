ALTER TYPE "PosReceiptKind" ADD VALUE IF NOT EXISTS 'GUEST_CHECK';

ALTER TABLE "Order" ADD COLUMN "locationId" TEXT;

ALTER TABLE "Order"
ADD CONSTRAINT "Order_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "RestaurantLocation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_restaurantId_locationId_updatedAt_idx"
ON "Order"("restaurantId", "locationId", "updatedAt");

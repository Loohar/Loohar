-- L-03: customer checkout idempotency. Additive and nullable; existing rows keep NULL keys.
ALTER TABLE "RestaurantOrderPayment"
  ADD COLUMN IF NOT EXISTS "checkoutIdempotencyKeyHash" TEXT,
  ADD COLUMN IF NOT EXISTS "checkoutRequestHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantOrderPayment_checkoutIdempotencyKeyHash_key"
  ON "RestaurantOrderPayment"("checkoutIdempotencyKeyHash");

-- Stripe payment certification hardening.
-- Additive migration: preserves existing tenants, subscriptions, orders, and payments.

ALTER TABLE "PlatformSubscription"
  ADD COLUMN IF NOT EXISTS "stripeProductId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePriceId" TEXT,
  ADD COLUMN IF NOT EXISTS "billingInterval" TEXT,
  ADD COLUMN IF NOT EXISTS "latestInvoiceStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "lastWebhookEventAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "PlatformSubscription_stripePriceId_idx"
  ON "PlatformSubscription"("stripePriceId");

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformInvoice_providerInvoiceId_key"
  ON "PlatformInvoice"("providerInvoiceId");

ALTER TABLE "RestaurantMerchantAccount"
  ADD COLUMN IF NOT EXISTS "accountType" TEXT,
  ADD COLUMN IF NOT EXISTS "country" TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantMerchantAccount_stripeAccountId_key"
  ON "RestaurantMerchantAccount"("stripeAccountId");

CREATE TABLE IF NOT EXISTS "PaymentQuote" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE_CONNECT',
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "subtotalCents" INTEGER NOT NULL,
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  "taxableAmountCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents" INTEGER NOT NULL DEFAULT 0,
  "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
  "serviceFeeCents" INTEGER NOT NULL DEFAULT 0,
  "restaurantTipCents" INTEGER NOT NULL DEFAULT 0,
  "driverTipCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL,
  "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
  "restaurantGrossCents" INTEGER NOT NULL,
  "restaurantNetCents" INTEGER NOT NULL,
  "quoteJson" JSONB,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentQuote_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PaymentQuote_restaurantId_idx"
  ON "PaymentQuote"("restaurantId");

CREATE INDEX IF NOT EXISTS "PaymentQuote_expiresAt_idx"
  ON "PaymentQuote"("expiresAt");

ALTER TABLE "RestaurantOrderPayment"
  ADD COLUMN IF NOT EXISTS "paymentQuoteId" TEXT,
  ADD COLUMN IF NOT EXISTS "transferAmountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stripeFeeCents" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantOrderPayment_paymentQuoteId_key"
  ON "RestaurantOrderPayment"("paymentQuoteId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RestaurantOrderPayment_paymentQuoteId_fkey'
  ) THEN
    ALTER TABLE "RestaurantOrderPayment"
      ADD CONSTRAINT "RestaurantOrderPayment_paymentQuoteId_fkey"
      FOREIGN KEY ("paymentQuoteId") REFERENCES "PaymentQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "RestaurantRefund"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "applicationFeeRefundedCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "transferReversedCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantRefund_providerRefundId_key"
  ON "RestaurantRefund"("providerRefundId");

CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantRefund_idempotencyKey_key"
  ON "RestaurantRefund"("idempotencyKey");

ALTER TABLE "RestaurantPaymentDispute"
  ADD COLUMN IF NOT EXISTS "providerChargeId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerPaymentIntentId" TEXT,
  ADD COLUMN IF NOT EXISTS "metadataJson" JSONB,
  ADD COLUMN IF NOT EXISTS "openedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "RestaurantPaymentDispute_providerChargeId_idx"
  ON "RestaurantPaymentDispute"("providerChargeId");

CREATE INDEX IF NOT EXISTS "RestaurantPaymentDispute_providerPaymentIntentId_idx"
  ON "RestaurantPaymentDispute"("providerPaymentIntentId");

ALTER TABLE "RestaurantPayout"
  ADD COLUMN IF NOT EXISTS "metadataJson" JSONB;

CREATE TABLE IF NOT EXISTS "PaymentReconciliationRecord" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "orderPaymentId" TEXT,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE_CONNECT',
  "recordType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expectedCents" INTEGER NOT NULL DEFAULT 0,
  "actualCents" INTEGER NOT NULL DEFAULT 0,
  "deltaCents" INTEGER NOT NULL DEFAULT 0,
  "providerObjectId" TEXT,
  "providerEventId" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReconciliationRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentReconciliationRecord_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentReconciliationRecord_orderPaymentId_fkey" FOREIGN KEY ("orderPaymentId") REFERENCES "RestaurantOrderPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PaymentReconciliationRecord_restaurantId_idx"
  ON "PaymentReconciliationRecord"("restaurantId");

CREATE INDEX IF NOT EXISTS "PaymentReconciliationRecord_orderPaymentId_idx"
  ON "PaymentReconciliationRecord"("orderPaymentId");

CREATE INDEX IF NOT EXISTS "PaymentReconciliationRecord_providerObjectId_idx"
  ON "PaymentReconciliationRecord"("providerObjectId");

CREATE INDEX IF NOT EXISTS "PaymentReconciliationRecord_recordType_idx"
  ON "PaymentReconciliationRecord"("recordType");

CREATE INDEX IF NOT EXISTS "PaymentReconciliationRecord_status_idx"
  ON "PaymentReconciliationRecord"("status");

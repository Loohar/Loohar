DO $$ BEGIN
  CREATE TYPE "PlatformBillingStatus" AS ENUM ('INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PendingRegistrationStatus" AS ENUM ('STARTED', 'CHECKOUT_CREATED', 'PAYMENT_VERIFIED', 'TENANT_CREATED', 'EXPIRED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MerchantOnboardingStatus" AS ENUM ('NOT_STARTED', 'DETAILS_SUBMITTED', 'ACTION_REQUIRED', 'PENDING_VERIFICATION', 'ENABLED', 'RESTRICTED', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderPaymentStatus" AS ENUM ('REQUIRES_PAYMENT_METHOD', 'REQUIRES_CONFIRMATION', 'PROCESSING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE_CONNECT', 'AUTHORIZE_NET', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FinancialEventDomain" AS ENUM ('PLATFORM_BILLING', 'RESTAURANT_ORDER_PAYMENT', 'MERCHANT_ACCOUNT', 'PAYOUT', 'DISPUTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DisputeStatus" AS ENUM ('WARNING_NEEDS_RESPONSE', 'WARNING_UNDER_REVIEW', 'WARNING_CLOSED', 'NEEDS_RESPONSE', 'UNDER_REVIEW', 'WON', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PlatformPlan" (
  "id" TEXT NOT NULL,
  "code" "SubscriptionPlanCode" NOT NULL,
  "name" TEXT NOT NULL,
  "monthlyPriceCents" INTEGER NOT NULL,
  "annualPriceCents" INTEGER,
  "trialDays" INTEGER NOT NULL DEFAULT 14,
  "stripePriceIdMonthly" TEXT,
  "stripePriceIdAnnual" TEXT,
  "authorizeNetPlanId" TEXT,
  "featuresJson" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlatformSubscription" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT,
  "planId" TEXT NOT NULL,
  "status" "PlatformBillingStatus" NOT NULL DEFAULT 'INCOMPLETE',
  "provider" TEXT NOT NULL DEFAULT 'stripe_platform',
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripeCheckoutSessionId" TEXT,
  "authorizeNetCustomerId" TEXT,
  "authorizeNetSubscriptionId" TEXT,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "trialEndsAt" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "canceledAt" TIMESTAMP(3),
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlatformInvoice" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'stripe_platform',
  "providerInvoiceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL,
  "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "hostedInvoiceUrl" TEXT,
  "invoicePdfUrl" TEXT,
  "paidAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlatformBillingEvent" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "eventDomain" "FinancialEventDomain" NOT NULL DEFAULT 'PLATFORM_BILLING',
  "provider" TEXT NOT NULL DEFAULT 'stripe_platform',
  "providerEventId" TEXT,
  "eventType" TEXT NOT NULL,
  "payloadJson" JSONB,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformBillingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PendingRegistration" (
  "id" TEXT NOT NULL,
  "ownerEmail" TEXT NOT NULL,
  "ownerName" TEXT,
  "businessName" TEXT NOT NULL,
  "publicBusinessName" TEXT,
  "slug" TEXT NOT NULL,
  "businessType" "BusinessType" NOT NULL DEFAULT 'RESTAURANT',
  "planCode" "SubscriptionPlanCode" NOT NULL DEFAULT 'STARTER',
  "status" "PendingRegistrationStatus" NOT NULL DEFAULT 'STARTED',
  "stripeCheckoutSessionId" TEXT,
  "stripeCustomerId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'stripe_platform',
  "restaurantId" TEXT,
  "registrationJson" JSONB,
  "expiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendingRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SlugReservation" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "ownerEmail" TEXT,
  "restaurantId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SlugReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RestaurantMerchantAccount" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE_CONNECT',
  "status" "MerchantOnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "stripeAccountId" TEXT,
  "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
  "authorizeNetMerchantId" TEXT,
  "defaultCurrency" TEXT NOT NULL DEFAULT 'usd',
  "requirementsJson" JSONB,
  "disabledReason" TEXT,
  "onboardingUrlExpiresAt" TIMESTAMP(3),
  "enabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantMerchantAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RestaurantOrderPayment" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE_CONNECT',
  "status" "OrderPaymentStatus" NOT NULL DEFAULT 'REQUIRES_PAYMENT_METHOD',
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
  "providerPaymentIntentId" TEXT,
  "providerChargeId" TEXT,
  "providerCustomerId" TEXT,
  "providerClientSecret" TEXT,
  "failureReason" TEXT,
  "authorizedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "quoteJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantOrderPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RestaurantPaymentEvent" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT,
  "paymentId" TEXT,
  "eventDomain" "FinancialEventDomain" NOT NULL DEFAULT 'RESTAURANT_ORDER_PAYMENT',
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT,
  "eventType" TEXT NOT NULL,
  "payloadJson" JSONB,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RestaurantPaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RestaurantRefund" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "orderPaymentId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE_CONNECT',
  "providerRefundId" TEXT,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT,
  "requestedByUserId" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantRefund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RestaurantPaymentDispute" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "orderPaymentId" TEXT,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE_CONNECT',
  "providerDisputeId" TEXT,
  "status" "DisputeStatus" NOT NULL DEFAULT 'NEEDS_RESPONSE',
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "reason" TEXT,
  "evidenceDueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantPaymentDispute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RestaurantPayout" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE_CONNECT',
  "providerPayoutId" TEXT,
  "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "arrivalDate" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RestaurantPayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrderTaxSnapshot" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'manual',
  "taxableAmountCents" INTEGER NOT NULL,
  "taxRateBps" INTEGER NOT NULL DEFAULT 825,
  "taxCents" INTEGER NOT NULL,
  "jurisdictionJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderTaxSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DriverEarningLedger" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "driverId" TEXT,
  "orderId" TEXT,
  "deliveryId" TEXT,
  "baseEarningsCents" INTEGER NOT NULL DEFAULT 0,
  "tipCents" INTEGER NOT NULL DEFAULT 0,
  "adjustmentCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" TEXT NOT NULL DEFAULT 'EARNED',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverEarningLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DeliveryFeeRule" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "orderType" "OrderType" NOT NULL DEFAULT 'DELIVERY',
  "radiusMiles" DOUBLE PRECISION,
  "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
  "minimumOrderCents" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryFeeRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TaxConfiguration" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'manual',
  "taxRateBps" INTEGER NOT NULL DEFAULT 825,
  "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "nexusJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformPlan_code_key" ON "PlatformPlan"("code");
CREATE INDEX IF NOT EXISTS "PlatformSubscription_restaurantId_idx" ON "PlatformSubscription"("restaurantId");
CREATE INDEX IF NOT EXISTS "PlatformSubscription_stripeCustomerId_idx" ON "PlatformSubscription"("stripeCustomerId");
CREATE INDEX IF NOT EXISTS "PlatformSubscription_stripeSubscriptionId_idx" ON "PlatformSubscription"("stripeSubscriptionId");
CREATE INDEX IF NOT EXISTS "PlatformInvoice_subscriptionId_idx" ON "PlatformInvoice"("subscriptionId");
CREATE INDEX IF NOT EXISTS "PlatformInvoice_providerInvoiceId_idx" ON "PlatformInvoice"("providerInvoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformBillingEvent_providerEventId_key" ON "PlatformBillingEvent"("providerEventId");
CREATE INDEX IF NOT EXISTS "PlatformBillingEvent_subscriptionId_idx" ON "PlatformBillingEvent"("subscriptionId");
CREATE INDEX IF NOT EXISTS "PlatformBillingEvent_eventDomain_idx" ON "PlatformBillingEvent"("eventDomain");
CREATE UNIQUE INDEX IF NOT EXISTS "PendingRegistration_slug_key" ON "PendingRegistration"("slug");
CREATE INDEX IF NOT EXISTS "PendingRegistration_ownerEmail_idx" ON "PendingRegistration"("ownerEmail");
CREATE INDEX IF NOT EXISTS "PendingRegistration_stripeCheckoutSessionId_idx" ON "PendingRegistration"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "SlugReservation_slug_key" ON "SlugReservation"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantMerchantAccount_restaurantId_provider_key" ON "RestaurantMerchantAccount"("restaurantId", "provider");
CREATE INDEX IF NOT EXISTS "RestaurantMerchantAccount_stripeAccountId_idx" ON "RestaurantMerchantAccount"("stripeAccountId");
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantOrderPayment_orderId_key" ON "RestaurantOrderPayment"("orderId");
CREATE INDEX IF NOT EXISTS "RestaurantOrderPayment_restaurantId_idx" ON "RestaurantOrderPayment"("restaurantId");
CREATE INDEX IF NOT EXISTS "RestaurantOrderPayment_providerPaymentIntentId_idx" ON "RestaurantOrderPayment"("providerPaymentIntentId");
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantPaymentEvent_providerEventId_key" ON "RestaurantPaymentEvent"("providerEventId");
CREATE INDEX IF NOT EXISTS "RestaurantPaymentEvent_restaurantId_idx" ON "RestaurantPaymentEvent"("restaurantId");
CREATE INDEX IF NOT EXISTS "RestaurantPaymentEvent_paymentId_idx" ON "RestaurantPaymentEvent"("paymentId");
CREATE INDEX IF NOT EXISTS "RestaurantPaymentEvent_eventDomain_idx" ON "RestaurantPaymentEvent"("eventDomain");
CREATE INDEX IF NOT EXISTS "RestaurantRefund_restaurantId_idx" ON "RestaurantRefund"("restaurantId");
CREATE INDEX IF NOT EXISTS "RestaurantRefund_orderPaymentId_idx" ON "RestaurantRefund"("orderPaymentId");
CREATE INDEX IF NOT EXISTS "RestaurantRefund_providerRefundId_idx" ON "RestaurantRefund"("providerRefundId");
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantPaymentDispute_providerDisputeId_key" ON "RestaurantPaymentDispute"("providerDisputeId");
CREATE INDEX IF NOT EXISTS "RestaurantPaymentDispute_restaurantId_idx" ON "RestaurantPaymentDispute"("restaurantId");
CREATE INDEX IF NOT EXISTS "RestaurantPaymentDispute_orderPaymentId_idx" ON "RestaurantPaymentDispute"("orderPaymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "RestaurantPayout_providerPayoutId_key" ON "RestaurantPayout"("providerPayoutId");
CREATE INDEX IF NOT EXISTS "RestaurantPayout_restaurantId_idx" ON "RestaurantPayout"("restaurantId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderTaxSnapshot_orderId_key" ON "OrderTaxSnapshot"("orderId");
CREATE INDEX IF NOT EXISTS "DriverEarningLedger_restaurantId_idx" ON "DriverEarningLedger"("restaurantId");
CREATE INDEX IF NOT EXISTS "DriverEarningLedger_driverId_idx" ON "DriverEarningLedger"("driverId");
CREATE INDEX IF NOT EXISTS "DriverEarningLedger_orderId_idx" ON "DriverEarningLedger"("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryFeeRule_restaurantId_name_key" ON "DeliveryFeeRule"("restaurantId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "TaxConfiguration_restaurantId_provider_key" ON "TaxConfiguration"("restaurantId", "provider");

ALTER TABLE "PlatformSubscription" ADD CONSTRAINT "PlatformSubscription_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformSubscription" ADD CONSTRAINT "PlatformSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PlatformPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PlatformSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingEvent" ADD CONSTRAINT "PlatformBillingEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PlatformSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RestaurantMerchantAccount" ADD CONSTRAINT "RestaurantMerchantAccount_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RestaurantOrderPayment" ADD CONSTRAINT "RestaurantOrderPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RestaurantOrderPayment" ADD CONSTRAINT "RestaurantOrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RestaurantPaymentEvent" ADD CONSTRAINT "RestaurantPaymentEvent_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RestaurantPaymentEvent" ADD CONSTRAINT "RestaurantPaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "RestaurantOrderPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RestaurantRefund" ADD CONSTRAINT "RestaurantRefund_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RestaurantRefund" ADD CONSTRAINT "RestaurantRefund_orderPaymentId_fkey" FOREIGN KEY ("orderPaymentId") REFERENCES "RestaurantOrderPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RestaurantPaymentDispute" ADD CONSTRAINT "RestaurantPaymentDispute_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RestaurantPaymentDispute" ADD CONSTRAINT "RestaurantPaymentDispute_orderPaymentId_fkey" FOREIGN KEY ("orderPaymentId") REFERENCES "RestaurantOrderPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RestaurantPayout" ADD CONSTRAINT "RestaurantPayout_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderTaxSnapshot" ADD CONSTRAINT "OrderTaxSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverEarningLedger" ADD CONSTRAINT "DriverEarningLedger_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverEarningLedger" ADD CONSTRAINT "DriverEarningLedger_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriverEarningLedger" ADD CONSTRAINT "DriverEarningLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryFeeRule" ADD CONSTRAINT "DeliveryFeeRule_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxConfiguration" ADD CONSTRAINT "TaxConfiguration_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

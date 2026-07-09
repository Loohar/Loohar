ALTER TABLE "Payment"
ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripePaymentIntentId" TEXT;

ALTER TABLE "RestaurantWebsiteSettings"
ADD COLUMN "headingFont" TEXT,
ADD COLUMN "bodyFont" TEXT,
ADD COLUMN "sectionSettingsJson" JSONB,
ADD COLUMN "storeHoursJson" JSONB;

ALTER TABLE "TenantSubscription"
ADD COLUMN "renewalDate" TIMESTAMP(3),
ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripeSubscriptionId" TEXT;

-- CreateEnum
CREATE TYPE "TenantLifecycleStatus" AS ENUM ('DRAFT', 'PENDING_OWNER_VERIFICATION', 'PENDING_SETUP', 'INTRO_TRIAL', 'TRIAL_EXPIRING', 'TRIAL_EXPIRED', 'PAYMENT_METHOD_REQUIRED', 'PENDING_PAYMENT', 'ACTIVE_PAID', 'PAST_DUE', 'PAYMENT_FAILED', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELED', 'ARCHIVED', 'COMPLIMENTARY', 'MANUAL_INVOICE');

-- CreateEnum
CREATE TYPE "PaymentLifecycleStatus" AS ENUM ('NOT_REQUIRED', 'PAYMENT_METHOD_REQUIRED', 'PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'PAYMENT_FAILED', 'CANCELED', 'MANUAL_INVOICE', 'COMPLIMENTARY');

-- CreateEnum
CREATE TYPE "PlatformBillingMode" AS ENUM ('INTRO_TRIAL', 'PAYMENT_LINK', 'STRIPE_CHECKOUT', 'COMPLIMENTARY', 'MANUAL_INVOICE', 'DRAFT');

-- CreateEnum
CREATE TYPE "TrialReminderStatus" AS ENUM ('SCHEDULED', 'SENT', 'SKIPPED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "SavingsBaselineStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'PAUSED', 'FINALIZED');

-- AlterTable
ALTER TABLE "Restaurant"
ADD COLUMN "tenantLifecycleStatus" "TenantLifecycleStatus" NOT NULL DEFAULT 'PENDING_SETUP',
ADD COLUMN "paymentLifecycleStatus" "PaymentLifecycleStatus" NOT NULL DEFAULT 'PAYMENT_METHOD_REQUIRED',
ADD COLUMN "billingMode" "PlatformBillingMode" NOT NULL DEFAULT 'INTRO_TRIAL',
ADD COLUMN "introductoryProgramName" TEXT,
ADD COLUMN "introductoryProgramVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "trialStartedAt" TIMESTAMP(3),
ADD COLUMN "trialEndsAt" TIMESTAMP(3),
ADD COLUMN "trialGraceEndsAt" TIMESTAMP(3),
ADD COLUMN "trialConfigJson" JSONB;

-- CreateTable
CREATE TABLE "PlatformProgramConfig" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "introductoryProgramEnabled" BOOLEAN NOT NULL DEFAULT true,
  "programName" TEXT NOT NULL DEFAULT '90-Day Introductory Program',
  "defaultTrialDays" INTEGER NOT NULL DEFAULT 90,
  "requirePaymentMethodAtSignup" BOOLEAN NOT NULL DEFAULT false,
  "requirePaymentMethodBeforeExpirationDay" INTEGER NOT NULL DEFAULT 15,
  "autoChargeWithoutExplicitAuthorization" BOOLEAN NOT NULL DEFAULT false,
  "allowSuperAdminComplimentaryAccounts" BOOLEAN NOT NULL DEFAULT true,
  "allowManualInvoice" BOOLEAN NOT NULL DEFAULT true,
  "defaultTrialPlan" "SubscriptionPlanCode" NOT NULL DEFAULT 'PROFESSIONAL',
  "defaultTrialModules" "BusinessModule"[] NOT NULL DEFAULT ARRAY['RESTAURANT_ORDERING'::"BusinessModule", 'PICKUP'::"BusinessModule", 'DELIVERY'::"BusinessModule", 'DRIVER_MANAGEMENT'::"BusinessModule", 'LOYALTY'::"BusinessModule", 'COUPONS'::"BusinessModule", 'DELIVERY_ZONES'::"BusinessModule", 'FOOD_CATALOG'::"BusinessModule"],
  "trialReminderSchedule" JSONB,
  "trialGracePeriodDays" INTEGER NOT NULL DEFAULT 7,
  "autoSuspendAfterGracePeriod" BOOLEAN NOT NULL DEFAULT false,
  "allowTrialExtension" BOOLEAN NOT NULL DEFAULT true,
  "maximumTrialExtensionDays" INTEGER NOT NULL DEFAULT 30,
  "savingsReportEnabled" BOOLEAN NOT NULL DEFAULT true,
  "aiInsightsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "marketingAutomationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlatformProgramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialEnrollment" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "platformSubscriptionId" TEXT,
  "programKey" TEXT NOT NULL,
  "programName" TEXT NOT NULL,
  "programVersion" INTEGER NOT NULL DEFAULT 1,
  "planCode" "SubscriptionPlanCode" NOT NULL,
  "billingMode" "PlatformBillingMode" NOT NULL,
  "status" "TenantLifecycleStatus" NOT NULL DEFAULT 'INTRO_TRIAL',
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "graceEndsAt" TIMESTAMP(3),
  "extendedUntil" TIMESTAMP(3),
  "extensionCount" INTEGER NOT NULL DEFAULT 0,
  "configSnapshotJson" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TrialEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSchedule" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "TrialReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
  "dedupeKey" TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsBaseline" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "status" "SavingsBaselineStatus" NOT NULL DEFAULT 'ACTIVE',
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "baselineJson" JSONB,
  "assumptionsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SavingsBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformProgramConfig_key_key" ON "PlatformProgramConfig"("key");

-- CreateIndex
CREATE INDEX "TrialEnrollment_restaurantId_idx" ON "TrialEnrollment"("restaurantId");

-- CreateIndex
CREATE INDEX "TrialEnrollment_status_idx" ON "TrialEnrollment"("status");

-- CreateIndex
CREATE INDEX "TrialEnrollment_endsAt_idx" ON "TrialEnrollment"("endsAt");

-- CreateIndex
CREATE INDEX "NotificationSchedule_restaurantId_idx" ON "NotificationSchedule"("restaurantId");

-- CreateIndex
CREATE INDEX "NotificationSchedule_scheduledFor_idx" ON "NotificationSchedule"("scheduledFor");

-- CreateIndex
CREATE INDEX "NotificationSchedule_status_idx" ON "NotificationSchedule"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSchedule_dedupeKey_key" ON "NotificationSchedule"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsBaseline_restaurantId_key" ON "SavingsBaseline"("restaurantId");

-- AddForeignKey
ALTER TABLE "TrialEnrollment" ADD CONSTRAINT "TrialEnrollment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSchedule" ADD CONSTRAINT "NotificationSchedule_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsBaseline" ADD CONSTRAINT "SavingsBaseline_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

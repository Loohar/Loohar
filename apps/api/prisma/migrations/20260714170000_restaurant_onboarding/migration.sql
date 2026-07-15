CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'READY_TO_PUBLISH', 'COMPLETED', 'BLOCKED');

ALTER TABLE "Restaurant"
  ADD COLUMN "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "onboardingCurrentStep" TEXT NOT NULL DEFAULT 'business',
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingStartedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingSkippedSteps" JSONB,
  ADD COLUMN "websitePublishedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "RestaurantWebsiteSettings"
  ADD COLUMN "mobileHeroImageUrl" TEXT,
  ADD COLUMN "faviconUrl" TEXT,
  ADD COLUMN "buttonColor" TEXT,
  ADD COLUMN "ctaText" TEXT,
  ADD COLUMN "contactMessage" TEXT,
  ADD COLUMN "cateringMessage" TEXT,
  ADD COLUMN "publicEmail" TEXT,
  ADD COLUMN "seoKeywords" TEXT,
  ADD COLUMN "canonicalUrl" TEXT,
  ADD COLUMN "ogImageUrl" TEXT,
  ADD COLUMN "indexingEnabled" BOOLEAN NOT NULL DEFAULT true;

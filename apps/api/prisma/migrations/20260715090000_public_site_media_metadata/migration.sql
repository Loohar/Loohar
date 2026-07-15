-- Add lightweight public-site media metadata without changing the existing media architecture.
ALTER TABLE "RestaurantGalleryImage"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "RestaurantSocialLink"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

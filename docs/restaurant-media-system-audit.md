# Restaurant Media System Audit

## Current Scope

This audit documents the existing restaurant media upload system for logo, hero, gallery, and menu item images. This phase does not modify image upload, Supabase Storage, media persistence, or public-site rendering.

## Upload Architecture

- Backend upload routes live in `apps/api/src/routes/uploads.js`.
- Upload routes are mounted from `apps/api/src/server.js` at `/uploads` and `/api/uploads`.
- Storage provider logic lives in `apps/api/src/services/uploadService.js`.
- Frontend upload entry points live in `apps/web/src/App.jsx`.

## Current Upload Entry Points

- Restaurant logo: `uploadLogo`
- Restaurant hero image: `uploadHero`
- Gallery images: `uploadGalleryImage`
- Menu item image: `uploadMenuItemImage`
- Shared upload helper: `uploadRestaurantImage`

## Existing Backend Endpoints

- `POST /api/uploads/restaurant-logo`
- `POST /api/uploads/restaurant-hero`
- `POST /api/uploads/menu-item/:menuItemId`
- `POST /api/uploads/gallery`

## Current Storage Expectations

The upload service expects Supabase Storage configuration through backend-only environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`

The frontend should never receive or store the Supabase service role key.

## Current Tenant Isolation Expectations

Uploads should be authenticated through the backend and scoped to the restaurant tenant associated with the current user. Menu item uploads should only update menu items that belong to the current tenant.

## Known Media Risk Areas For A Future Phase

- Verify every upload endpoint rejects oversized files and unsupported MIME types.
- Verify SVG upload is only allowed where appropriate.
- Verify file names are sanitized before storage.
- Verify public website image fallback logic never replaces a valid fallback with an empty API image field.
- Verify uploaded image URLs persist after refresh and appear on public restaurant websites.
- Verify menu item image uploads work both after item creation and during the item creation flow.

## Verification Checklist For The Dedicated Media Phase

- Upload a logo and confirm the public navbar renders it.
- Upload a hero image and confirm the public homepage renders it.
- Upload gallery images and confirm the public gallery renders them.
- Upload a menu item image and confirm public menu/order pages render it.
- Refresh after each upload and confirm persisted URLs remain visible.
- Confirm no broken image placeholders appear when live API image fields are empty.

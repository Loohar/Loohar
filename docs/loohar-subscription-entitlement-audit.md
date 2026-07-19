# Loohar Subscription Entitlement Audit

Last updated: July 19, 2026

## Release Decision

This audit adds server-side subscription enforcement for restaurant tenant features. The release gates pass as of July 19, 2026, so the entitlement layer is ready for a production deployment review.

- `npm run lint`
- `npm run build`
- `npm run security:scan`
- `npm run test:entitlements`
- `npm run test:subscription`
- `npm run test:plans`
- `npm run test:loading-states`
- `npm run test:public-routing`
- `npm run test:tenant-isolation`
- `npm run test:registration-browsers`
- `npm run smoke:test`

Additional schema validation passed with a temporary `DIRECT_URL` value because this local `.env` file does not currently define `DIRECT_URL`.

## Plan Matrix

| Feature | Starter | Professional | Enterprise |
| --- | --- | --- | --- |
| Direct online ordering | Yes | Yes | Yes |
| Pickup ordering | Yes | Yes | Yes |
| Order payments | Yes | Yes | Yes |
| Order tracking | Yes | Yes | Yes |
| Food catalog | Yes | Yes | Yes |
| Menu management | Yes | Yes | Yes |
| Restaurant website | Yes | Yes | Yes |
| Branding and basic settings | Yes | Yes | Yes |
| Delivery ordering | No | Yes | Yes |
| Driver management and dispatch | No | Yes | Yes |
| Delivery zones | No | Yes | Yes |
| Customer CRM | No | Yes | Yes |
| Loyalty program | No | Yes | Yes |
| Coupons and promotions | No | Yes | Yes |
| Employee management | No | Yes | Yes |
| Kitchen display system | No | Yes | Yes |
| Receipt and ticket printing | No | Yes | Yes |
| SMS and email notifications | No | Yes | Yes |
| Inventory foundation | No | Yes | Yes |
| Restaurant payment onboarding | No | Yes | Yes |
| Advanced reports | No | No | Yes |
| Analytics dashboard | No | No | Yes |
| Menu insights | No | No | Yes |
| Multi-location | No | No | Yes |
| White label | No | No | Yes |
| Custom domains | No | No | Yes |
| Advanced CRM | No | No | Yes |
| POS integrations | No | No | Yes |

## Usage Limits

Feature access is plan-based, and selected mutable resources also have server-side usage limits. These limits are enforced before database writes and cannot be bypassed by showing hidden buttons, changing local storage, or calling APIs directly.

| Limit | Starter | Professional | Enterprise |
| --- | --- | --- | --- |
| Menu items | 50 | 250 | Unlimited |
| Employee seats | 0 | 25 | Unlimited |
| Delivery zones | 0 | 10 | Unlimited |
| Gallery images | 10 | 50 | Unlimited |
| Restaurant locations | 1 | 1 | Unlimited |

## Database Audit

Primary subscription truth is stored in `PlatformSubscription`, which includes `restaurantId`, `planId`, `status`, `stripeCustomerId`, `stripeSubscriptionId`, `trialEndsAt`, current period dates, and cancellation metadata. The older `TenantSubscription` table remains supported as a legacy fallback for tenants created by the master admin.

Tenant feature flags live on `Restaurant.enabledModules`. Tenant operational access is also affected by `Restaurant.status`; `SUSPENDED`, `DELETED`, and `PENDING` tenants receive no feature access.

Current constraints include unique plan codes, unique restaurant slugs, foreign keys from subscription records to restaurants/plans, and Stripe customer/subscription indexes. Plan-specific feature access is enforced in application middleware, not only by UI visibility.

## API Security Audit

The entitlement layer is centralized in:

- `apps/api/src/config/entitlements.js`
- `apps/api/src/middleware/entitlements.js`

Protected API surfaces now use `featureGuard()` or `assertFeatureForRestaurant()` for:

- Restaurant dashboard, settings, website, branding, menu, orders
- Delivery, drivers, dispatch, driver app, delivery zones
- Customer CRM, loyalty, coupons, promotions
- KDS, printing, employees, notifications, inventory
- Reports, analytics, menu insights, multi-location, custom domains
- Public menu, public order config, public ordering, reorder, tips, and payment setup

Denied features return `403` with `FEATURE_NOT_INCLUDED`, `FEATURE_DISABLED`, `SUBSCRIPTION_READ_ONLY`, or `SUBSCRIPTION_SUSPENDED`.

Usage-limit denials return `403` with `USAGE_LIMIT_REACHED`, the current plan, current usage, requested increment, and the plan limit.

## Subscription States

- `ACTIVE`: full access
- `TRIALING`: full access
- `PAST_DUE`: full access with warning header/context
- `UNPAID`: read-only
- `CANCELLED` / Stripe `CANCELED`: read-only
- `SUSPENDED`: no access

## Stripe Validation

Direct tenant plan mutation is not allowed from the frontend. `/api/platform-billing/change-plan` returns provider-hosted behavior instead of mutating the database. Stripe platform webhook routes verify signatures before updating subscription status, plan, customer IDs, subscription IDs, and trial dates.

Subscription cancellation requests are sent to Stripe, but local subscription truth waits for the verified Stripe webhook before changing.

## Frontend Audit

Restaurant dashboard premium panels now show an `Upgrade Required` state when a tenant is below the required plan instead of silently failing. The backend remains authoritative, so route manipulation, hidden button changes, local storage edits, or browser devtools changes cannot grant access.

Registration and pricing now use explicit plan-loading states: `IDLE`, `LOADING`, `READY`, and `ERROR`. The public pages show neutral checkout-checking copy while the API status is unknown, keep the first registration step usable while plans load, and only show unavailable/error copy after the API responds or fails.

## Penetration Notes

Expected failures:

- Starter direct API call to loyalty, coupons, delivery zones, CRM, reports, analytics, or custom domains returns `403`.
- Professional direct API call to reports, analytics, menu insights, multi-location, white label, custom domains, or POS returns `403`.
- Read-only subscription states cannot mutate protected endpoints.
- Suspended tenants cannot access protected endpoints.
- Over-limit create calls for menu items, employees, delivery zones, and gallery images return `403` before creating records.
- Driver and restaurant operations remain tenant-scoped through existing tenant and driver ownership checks.

## Test Results

- `npm run lint`: passed
- `npm run build`: passed with the existing Vite chunk-size warning only
- `npm run security:scan`: passed
- `npm run test:entitlements`: passed
- `npm run test:subscription`: passed
- `npm run test:plans`: passed
- `npm run test:loading-states`: passed
- `npm run test:public-routing`: passed, 15/15 checks
- `npm run test:tenant-isolation`: passed, 9/9 checks
- `npm run test:registration-browsers`: passed, 12/12 Chromium/WebKit device scenarios
- `npm run smoke:test`: passed, 26/26 checks
- `npm --workspace apps/api run prisma:generate`: passed
- `npx prisma validate`: schema valid when `DIRECT_URL` is supplied

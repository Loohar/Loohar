# Loohar Architecture — Current State

Source: repository at candidate `1d30522` (2026-09-17). Describes what exists, not intent.

## Repository
npm workspaces monorepo:

```
apps/api      Express 4 + Socket.IO + Prisma 5 (PostgreSQL / Supabase)   → Render
apps/web      Vite + React SPA (single large App.jsx + apps/pos, apps/driver) → Vercel
apps/shared   Shared JS (offline POS pricing, reserved slugs)
scripts/      Release/test scripts (node *.mjs), security scan, version writer
docs/         Audits, tax provider notes, pilot control documents
render.yaml   Render blueprint (service loohar-api, deploys from main, preDeploy migrations)
```

## Runtime topology

```
Browser (loohar.com, tenant sites, staff PWA, driver PWA)
   │  HTTPS
   ├─► Vercel (apps/web)  ── rewrites /api/*, /health → loohar-api.onrender.com
   │                          (or direct calls when VITE_API_URL is absolute)
   └─► Render loohar-api (apps/api) ── Prisma ──► Supabase Postgres
            │  Socket.IO (VITE_REALTIME_URL, authenticated)
            ├─► Stripe (platform billing account; Connect restaurant accounts)
            ├─► Supabase Storage (uploads)
            └─► Email provider (console or Resend)
Staging: loohar-api-staging.onrender.com + Vercel preview deployments (protected)
```

## API modules
| Area | Location |
| --- | --- |
| Auth & sessions | `routes/auth.js`, `middleware/auth.js`, `services/authSessionService.js`, `utils/tokens.js` |
| Restaurant admin | `routes/restaurant.js`, `routes/taxProfiles.js`, `routes/uploads.js` |
| Super Admin | `routes/superAdmin.js`, `routes/entitlementSimulation.js` |
| Public sites & ordering | `routes/public.js`, `routes/customer.js`, `routes/orders.js` |
| Online payments | `routes/orderPayments.js`, `modules/orderPayments/{quoteService,orderPaymentService,checkoutIdempotency,merchantReadiness}.js` |
| Stripe transport | `modules/paymentProviders/stripeRest.js` (REST, no SDK), `stripeWebhookEvents.js` |
| Webhooks | `routes/webhooks.js` (platform, Connect, Accounts v2, Authorize.Net disabled), legacy `routes/payments.js` |
| Platform billing | `routes/platformBilling.js`, `modules/platformBilling/platformBillingService.js` |
| Registration | `routes/registration.js`, `modules/registration/registrationService.js` |
| POS | `routes/pos.js`, `services/posService.js`, `posMenuReadModel.js`, `posHardwareService.js`, `middleware/posSession.js` |
| KDS | `routes/kitchen.js`, `services/realtimeService.js` |
| Drivers & delivery | `routes/driver.js`, models Delivery, DeliveryZone, DeliveryFeeRule, DriverEarningLedger |
| Tax | `services/taxDomain.js`, `services/taxProfileService.js` (Colorado TTR location tax on main; national provider frozen on separate branch) |
| Modifiers | `services/modifierValidationService.js`, `services/menuCustomizationService.js` |
| Health/version | `utils/healthPayload.js`, `utils/deploymentMetadata.js`, `utils/schemaCompatibility.js` |

## Data model (Prisma, main entities)
- Tenant: `Restaurant` (+ `RestaurantLocation`, `RestaurantDomain`, `RestaurantWebsiteSettings`,
  `TenantSubscription`, `TenantEntitlementSimulation`)
- People: `User` (`UserRole`), `RestaurantStaff`, `AuthSession`, `Customer`, `Driver`
- Menu: `MenuCategory`, `MenuItem`, `MenuItemOptionGroup`, `MenuItemOption`
- Orders: `Order`, `OrderItem`, `OrderStatusHistory`, `OrderQuote`, `OrderTaxSnapshot`
- Online payments: `RestaurantMerchantAccount`, `RestaurantOrderPayment`,
  `RestaurantPaymentEvent`, `RestaurantRefund`, `RestaurantPaymentDispute`, `RestaurantPayout`
- Legacy payments: `Payment`
- POS: `PosDevice`, `PosRegister`, `CashDrawer`, `CashDrawerSession`, `CashLedgerEntry`,
  `EmployeeShift`, `PosOrderSession`, `PosReceipt`, `PosOfflineReconciliation`
- Platform billing: `PlatformPlan`, `PlatformSubscription`, `PlatformInvoice`,
  `PlatformBillingEvent`, `SubscriptionPlan`, `TrialEnrollment`, `PendingRegistration`
- Tax: `TaxConfiguration`, `LocationTaxProfile`
- Delivery: `Delivery`, `DeliveryStatusHistory`, `DeliveryZone`, `DeliveryFeeRule`
- Audit: `AuditLog`

Known drift: migrations create objects not modelled in `schema.prisma` (L-10).

## Online checkout flow (candidate)
1. `POST /api/order-payments/quote` → server quote (menu prices, validated modifiers, tax
   profile, tips, fees).
2. `POST /api/order-payments/create` with `Idempotency-Key` → replay check → quote → merchant
   readiness → transaction: order + payment (key hash) + tax snapshot → Stripe PaymentIntent
   (idempotency key = payment id) on the restaurant's connected account → response with client
   secret and tracking token.
3. Browser confirms with Stripe.js.
4. `POST /api/webhooks/stripe-connect` → verify → event ledger → conditional settlement
   (payment PAID + order ACCEPTED + loyalty + coupon in one transaction) → notifications,
   realtime `order:update`, audit.
5. Customer status/receipt via tracking token.

## Deployment identity
- API `/version`, `/api/version`, `/health` expose `commitSha` (from `RENDER_GIT_COMMIT` etc.),
  environment and schema compatibility.
- Web build writes `public/version.json` (from `VERCEL_GIT_COMMIT_SHA` etc.); `/version`
  rewrites to it.

## Local verification environment
- Worktrees per change; dependencies cloned with `cp -Rc`.
- Disposable Postgres: `initdb` in a scratch directory, start with
  `-c unix_socket_directories='' -c listen_addresses=127.0.0.1 -p <port>`, then
  `DATABASE_URL=… DIRECT_URL=… npx prisma migrate deploy` from `apps/api`.

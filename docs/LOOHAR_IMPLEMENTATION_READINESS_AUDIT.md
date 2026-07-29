# Loohar Implementation Readiness Audit

Audit date: 2026-07-28 10:20:13 MDT

Branch: `hotfix/restaurant-operations-routing-and-pos`

Commit inspected: `685de88f87fa93487d09c0cb0feefd516d7efdaa`

Scope: evidence-based repository audit only. No product code, schema, dependency, environment, deployment, or database changes were made.

## 1. Executive verdict

Loohar currently has a substantial full-stack restaurant SaaS foundation: multi-tenant restaurants, JWT authentication, role-aware navigation, restaurant operations pages, public restaurant websites, customer ordering, driver workflows, subscription entitlement checks, Stripe-oriented billing/payment services, POS register software, kiosk mode, cash payment flows, receipts, QR generation, menu modifiers, kitchen routing hooks, upload handling, and a broad Prisma schema.

The codebase is strongest as a restaurant-owned web ordering and operations platform with a developing POS module. It is not yet a production-proven replacement for Toast, Square, Clover, or SpotOn.

What is genuinely implemented today:

- JWT login/session flow with server-side role checks and tenant checks.
- Restaurant owner/admin API surface for dashboard, menu, orders, customers, drivers, settings, coupons, loyalty, delivery zones, inventory foundation, reports, and analytics.
- POS source paths for menu loading, quote creation, order submission, held orders, kiosk mode, cash drawer sessions, shifts, devices, cash payments, hosted/card payment handoff, and receipts.
- Subscription entitlement middleware and source tests that check Starter, Professional, and Enterprise access rules.
- Public restaurant website/menu/order paths with tenant-aware data loading.
- Stripe-oriented platform subscription and Stripe Connect order-payment architecture.
- Resend/SendGrid-ready email architecture and Supabase Storage-backed upload architecture.

What is partially implemented:

- POS is functional by source and static tests, but lacks full end-to-end runtime certification against a disposable test environment and real hardware.
- Card-not-present restaurant payments are implemented in code, but production payment-readiness depends on verified Stripe account configuration, webhook delivery, reconciliation, and operational testing.
- KDS, dispatch, reports, analytics, loyalty, coupons, delivery zones, inventory, employee management, and notification settings have working foundations, but not all mature restaurant edge cases are covered.
- Restaurant settings are broad, but some sections are read-only or future-oriented.
- Driver app is a PWA/workflow foundation, not native app-store software.

What is visual, mocked, configured, or planned:

- Hardware printers, cash drawers, customer displays, barcode scanners, and card-reader terminals are not production-integrated; printer targets include future placeholders and browser printing.
- SMS is configuration-ready, but repository evidence shows placeholder behavior rather than a completed Twilio send path.
- Authorize.Net routes exist as disabled future/reserved webhooks.
- Offline POS order capture, durable sync queues, conflict resolution, and recovery are not implemented as restaurant-grade offline POS.
- Some frontend fallback/demo data remains for offline public/customer/driver flows.
- Integrations such as accounting, payroll, gift cards, reservations, maps/navigation, support ticketing, error monitoring, and developer API are absent or future-oriented.

Completely missing or not evidenced:

- Card-present terminal certification and device payment flow.
- Physical printer/cash drawer/card reader testing.
- Offline-first POS synchronization and duplicate prevention after reconnect.
- Authenticated Socket.IO room joining with tenant ownership checks.
- Formal PCI/SOC 2/GDPR/CCPA compliance program evidence.
- Load/stress testing and Friday-night-volume proof.
- Backup restore verification, runbooks, on-call procedures, support workflows, incident response, and operational SLAs.
- CI/CD workflow definitions in `.github`.

Pilot restaurant verdict: `CONDITIONALLY_READY` for a highly controlled pilot only if P0 gaps are resolved or mitigated, payment mode is limited to verified card-not-present/cash flows, staff are trained, and live operational monitoring is added.

Live restaurant payments verdict: `CONDITIONALLY_READY` for card-not-present only after Stripe production configuration, signed webhooks, reconciliation, refunds, duplicate-charge controls, and failure recovery are validated in a non-shared production-like environment. `NOT_READY` for card-present payments.

Replacement for Toast/Square/Clover/SpotOn today: `NOT_READY`.

Five largest risks:

1. Socket.IO join events are not authenticated or tenant-checked in the inspected realtime service.
2. POS has no proven offline order queue, sync recovery, hardware integration, or card-present certification.
3. Public order status/receipt-style access includes tokenless paths that could become IDOR/BOLA privacy issues if returned data expands.
4. Payment readiness depends on external Stripe configuration, webhook delivery, reconciliation, and operational verification not provable from the repository alone.
5. Production operations are under-evidenced: no load tests, no backup-restore proof, no monitoring/error tracking integration, no runbooks, and no CI workflow evidence.

Capability classification count from the audited capability groups:

| Status | Count |
| --- | ---: |
| `VERIFIED_IMPLEMENTED` | 27 |
| `IMPLEMENTED_UNVERIFIED` | 23 |
| `PARTIAL` | 31 |
| `UI_ONLY` | 2 |
| `MOCKED` | 3 |
| `CONFIG_ONLY` | 9 |
| `PLANNED_ONLY` | 3 |
| `MISSING` | 18 |
| `BLOCKED` | 6 |
| `NOT_APPLICABLE` | 1 |

Gap count:

| Priority | Count |
| --- | ---: |
| P0 | 9 |
| P1 | 16 |
| P2 | 14 |
| P3 | 8 |

## 2. Audit scope and methodology

This was an information-gathering audit based only on repository evidence and safe local verification. Existing uncommitted work was present before the audit and was not modified or reverted.

Pre-existing working-tree condition:

```text
 M apps/api/src/routes/restaurant.js
 M apps/web/src/App.jsx
 M apps/web/src/styles/index.css
 M scripts/customers-page-test.mjs
 M scripts/drivers-page-test.mjs
 M scripts/kitchen-page-test.mjs
 M scripts/orders-page-test.mjs
 M scripts/reports-page-test.mjs
 M scripts/restaurant-settings-routing-test.mjs
?? apps/api/src/services/restaurantMetricsService.js
```

Repository areas inspected:

- Root workspace and package scripts.
- `apps/api` Express API source.
- `apps/api/prisma/schema.prisma`, migrations, and seed script.
- `apps/web` React/Vite frontend source.
- Driver PWA module under `apps/web/src/apps/driver`.
- POS, restaurant, customer, driver, kitchen, public, auth, registration, payment, billing, upload, and webhook routes.
- Middleware for auth, tenant access, entitlements, validation, and sanitization.
- Payment, POS, notification, upload, and platform billing services.
- Test scripts under `scripts`.
- Deployment config in `render.yaml` and `apps/web/vercel.json`.
- Existing documentation under `docs`.

Systems not verified externally:

- Real Stripe account, products, prices, Connect accounts, webhook endpoints, and production/test-mode separation.
- Real Supabase production database state, RLS policies, backups, restore procedures, and storage bucket state.
- Real Resend/SendGrid deliverability.
- Real SMS provider delivery.
- DNS, Vercel, Render, firewall, and production routing settings.
- Physical printers, cash drawers, scanners, customer displays, tablets, card readers, or terminals.
- Native app-store publishing state.
- Real restaurant pilot history, uptime, support staffing, and incident response.

Safe commands executed:

```text
npm run lint
npm run build
npm run security:scan
npm run test:entitlements
npm run test:subscription
npm run test:tenant-isolation
npm run test:schema-compatibility
DATABASE_URL='postgresql://user:pass@localhost:5432/db' DIRECT_URL='postgresql://user:pass@localhost:5432/db' ./node_modules/.bin/prisma validate --schema apps/api/prisma/schema.prisma
npm run test:pos-routing
npm run test:pos-register
npm run test:pos-cart
npm run test:pos-quotes
npm run test:pos-orders
npm run test:pos-shifts
npm run test:pos-devices
npm run test:pos-kiosk
npm run test:pos-permissions
npm run test:pos-kitchen-sync
npm run test:pos-receipts
npm run test:receipt-qr
npm run test:pos-performance
npm run test:menu-modifiers
npm run test:modifier-admin
npm run test:modifier-quotes
npm run test:kiosk-modifiers
npm run test:plans
npm run test:development-entitlements
npm run test:plan-simulation
npm run test:billing-isolation
npm run test:zero-platform-fee
npm run test:connected-account-routing
npm run test:payment-reporting
npm run test:financial-separation
npm run test:restaurant-routing
npm run test:orders-page
npm run test:kitchen-page
npm run test:customers-page
npm run test:drivers-page
npm run test:reports-page
npm run test:restaurant-settings-routing
npm run test:login-ui
npm run test:public-layout
npm run test:registration
npm run test:order-payments
npm run test:homepage-ui
```

Skipped:

- `npm run smoke:test` was skipped because the script calls live API demo-login and forgot-password paths and can mutate audit/login/password-reset state or require running services. The audit rules prohibit unsafe persistent or external mutation.
- Live upload tests were skipped because they can mutate Supabase Storage and persistent restaurant image records.
- Live payment/refund/webhook tests were skipped because they require external Stripe state and could create financial artifacts.
- Database migrations and seeds were not run because the task explicitly prohibited modifying shared databases.

## 3. Architecture inventory

Project structure:

- Monorepo using npm workspaces: `apps/api` and `apps/web`.
- Backend: Express, Prisma, PostgreSQL/Supabase, Socket.IO, JWT, bcrypt, Zod, Helmet, CORS, rate limiting, Morgan.
- Frontend: React, Vite, lucide-react, QR generation, Socket.IO client.
- Database: PostgreSQL through Prisma with a shared-table multi-tenant model.
- Deployment: Render API service and Vercel web app configuration.

Runtime requirements:

- Node.js runtime.
- PostgreSQL/Supabase database.
- `DATABASE_URL` and `DIRECT_URL` for Prisma/runtime separation.
- JWT and refresh-token secrets.
- Optional but production-relevant: Stripe platform/connect secrets, Resend/SendGrid, Supabase Storage, Twilio, CORS origins.

Authentication:

- `apps/api/src/routes/auth.js` handles login, demo-login, refresh, password change, logout, and `/me`.
- `apps/api/src/utils/tokens.js` signs access and refresh JWTs.
- `apps/api/src/middleware/auth.js` verifies Bearer tokens, reloads the user from the database, checks `sessionVersion`, active status, role, and tenant access.
- `apps/api/src/utils/sanitize.js` strips sensitive fields before responses.

Authorization/RBAC:

- Server-side role enforcement through `requireRole`.
- Tenant access enforcement through `requireTenantAccess` and route-level restaurant resolution.
- Plan and feature enforcement through `apps/api/src/middleware/entitlements.js`.

Tenant isolation:

- Shared database tables with restaurant/tenant-scoped foreign keys such as `restaurantId`.
- No evidence of separate schemas or separate databases per tenant.
- Tenant isolation is primarily application-layer plus automated static/source tests.
- Database-level RLS was not proven from repository evidence.

API organization:

- `apps/api/src/server.js` mounts raw Stripe webhook routes, health routes, public/admin/restaurant/auth/POS routes, customer/driver/kitchen/orders/order-payments/payments/platform-billing/registration/uploads, and generic error handling.

Realtime:

- Socket.IO exists via `apps/api/src/services/realtimeService.js`.
- Current join events accept restaurant/order/driver/kitchen IDs and join rooms directly. Repository evidence did not show socket-level authentication or tenant authorization before joining rooms.

PWA/mobile:

- Driver PWA module exists under `apps/web/src/apps/driver`.
- PWA-ready structure exists, but native iOS/Android implementation and app-store publishing are not evidenced.

Testing:

- Many repository tests are source/static verification scripts.
- No central unit/integration framework such as Jest/Vitest was proven for API runtime tests.
- No `.github` workflow evidence was found.

Deployment:

- `render.yaml` defines API deployment and Prisma pre-deploy.
- `apps/web/vercel.json` defines Vercel rewrites, redirects, security headers, and SPA fallback.
- Material inconsistency: Vercel rewrites are hardcoded to `https://loohar-api.onrender.com`, while some environment examples and product goals prefer clean `/api` or first-party domains. This is operationally workable but not cleanly environment-abstracted.
- `render.yaml` has legacy Stripe env entries and may not fully mirror the newer platform/connect split found in payment services.

Monitoring/logging/error tracking:

- Morgan HTTP logging and health routes exist.
- No external error tracking, alerting, uptime monitoring, centralized logs, or incident workflow evidence was found.

## 4. Feature traceability matrix

| Domain | Capability | Status | UI evidence | API/service evidence | Database evidence | Test evidence | Missing link | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth | Super Admin login | `VERIFIED_IMPLEMENTED` | `apps/web/src/App.jsx` login pages | `apps/api/src/routes/auth.js`, `middleware/auth.js` | `User` role/status/session fields | `npm run test:login-ui`; lint/build pass | Runtime browser login not rerun in this audit | High |
| Auth | Restaurant owner/admin login | `VERIFIED_IMPLEMENTED` | `apps/web/src/App.jsx` restaurant login flow | `auth.js`, `requireRole`, tenant membership logic | `User`, `RestaurantStaff` | `test:login-ui`, restaurant owner tests referenced by scripts | Live credential verification skipped | High |
| Auth | Employee login | `PARTIAL` | Restaurant shell supports employee roles | `requireRole` includes cashier/kitchen/manager roles | `RestaurantStaff`, `User` | POS permission tests | PIN login and shift-specific auth not fully runtime-tested | Medium |
| Auth | Customer login/account | `IMPLEMENTED_UNVERIFIED` | Customer app/account routes | `apps/api/src/routes/customer.js` | `Customer`, `User`, order tables | Build/lint and source inspection | Full runtime customer account E2E not run | Medium |
| Auth | Driver login | `IMPLEMENTED_UNVERIFIED` | Driver PWA module | `apps/api/src/routes/driver.js` | `Driver`, `Delivery` | Source/static driver checks | Runtime PWA login not run | Medium |
| Auth | Password reset | `IMPLEMENTED_UNVERIFIED` | Forgot/reset screens | `auth.js`, notification service/templates | `PasswordResetToken`, user flags | Security scan passed | Real email delivery and reset-link click not verified | Medium |
| Auth | MFA | `PLANNED_ONLY` | Login copy mentions foundation | No complete MFA flow found | No proven MFA enrollment flow | None | Complete MFA implementation | Medium |
| Auth | Token revocation/session persistence | `PARTIAL` | Frontend session persistence | `sessionVersion`, refresh JWT handling | `User.sessionVersion` | Auth source tests | Stateful refresh-token revocation list not evidenced | Medium |
| Auth | Abuse controls/account lockout | `PARTIAL` | None material | rate limits on auth routes | No lockout table proven | Source inspection | Account lockout policy and alerts | Medium |
| Tenant | Tenant creation/onboarding | `IMPLEMENTED_UNVERIFIED` | Admin/new business and registration flows | `superAdmin.js`, `registrationService.js`, `platformBillingService.js` | `Restaurant`, website/domain/subscription/staff | Registration/source tests | Live DB creation skipped | Medium |
| Tenant | Tenant slug/public route | `VERIFIED_IMPLEMENTED` | Public routing in web app | `public.js` slug loading | `Restaurant.slug`, domain tables | `test:public-layout`, routing tests | DNS/custom domain runtime not verified | High |
| Tenant | Tenant suspension/deletion | `IMPLEMENTED_UNVERIFIED` | Admin actions | `superAdmin.js`, status handling | Restaurant status fields | Source inspection | Runtime status-access matrix not fully tested | Medium |
| Tenant | Cross-tenant API prevention | `VERIFIED_IMPLEMENTED` | N/A | `requireTenantAccess`, route resolvers | Tenant foreign keys | `test:tenant-isolation` passed 9/9 | DB RLS not proven | High |
| Tenant | Multi-location | `PARTIAL` | Locations section | Restaurant location routes | `RestaurantLocation` | Source inspection | Separate menus/staff/tax/reporting by location not complete | Medium |
| Menu | Categories/items CRUD | `VERIFIED_IMPLEMENTED` | Restaurant menu screens | `restaurant.js` menu routes | `MenuCategory`, `MenuItem` | menu/modifier tests passed | Runtime browser CRUD skipped | High |
| Menu | Modifiers/options | `VERIFIED_IMPLEMENTED` | POS/menu forms | `restaurant.js`, `posService.js` | `MenuItemOptionGroup`, `MenuItemOption` | `test:menu-modifiers`, `test:modifier-admin`, `test:modifier-quotes`, `test:kiosk-modifiers` | Runtime browser E2E skipped | High |
| Menu | Item images/uploads | `IMPLEMENTED_UNVERIFIED` | Website/menu image UI | `routes/uploads.js`, `uploadService.js` | `imageUrl`, gallery/settings models | security/build pass | Live Supabase upload skipped | Medium |
| Menu | Time-based menus/location pricing | `MISSING` | No complete evidence | No complete service path found | No complete schedule/pricing evidence | None | Full scheduling/pricing model | Medium |
| Menu | Allergens/dietary labels | `PARTIAL` | Demo badges/metadata | Basic JSON/fields implied in menu data | JSON fields | Source inspection | Structured allergen compliance workflow | Low |
| POS | POS routing/shell | `VERIFIED_IMPLEMENTED` | POS route in restaurant shell | `routes/pos.js` | POS models | `test:pos-routing` passed | Browser runtime skipped | High |
| POS | POS menu loading | `VERIFIED_IMPLEMENTED` | POS menu UI | `posService.posMenu` | `MenuCategory`, `MenuItem`, modifier tables | `test:pos-register`, `test:pos-performance` | Runtime API call skipped | High |
| POS | Cart/quote/order submit | `VERIFIED_IMPLEMENTED` | POS order panel | `createPosQuote`, `submitPosOrder` | `OrderQuote`, `Order`, `OrderItem`, `PosOrderSession` | `test:pos-cart`, `test:pos-quotes`, `test:pos-orders` | Runtime E2E skipped | High |
| POS | Cash payments | `VERIFIED_IMPLEMENTED` | POS payment UI | `createCashPayment` in `posService.js` | `Payment`, `RestaurantOrderPayment`, `CashLedgerEntry` | POS tests passed | Cash drawer hardware not verified | High |
| POS | Card-not-present handoff | `PARTIAL` | POS card action exists | Payment intent handoff, hosted payment marker | Payment records | `test:order-payments`, financial tests | Stripe production confirmation/reconciliation not externally verified | Medium |
| POS | Card-present terminal | `MISSING` | No certified terminal UI proven | No terminal SDK/certified reader flow found | No terminal transaction model proven | None | Processor-certified terminal integration | High |
| POS | Open checks/tabs | `PARTIAL` | Held orders exist | Held POS orders | `OrderQuote`, `PosOrderSession` | POS tests passed | Full tabs/open checks/split/merge not complete | Medium |
| POS | Split/merge/transfer checks | `MISSING` | No complete UI evidence | No complete service path found | No complete models proven | None | Complex check workflows | Medium |
| POS | Voids/comps/manager approvals | `PARTIAL` | Not fully visible | Refund/cancel pieces exist | Payment/order status fields | Source inspection | Full void/comp/reason/approval audit workflow | Medium |
| POS | Receipts and QR | `VERIFIED_IMPLEMENTED` | Receipt UI/QR flows | receipt services in POS/order workflow | `PosReceipt` | `test:receipt-qr`, `test:pos-receipts` | Printer hardware not verified | High |
| POS | Kiosk mode | `VERIFIED_IMPLEMENTED` | Kiosk UI | `enableKioskMode`, `exitKioskMode` | `PosDevice` kiosk fields | `test:pos-kiosk` | Physical locked-down tablet mode not verified | High |
| POS | Shifts/register devices | `VERIFIED_IMPLEMENTED` | POS admin controls | `posService` shifts/devices | `EmployeeShift`, `PosDevice`, `PosRegister` | `test:pos-shifts`, `test:pos-devices` | Hardware policy/runtime not verified | High |
| POS | Offline order capture/sync | `MISSING` | Offline warning only | No durable sync queue found | No queue model found | None | Local durable queue, replay, conflict resolution | High |
| Orders | Restaurant order lifecycle | `PARTIAL` | Orders/Kitchen/Driver UIs | `restaurant.js`, `kitchen.js`, `driver.js`, `orders.js` | `Order`, status history | route/page tests passed | Unified enforced state machine for all transitions not fully proven | Medium |
| Orders | Status history | `IMPLEMENTED_UNVERIFIED` | Visible status/history surfaces | status-history writes in services/routes | `OrderStatusHistory`, `DeliveryStatusHistory` | Source inspection | Full transition validity tests | Medium |
| Orders | Idempotency/duplicate prevention | `PARTIAL` | None material | Some quote/order flows | `OrderQuote`, Payment/order IDs | Source inspection | End-to-end duplicate submission tests | Low |
| Realtime | Kitchen/order/driver updates | `PARTIAL` | Socket.IO client usage in web app | `realtimeService.js`, emit calls | N/A | Source inspection | Authenticated socket joins and replay controls | Medium |
| Payments | SaaS subscriptions | `VERIFIED_IMPLEMENTED` | Registration/pricing UI | `platformBillingService.js`, `platformBilling.js`, webhooks | `PlatformSubscription`, `PendingRegistration` | `test:subscription`, `test:plans`, `test:financial-separation` | Real Stripe config/webhook delivery not verified | High |
| Payments | Restaurant customer payments | `IMPLEMENTED_UNVERIFIED` | Customer/order payment UI | `orderPayments` routes/services | `RestaurantOrderPayment`, `Payment`, merchant tables | `test:order-payments`, financial tests | Live Stripe payment intent/webhook not run | Medium |
| Payments | Stripe Connect onboarding | `IMPLEMENTED_UNVERIFIED` | Onboarding/payment settings | `orderPaymentService.js` | `RestaurantMerchantAccount` | financial tests | Real Connect account state not verified | Medium |
| Payments | Webhook signature verification | `PARTIAL` | N/A | New `webhooks.js` verifies platform/connect; legacy `payments.js` can skip if secret absent | Webhook event records | subscription/financial tests | Remove/lock down unsigned legacy webhook behavior | Medium |
| Payments | Refunds/partial refunds | `IMPLEMENTED_UNVERIFIED` | Refund route/UI evidence | `orderPayments.js`, `orderPaymentService.js` | Refund/payment records | source/static tests | Live refund reconciliation skipped | Medium |
| Payments | Disputes/payouts | `PARTIAL` | Reporting surfaces | Stripe event handlers/models | `Dispute`, `Payout` | Source inspection | Full operational workflow and reconciliation | Medium |
| Hardware | Browser printing | `IMPLEMENTED_UNVERIFIED` | Receipt/ticket UI | `orderWorkflowService.js`, `restaurant.js` | Printer settings | POS receipt tests | Runtime browser print behavior skipped | Medium |
| Hardware | Kitchen/front counter printers | `CONFIG_ONLY` | Settings labels | provider/targets include future printer names | `RestaurantPrinterSettings` | Source inspection | Real Epson/Star/thermal integration and test | High |
| Hardware | Cash drawer | `PARTIAL` | Cash drawer controls | Software ledger/session models | `CashDrawer`, `CashDrawerSession` | POS tests | Physical drawer kick/open sensor integration | Medium |
| Hardware | Barcode/customer display/card reader | `MISSING` | No complete evidence | No complete service path found | No complete models found | None | Device SDKs/hardware tests | Medium |
| Kitchen | KDS queue/actions | `PARTIAL` | Kitchen dashboard | `routes/kitchen.js` | Orders/status history | `test:kitchen-page`, `test:pos-kitchen-sync` | Station routing, timers, recall, bump/unbump, offline fallback | Medium |
| Delivery | Driver assignments/status | `IMPLEMENTED_UNVERIFIED` | Driver app and dispatch UI | `routes/driver.js`, restaurant dispatch routes | `Driver`, `Delivery` | driver/page tests | Runtime field workflow not verified | Medium |
| Delivery | Driver earnings/tips | `IMPLEMENTED_UNVERIFIED` | Driver earnings UI | `driver.js` earnings aggregation | delivery/order tip fields | driver tests | Payout integration not verified | Medium |
| Delivery | GPS/maps/ETA/proof/contact masking | `MISSING` | Navigation placeholder | No production maps/GPS/proof path found | No full GPS/proof model found | None | Maps/provider integration and privacy controls | Medium |
| Customer | Public website/menu | `VERIFIED_IMPLEMENTED` | Public site components | `public.js`, `customer.js` | website/menu/gallery tables | `test:public-layout`, build | Production domain runtime not part of audit | High |
| Customer | Guest checkout/order placement | `PARTIAL` | Customer ordering UI | `customer.js`, `orderPayments.js` | Customer/order/payment tables | `test:order-payments` | Live payment/order E2E skipped | Medium |
| Customer | Order tracking | `PARTIAL` | Tracking UI | `customer.js`, `orders.js` | order status/history | Source inspection | Tokenless fallback privacy risk; tracking token enforcement incomplete | Medium |
| Customer | Reorder/favorites/loyalty | `IMPLEMENTED_UNVERIFIED` | Customer account screens | `customer.js` | Customer/favorites/loyalty models | Source inspection | Runtime tests not run | Medium |
| Customer | Reviews/reservations/customer native app | `MISSING` | No complete evidence | No complete service path found | No complete models proven | None | Full product implementation | Medium |
| Settings | Restaurant profile/branding/website | `IMPLEMENTED_UNVERIFIED` | Restaurant settings/website builder | `restaurant.js`, `uploads.js` | website/settings/gallery/social | route/page tests | Live upload and publish not run | Medium |
| Settings | Taxes/payments/receipts/kitchen/printers | `PARTIAL` | Settings sections | Multiple restaurant routes | Settings and payment models | source/static tests | Full jurisdiction tax/printer/provider validation | Medium |
| Settings | Integrations/API/developers/backup | `PLANNED_ONLY` | Settings registry labels | Coming-soon status | No complete backend found | Source inspection | Complete integration/developer/backup flows | Medium |
| Employees | Employee creation/disable/roles | `IMPLEMENTED_UNVERIFIED` | Employees/customer settings UI | `restaurant.js` employee/staff routes | `RestaurantStaff`, `User` | Source inspection | Fine-grained permissions and runtime test | Medium |
| Labor | Clock in/out/shifts | `PARTIAL` | POS shift UI | `posService.js` shift methods | `EmployeeShift` | `test:pos-shifts` | Breaks, scheduling, overtime, payroll export | Medium |
| Inventory | Inventory foundation | `PARTIAL` | Inventory settings module | `restaurant.js` inventory routes | `InventoryItem` | Source inspection | Recipe mapping, depletion, PO/vendors/waste/transfers | Medium |
| Reports | Restaurant reports/analytics | `PARTIAL` | Reports/analytics pages | `restaurant.js`, metrics service changes present in worktree | Order/customer/driver/payment tables | reports page tests | Runtime accuracy, exports, timezone/date-range validation | Medium |
| Admin | Tenant CRUD | `IMPLEMENTED_UNVERIFIED` | Super Admin portal | `superAdmin.js` | Restaurant/User/Website/Domain/Audit | source/static evidence | Live create/edit not run | Medium |
| Admin | Impersonation | `PARTIAL` | Admin action | `superAdmin.js` returns impersonation tokens | AuditLog | Source inspection | Reason/expiry/notification/immutable review incomplete | Medium |
| Admin | System analytics/alerts/support tickets | `PARTIAL` | Stats/cards | Admin routes for stats/audit | Audit/subscription/order data | Source inspection | Operational alerts and ticketing absent | Low |
| Storage | Supabase uploads | `IMPLEMENTED_UNVERIFIED` | Upload UI | `uploadService.js`, `uploads.js` | website/menu/gallery fields | security/build pass | Bucket/policy/live upload skipped | Medium |
| Notifications | Email | `IMPLEMENTED_UNVERIFIED` | Password reset/welcome flows | `notificationService.js`, templates | Reset tokens/user state | Source inspection | Real deliverability skipped | Medium |
| Notifications | SMS | `CONFIG_ONLY` | Notification settings | `notificationService.js` placeholder behavior | notification settings | Source inspection | Twilio API send path and delivery verification | High |
| Security | Sanitized auth responses | `VERIFIED_IMPLEMENTED` | N/A | `sanitizeUser`, auth route use | N/A | `npm run security:scan` passed | Runtime API response fuzzing not run | High |
| Security | File upload validation | `IMPLEMENTED_UNVERIFIED` | Upload UI | `uploadService.js` validates MIME/magic/size/path | records updated after upload | Source inspection | Live storage mutation skipped | Medium |
| Security | CORS/security headers/rate limits | `PARTIAL` | N/A | `server.js`, Vercel headers | N/A | Source inspection | Production firewall/CORS behavior not externally verified | Medium |
| Security | CSRF/cookie hardening | `PARTIAL` | N/A | Bearer-token architecture; TODO notes mention cookie future | N/A | Source inspection | HttpOnly cookie/token-storage hardening not complete | Medium |
| Security | DB RLS/data retention/privacy program | `MISSING` | N/A | No complete evidence | Prisma models only | None | RLS policies/privacy deletion/retention program | Medium |
| Ops | Health check | `VERIFIED_IMPLEMENTED` | N/A | `/health`, `/api/health` | N/A | build/source evidence | Production uptime not audited | High |
| Ops | Monitoring/alerting/error tracking | `MISSING` | N/A | No external integration found | N/A | None | Tooling and process | Medium |
| Ops | CI/CD workflows | `MISSING` | N/A | No `.github` workflow evidence | N/A | Source inspection | Automated pipeline | Medium |
| Ops | Backups/restore/DR | `MISSING` | N/A | No complete evidence | Database external | None | Verified backup/restore runbooks | Medium |
| Quality | Responsive public UI | `PARTIAL` | Public homepage | Web source/CSS | N/A | `test:public-layout` passed; `test:homepage-ui` failed one check | Fix responsive desktop-nav breakpoint test | High |
| Quality | Performance/bundle | `PARTIAL` | N/A | Vite build | N/A | Build passed with chunk warning | Bundle splitting/performance budgets | Medium |

## 5. Role and permission matrix

| Role | Evidence-backed capabilities | Server-side enforcement | Risks/notes |
| --- | --- | --- | --- |
| Super Admin | Tenant/admin operations, impersonation, plan/status/domain/website management | `requireAuth`, `requireRole("SUPER_ADMIN")` in `superAdmin.js` | Impersonation needs stronger reason/expiry/notification controls before production support use. |
| Restaurant Owner | Restaurant dashboard, setup, POS, orders, menu, kitchen, customers, drivers, reports, settings, billing/portal actions | `restaurant.js`, `pos.js`, `platformBilling.js`, `requireTenantAccess`, feature guards | Scope is broad; entitlement and tenant checks are present but runtime regression suite should be expanded. |
| Restaurant Admin/Manager | Operational restaurant access similar to owner, plan-limited | Role guards and feature guards | Fine-grained permissions by action are partial. |
| Employee/Cashier/Server | POS-facing role support, cash/card/cashier permission concepts | POS permissions in `posService.js`; role checks | PIN login, server assignment, break/scheduling/payroll depth incomplete. |
| Kitchen Staff | Kitchen display/order status workflow | `kitchen.js` role guard and KDS feature guard | Kitchen station routing and socket-room authorization need work. |
| Driver | Driver deliveries, availability/status/history/earnings | `driver.js` uses `requireRole("DRIVER")` and current-driver ownership | GPS/proof/contact masking/push notifications missing or partial. |
| Customer | Public ordering, account, favorites, reorder, loyalty | `customer.js` role guard for customer account; public order endpoints use entitlement checks | Tokenless order status fallback should be tightened. |
| Guest | Public website/menu/order quote/order placement | Public routes assert restaurant features and active tenant | Guest checkout payment must be runtime-verified before live launch. |

## 6. Tenant-isolation report

Current tenancy model:

- Shared PostgreSQL database.
- Shared Prisma schema.
- Restaurant-owned records use `restaurantId` or equivalent tenant foreign keys.
- User access is scoped by `restaurantId`, role, and membership.
- No evidence of separate schemas or separate tenant databases.

Protections found:

- `requireTenantAccess` blocks non-super-admin restaurant route access when the request restaurant does not match the authenticated user.
- POS restaurant context rejects cross-tenant owner access and disallows Super Admin POS operation.
- Driver routes resolve the authenticated user's `Driver` record and query/update only deliveries assigned to that driver.
- Customer public routes check active restaurant and feature availability.
- Entitlement tests and tenant-isolation tests passed.

Coverage:

- `npm run test:tenant-isolation` passed 9/9.
- Static source tests assert route/middleware shape.

Identified risks:

- Socket.IO joins are not tenant-authorized based on the inspected `realtimeService.js`.
- Public order status and receipt-style access need strict tracking-token enforcement to avoid future IDOR/BOLA issues.
- Database-level RLS was not proven. Supabase warnings about RLS would need to be addressed separately if public client/database access is used.
- Broad update payloads, such as profile updates, should be narrowed/validated to reduce mass-assignment risk.

## 7. Payment-readiness report

### Loohar SaaS subscription payments

Status: `VERIFIED_IMPLEMENTED` by source/static tests, `IMPLEMENTED_UNVERIFIED` for live provider operation.

Evidence:

- `apps/api/src/modules/platformBilling/platformBillingService.js`
- `apps/api/src/routes/platformBilling.js`
- `apps/api/src/routes/registration.js`
- `apps/api/src/routes/webhooks.js`
- `PlatformSubscription`, `PendingRegistration`, `TenantSubscription`
- Tests: `test:subscription`, `test:plans`, `test:financial-separation`, `test:billing-isolation`

Important positive finding:

- Registration activation is designed to wait for verified Stripe webhook processing rather than trusting frontend checkout state.

Missing external proof:

- Real Stripe products/prices.
- Real webhook endpoint delivery.
- Live test-mode checkout/reconciliation run.
- Operational response to failed invoices, past-due, unpaid, canceled, and suspended tenants.

### Restaurant customer order payments

Status: `IMPLEMENTED_UNVERIFIED` for card-not-present; `MISSING` for card-present.

Evidence:

- `apps/api/src/modules/orderPayments/orderPaymentService.js`
- `apps/api/src/modules/orderPayments/quoteService.js`
- `apps/api/src/routes/orderPayments.js`
- `RestaurantMerchantAccount`, `RestaurantOrderPayment`, `Payment`, `Refund`, `Dispute`, `Payout`, `TaxSnapshot`

Supported in code:

- Stripe Connect merchant onboarding concepts.
- PaymentIntent-style server creation.
- Tips/taxes/order totals.
- Refund service path.
- Webhook handlers.
- Payment reporting separation.

Not proven:

- Live card-not-present checkout.
- Production webhook idempotency/retry behavior.
- Real reconciliation against Stripe dashboards.
- Full duplicate-charge prevention under retries.
- Full tax compliance by jurisdiction.

### Restaurant payouts

Status: `PARTIAL`.

Evidence:

- Stripe Connect models and event handlers exist.
- Payout models exist.

Missing:

- Operational payout reconciliation workflow.
- Restaurant-facing payout ledger validation.
- Dispute/chargeback workflow completeness.

### Refunds/disputes

Status: `PARTIAL`.

Refund routes and models exist, but live refund/dispute reconciliation was not run. Partial refunds need production-like validation.

### Cash payments

Status: `VERIFIED_IMPLEMENTED` by source/static POS tests.

Evidence:

- `posService.js` creates cash payment records and ledger entries.
- POS tests passed.

Missing:

- Physical cash drawer integration and store closeout process verification.

### Card-present support

Status: `MISSING`.

No evidence of processor-certified terminal/card-reader integration, device certification, or card-present payment lifecycle.

## 8. Order-state and financial-integrity report

Order state evidence:

- Prisma order statuses and status-history models exist.
- Restaurant, kitchen, driver, POS, customer, and payment routes update statuses.
- `OrderStatusHistory` and `DeliveryStatusHistory` are used to retain status changes.
- POS quote/order submission creates persisted records.

Financial state evidence:

- `Payment`, `RestaurantOrderPayment`, `Refund`, `Dispute`, `Payout`, `TaxSnapshot`, `DriverEarningLedger`, and `DeliveryFeeRule` exist.
- Order quote services compute totals, tips, coupons, taxes, and zero platform fee disclosure.
- Stripe platform and Connect separation is represented in source.

Current limitations:

- A single explicit order-state machine covering every transition and invalid transition was not proven.
- Duplicate/out-of-order event handling was not fully proven.
- Idempotency was not proven across all payment/order endpoints.
- Monetary precision appears cent-based in many places, but a full rounding/tax reconciliation test suite was not proven.
- Legacy payment webhook behavior should require signatures in production without fallback.

## 9. Hardware and offline-readiness report

Code-reviewed:

- Browser-print receipt/ticket generation.
- POS device registration/configuration.
- Cash drawer software sessions/ledger.
- Kiosk mode with PIN hashing.

Locally/source-tested:

- POS routing, register, cart, quotes, orders, shifts, devices, kiosk, permissions, kitchen sync, receipts, receipt QR, modifiers, and performance static checks.

Physically tested:

- No repository evidence of physical printer, cash drawer, card reader, tablet, scanner, or customer-display testing.

Production-proven:

- No repository evidence of production POS hardware use.

Offline readiness:

- PWA/offline pages exist in some areas, especially driver/public flows.
- Restaurant-grade offline POS order capture is not implemented.
- No durable local order queue, sync replay, conflict resolver, duplicate prevention after reconnect, or recovery after browser/device restart was proven.

Conclusion:

Loohar has POS software foundations, but not restaurant-grade hardware/offline POS readiness.

## 10. Security and compliance observations

Verified technical controls:

- Bcrypt password hashing.
- JWT access and refresh tokens.
- Session invalidation through `sessionVersion`.
- Sensitive user response sanitization.
- Role-based route guards.
- Tenant route guards.
- Entitlement/plan guards.
- Rate limiting on sensitive endpoints.
- Helmet/CORS setup.
- Server-side upload validation and Supabase service-role isolation.
- Security scan for frontend credential leakage passed.

Important security gaps:

- Socket.IO room joins need authentication and tenant ownership checks.
- Tokenless order tracking/receipt paths need strict tracking-token requirements.
- Browser/local-storage token storage remains less secure than HttpOnly Secure SameSite cookies.
- Database RLS was not evidenced.
- Full CSRF posture depends on Bearer-token architecture; if cookies are introduced later, CSRF controls must be added.
- Formal compliance cannot be claimed.

Compliance:

- No evidence of PCI DSS certification, SOC 2 audit, GDPR/CCPA program completion, privacy operations, incident response program, or vulnerability disclosure process.
- Code controls reduce risk but do not constitute formal compliance.

## 11. Test and build results

Passed:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run build` | Passed with Vite chunk-size warning |
| `npm run security:scan` | Passed |
| `npm run test:entitlements` | Passed |
| `npm run test:subscription` | Passed |
| `npm run test:tenant-isolation` | Passed 9/9 |
| `npm run test:schema-compatibility` | Passed |
| Prisma validate with dummy safe URLs | Passed |
| POS routing/register/cart/quotes/orders/shifts/devices/kiosk/permissions/kitchen-sync/receipts tests | Passed |
| Receipt QR, POS performance, modifier admin/quotes/kiosk tests | Passed |
| Plans/development entitlements/plan simulation/billing isolation/zero platform fee/connected-account routing/payment reporting/financial separation tests | Passed |
| Restaurant routing/orders/kitchen/customers/drivers/reports/settings/login/public-layout/registration/order-payments tests | Passed |

Failed:

| Command | Result |
| --- | --- |
| `npm run test:homepage-ui` | Failed 1 issue: responsive breakpoint hides desktop nav/actions only on smaller screens |

Blocked/skipped:

| Command | Reason |
| --- | --- |
| `npm run smoke:test` | Skipped because it can call live API demo-login and forgot-password paths, which may mutate persistent/external state |
| Live uploads | Skipped because they can mutate Supabase Storage and database image records |
| Live payment/refund/webhook tests | Skipped because they require external Stripe state and can create financial artifacts |
| Migrate/seed | Skipped because audit rules prohibit shared database mutation |

Warnings:

- Vite build completed but main JavaScript chunk exceeded 500 kB.
- Initial Prisma validation without environment variables failed because `DIRECT_URL` was not set in the shell; validation passed after dummy safe URLs were supplied.

## 12. Honest comparison scorecard

| Area | Mature POS expectation | Loohar maturity | Rationale |
| --- | --- | --- | --- |
| Taking orders | Reliable workflows validated in real service | Level 4 - Integrated and automatically tested | POS/order source tests pass, but no real pilot/load proof. |
| Card payments | Certified, secure, reconciled, recoverable | Level 3 - Functional locally for card-not-present; Level 0 for card-present | Stripe architecture exists; no terminal certification or live validation. |
| Hardware | Tested terminals, readers, printers, drawers, handhelds | Level 1 - Concept/Documentation | Browser print and future targets exist; physical devices not proven. |
| Offline operation | Orders continue and sync safely | Level 0 - Absent | No durable offline POS queue/sync. |
| Kitchen operations | Reliable KDS, tickets, routing, timing, fallback | Level 3 - Functional locally | KDS routes exist; station routing/offline fallback incomplete. |
| Complex checks | Split, merge, transfer, reopen, void, comp, refund, tabs | Level 2 - UI/Prototype/partial | Held orders/refunds exist; full check management missing. |
| Reporting | Accurate sales, labor, tax, inventory, operations reports | Level 3 - Functional locally | Reporting routes exist; accuracy/export/load not proven. |
| Integrations | Accounting, payroll, delivery, loyalty connections | Level 1 - Concept/Configuration | Email/Stripe/Supabase partially implemented; many integrations absent/config-only. |
| Security/compliance | Verified controls plus operational compliance | Level 3 - Functional locally | Technical guards exist; socket/RLS/operations/compliance gaps remain. |
| Support | Training, installation, incident response, escalation | Level 0 - Absent | No runbooks/support process evidence. |
| Reliability | Demonstrated under peak production load | Level 0 - Absent | No load/stress/HA evidence. |

## 13. Launch-readiness verdicts

| Launch context | Verdict | Evidence | Blocking requirements |
| --- | --- | --- | --- |
| Development/demo use | `READY` | Build/lint/security/source tests mostly pass | Fix homepage UI test for clean suite |
| Internal testing | `CONDITIONALLY_READY` | Broad modules exist and safe tests pass | Use disposable test data/services; avoid live payments until configured |
| Controlled pilot restaurant | `CONDITIONALLY_READY` | Ordering/POS foundations exist | Resolve P0 security/payment/offline/ops gaps or explicitly constrain pilot |
| Taking online orders | `CONDITIONALLY_READY` | Public ordering/payment code exists | Validate live order/payment/webhook flow end-to-end |
| Taking cash POS orders | `CONDITIONALLY_READY` | Cash payment ledger code/tests | Pilot with manual closeout and no hardware dependence |
| Taking live card-present payments | `NOT_READY` | No terminal certification | Processor terminal integration and certification |
| Taking live card-not-present payments | `CONDITIONALLY_READY` | Stripe Connect architecture | Real Stripe configuration, webhook, idempotency, refunds, reconciliation |
| Kitchen production use | `CONDITIONALLY_READY` | KDS routes/UI exist | Station routing, realtime security, operational pilot validation |
| Delivery dispatch use | `CONDITIONALLY_READY` | Driver routes scoped by user and assigned deliveries | GPS/maps/proof/contact masking/push if needed |
| Full Toast/Square/Clover/SpotOn replacement | `NOT_READY` | Hardware/offline/card-present/ops gaps | Multiple P0/P1 tracks |
| General public launch | `NOT_READY` | Product broad but not production-proven | Security, payments, ops, support, CI, monitoring |
| Multi-restaurant scale | `NOT_READY` | Tenant model exists | Load tests, monitoring, backup/restore, support workflows |

## 14. Prioritized gap register

Estimates are rough engineering estimates based on repository evidence, not delivery promises.

| Gap ID | Area | Missing or incomplete capability | Current status | Evidence | Business impact | Security/payment/data risk | Restaurant operational impact | Dependency | Recommended next action | Priority | Effort | Validation required | Release gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0-01 | Realtime security | Socket.IO joins are not authenticated/tenant-checked | `PARTIAL` | `realtimeService.js` direct `join:*` handlers | Cross-tenant event exposure risk | High data exposure risk | Wrong kitchen/driver/customer updates possible | Auth middleware/socket auth | Add authenticated socket handshake and room ownership checks | P0 | M | Runtime cross-tenant socket tests | Before pilot |
| P0-02 | Order privacy | Tokenless order status/receipt access | `PARTIAL` | `customer.js`, `orderPayments.js` status/receipt paths | Customer privacy exposure | IDOR/BOLA risk | Customers may see wrong order details if IDs guessed | Tracking token model | Require tracking token or authenticated ownership | P0 | S | API tests for tokenless denial | Before pilot |
| P0-03 | Payments | Live payment certification absent | `BLOCKED` | Stripe code exists; no external verification | Incorrect charges/lost orders | High financial risk | Restaurant trust failure | Stripe test/prod accounts | Run sandbox/live-mode certification checklist in isolated env | P0 | L | Payment E2E, webhook, refund, reconciliation | Before live payments |
| P0-04 | Card-present POS | No certified terminal/card-reader path | `MISSING` | No terminal SDK/certification evidence | Cannot replace POS card terminals | PCI/payment risk | In-store card payments unavailable | Processor/hardware partner | Integrate certified terminal flow or explicitly exclude | P0 | XL | Processor certification and device tests | Before card-present |
| P0-05 | Offline POS | No durable offline order/payment sync | `MISSING` | No queue/replay/conflict evidence | Lost orders during outage | Duplicate/lost financial records | Service interruption during internet loss | Local storage/sync design | Implement offline queue, idempotency, conflict resolution | P0 | XL | Browser restart/reconnect tests | Before POS pilot where offline is required |
| P0-06 | Smoke/runtime verification | Full safe smoke not run | `BLOCKED` | `smoke-test.mjs` mutates demo/forgot-password state | Unknown runtime regressions | Unknown | Unknown | Disposable test env | Create non-mutating or disposable-env smoke suite | P0 | M | End-to-end smoke pass | Before pilot |
| P0-07 | Database protections | RLS/DB tenant policy not evidenced | `MISSING` | Prisma shared tables only | App bug could expose tenant data | High tenant breach risk | Cross-restaurant data risk | Supabase policy design | Add/audit RLS or document backend-only DB isolation guarantees | P0 | L | DB policy tests | Before public launch |
| P0-08 | Webhook hardening | Legacy payment webhook can skip signature if secret absent | `PARTIAL` | `routes/payments.js` | Forged payment events possible if misconfigured | High payment integrity risk | False paid/refunded states | Env validation | Require signature in production and disable legacy route if unused | P0 | S | Negative webhook signature tests | Before live payments |
| P0-09 | Production operations | No monitoring/backup/incident/load proof | `MISSING` | No evidence of monitoring/runbooks/load tests | Outages undetected/unrecoverable | Data loss/compliance risk | Restaurant shutdown risk | Ops tooling | Add monitoring, alerts, backup restore drills, runbooks, load tests | P0 | L | DR/load/alert evidence | Before public launch |
| P1-01 | Hardware printing | No real thermal printer integration | `CONFIG_ONLY` | `browser_print`, future Epson/Star targets | Operational friction | Duplicate/missed tickets | Kitchen/front counter reliability gap | Printer SDK/bridge | Choose supported printer path and test devices | P1 | XL | Physical printer tests | Before in-store pilot |
| P1-02 | Cash drawer hardware | Software drawer only | `PARTIAL` | Cash drawer models/sessions | Manual cash controls | Cash variance risk | Slower checkout/closeout | Hardware bridge | Add drawer kick/sensor integration or manual SOP | P1 | L | Device tests | Before cash-heavy pilot |
| P1-03 | SMS | SMS provider not complete | `CONFIG_ONLY` | notification service placeholder | Customers/drivers miss updates | Low security, medium ops | Delivery communication gap | Twilio/alternative | Implement and test SMS send/delivery status | P1 | M | Sandbox/live delivery tests | Before delivery pilot if SMS promised |
| P1-04 | KDS depth | Station routing/timers/recall incomplete | `PARTIAL` | KDS route/basic status actions | Kitchen efficiency lower | Low | Missed/routed tickets | Menu station model | Add station/item routing and timers | P1 | L | KDS workflow tests | Before busy kitchen pilot |
| P1-05 | Complex checks | Split/merge/transfer/reopen/tabs missing | `MISSING` | No complete service path | Not competitive for table service | Financial reconciliation risk | Staff cannot handle common cases | POS state model | Implement complex check workflows | P1 | XL | POS scenario tests | Before table-service pilot |
| P1-06 | Manager approvals | Void/comp/refund approval incomplete | `PARTIAL` | Refund/cancel pieces exist | Fraud/variance risk | Financial integrity risk | Manager control gap | Permission model | Add approval workflow/reasons/audit | P1 | L | Role/approval tests | Before POS pilot |
| P1-07 | Delivery operations | GPS/maps/ETA/proof/contact masking missing | `MISSING` | Navigation placeholder | Driver/customer experience weak | Privacy/contact risk | Dispatch friction | Maps/SMS/provider | Add minimum viable GPS/proof/contact policy | P1 | XL | Field delivery tests | Before delivery pilot |
| P1-08 | Labor management | Breaks/scheduling/overtime/payroll absent | `MISSING` | Shift basics only | Labor reporting incomplete | Payroll/compliance risk | Owner cannot manage labor fully | Payroll/scheduling design | Decide scope or integrate payroll later | P1 | XL | Labor scenario tests | Before competing with Toast labor |
| P1-09 | State machine | Transitions not centrally enforced | `PARTIAL` | Multiple route-specific updates | Inconsistent order states | Financial/order accuracy risk | Confusing kitchen/driver/customer states | State-machine service | Centralize allowed transitions and tests | P1 | L | Invalid-transition tests | Before pilot |
| P1-10 | Deployment config | Environment/domain inconsistencies | `PARTIAL` | `render.yaml`, `vercel.json` | Broken production URLs | Auth/API routing failures | Login/payment outage risk | Env management | Align API/domain/env variables | P1 | S | Production smoke | Before deploy |
| P1-11 | CI/CD | No workflows evidenced | `MISSING` | No `.github` evidence | Regressions ship easily | Medium | Quality risk | GitHub Actions/Vercel/Render | Add protected CI checks | P1 | M | Required checks pass | Before team scale |
| P1-12 | Homepage UI | One UI test failure | `PARTIAL` | `test:homepage-ui` failed | Public polish risk | Low | Marketing trust issue | CSS/UI | Fix breakpoint test issue | P1 | XS | Homepage UI test pass | Before launch |
| P1-13 | Profile validation | Broad profile update payload | `PARTIAL` | `restaurant.js` profile update | Bad data/mass assignment risk | Medium | Tenant settings corruption | Zod schemas | Narrow update schemas | P1 | S | Negative validation tests | Before pilot |
| P1-14 | Upload runtime | Storage upload not live-tested | `BLOCKED` | Upload service exists | Broken images/media risk | Medium if bucket policy wrong | Branding/menu gaps | Supabase bucket | Test upload in disposable tenant | P1 | S | Upload persistence tests | Before public sites pilot |
| P1-15 | Tax compliance | Basic tax snapshot only | `PARTIAL` | `TaxSnapshot`, quote service | Incorrect tax collection | Legal/financial risk | Restaurant accounting issues | Tax provider/policy | Define tax calculation scope and tests | P1 | L | Jurisdiction/tax tests | Before live payments |
| P1-16 | Support ops | No support/ticket/runbook evidence | `MISSING` | No docs/tooling found | Customer churn | Incident mishandling | Restaurant blocked during service | Support process | Create onboarding/support/runbooks | P1 | M | Tabletop incident drill | Before pilot |
| P2-01 | Reporting exports | CSV/PDF export not evidenced | `MISSING` | Reports routes/pages | Lower usefulness | Low | Manual reporting | Export service | Add exports/date ranges | P2 | M | Export tests |
| P2-02 | Inventory automation | No recipe depletion/PO/vendors | `PARTIAL` | `InventoryItem` foundation | Inventory not competitive | Medium accounting risk | Manual stock updates | Recipe/vendor model | Add recipes/depletion/receiving | P2 | XL | Inventory scenario tests |
| P2-03 | Loyalty analytics | Loyalty exists but analytics shallow | `PARTIAL` | loyalty routes/settings | Lower marketing value | Low | Owner insight gap | Analytics service | Expand analytics | P2 | M | Analytics tests |
| P2-04 | Coupon performance | Promotion analytics partial | `PARTIAL` | coupon routes | Lower marketing insight | Low | Owner cannot assess campaigns | Reporting | Add redemption/performance analytics | P2 | M | Report tests |
| P2-05 | Driver payouts | Earnings shown, payouts not complete | `PARTIAL` | driver earnings ledger | Manual payout work | Financial risk | Driver trust gap | Payout provider | Add payout workflow or manual SOP | P2 | L | Payout reconciliation tests |
| P2-06 | Push notifications | Not implemented | `MISSING` | PWA only | Missed driver/customer events | Low | Operational lag | Web push/native | Add web push or defer | P2 | L | Push tests |
| P2-07 | Accessibility | Not fully audited | `BLOCKED` | UI exists | Legal/usability risk | Low-medium | Staff/customer friction | a11y tooling | Add axe/keyboard checks | P2 | M | A11y test pass |
| P2-08 | Performance | Large JS chunk | `PARTIAL` | build warning | Slow load | Low | Staff/customer UX | Code splitting | Split bundles, image optimization | P2 | M | Performance budget pass |
| P2-09 | Logs/secrets | No centralized redaction monitoring | `PARTIAL` | sanitizer and scans exist | Debugging/security risk | Medium | Incident response gap | Logging provider | Add structured logs/redaction tests | P2 | M | Log audit tests |
| P2-10 | Backup/restore UX | No tenant export/restore | `MISSING` | No evidence | Data portability weak | Compliance risk | Owner data concern | Export/backup design | Add export/restore plan | P2 | L | Restore drill |
| P2-11 | Multi-location depth | Foundation only | `PARTIAL` | `RestaurantLocation` | Enterprise feature incomplete | Medium | Chain restaurants limited | Location-aware services | Add location-scoped menus/staff/reports | P2 | XL | Location isolation tests |
| P2-12 | Accounting/payroll integrations | Missing | `MISSING` | No complete integration | Competitive gap | Medium | Owner manual work | Partner APIs | Prioritize integrations | P2 | XL | Sandbox tests |
| P2-13 | Customer reviews/reservations | Missing | `MISSING` | No complete routes | Competitive gap | Low | Growth tools gap | Product design | Decide roadmap | P2 | L | Feature tests |
| P2-14 | Developer API | Planned only | `PLANNED_ONLY` | settings registry | Integration gap | Security if rushed | Partner limitations | API key design | Build API keys/webhooks/docs | P2 | XL | Security/API tests |
| P3-01 | UI polish | Desktop/mobile polish ongoing | `PARTIAL` | homepage/UI tests | Brand polish | Low | Perception | Design QA | Continue responsive QA | P3 | S | Visual checks |
| P3-02 | Advanced menu insights | Partial | `PARTIAL` | menu insights feature | Owner insight gap | Low | Optimization slower | Analytics | Expand margins/profitability | P3 | M | Analytics tests |
| P3-03 | White label | Entitlement exists; depth unclear | `PARTIAL` | Enterprise features | Sales differentiator | Low | Enterprise limitation | Branding/domain work | Define white-label scope | P3 | L | Tenant brand tests |
| P3-04 | Native mobile apps | Not implemented | `PLANNED_ONLY` | PWA/future notes | Competitive gap | Low | Driver/customer install friction | Expo/native roadmap | Build after PWA stabilization | P3 | XL | App-store review |
| P3-05 | Training materials | Missing | `MISSING` | No evidence | Onboarding friction | Low | Staff ramp slow | Docs/videos | Add role manuals | P3 | M | Pilot feedback |
| P3-06 | Status page | Missing | `MISSING` | No evidence | Trust gap | Low | Incident comms | Status provider | Add public status page | P3 | S | Incident drill |
| P3-07 | Feature flags | Partial/admin unclear | `PARTIAL` | entitlement flags | Controlled rollout gap | Low | Support complexity | Flag system | Add rollout controls | P3 | M | Flag tests |
| P3-08 | Localization | Missing | `MISSING` | No i18n evidence | Market limitation | Low | Non-English users limited | i18n library | Add later | P3 | L | Locale tests |

## 15. Recommended phased roadmap

Do not implement this roadmap as part of this audit.

### Phase 0: Financial, security, and data-integrity blockers

- Authenticate and tenant-check Socket.IO rooms.
- Require tracking tokens or authenticated ownership for order status/receipt retrieval.
- Harden all webhook signature requirements in production.
- Create disposable runtime smoke environment.
- Validate Stripe platform and Connect flows end-to-end.
- Add idempotency and duplicate-charge tests.
- Define RLS/backend-only DB posture and test cross-tenant data access.
- Add monitoring, alerting, backup restore drill, and incident runbooks.

### Phase 1: Controlled pilot readiness

- Fix homepage UI test.
- Align Vercel/Render/API domain configuration.
- Validate live Supabase uploads with disposable tenants.
- Add central order-state machine tests.
- Create support/onboarding runbooks.
- Add browser/hardware printing pilot plan.
- Add minimum delivery ops plan if delivery is included.

### Phase 2: Restaurant operational completeness

- Implement complex checks, manager approvals, voids, comps, split/merge/transfer/reopen workflows.
- Expand KDS station routing, prep timing, recall, and expeditor flows.
- Add inventory recipe/depletion, vendors, receiving, low-stock alerts.
- Expand reports, exports, and reconciliation dashboards.
- Improve employee scheduling, breaks, overtime, payroll export.

### Phase 3: Commercial launch readiness

- Add CI/CD workflows and protected release gates.
- Add load/stress tests and performance budgets.
- Add centralized logs/error tracking/security monitoring.
- Complete privacy controls, retention/deletion, compliance documentation.
- Validate multi-restaurant scale and tenant support workflows.

### Phase 4: Competitive expansion

- Certified hardware/payment terminal integrations.
- Native driver/customer apps if strategically needed.
- Accounting/payroll/gift-card/reservation integrations.
- Advanced analytics, white label, enterprise multi-location features.

## 16. Evidence appendix

Material files and symbols inspected:

- `/Users/rudrabishwokarma/Documents/SaaS_Platform/package.json`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/package.json`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/web/package.json`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/server.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/auth.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/middleware/auth.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/middleware/entitlements.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/config/entitlements.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/utils/sanitize.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/utils/tokens.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/restaurant.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/pos.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/services/posService.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/customer.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/driver.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/kitchen.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/public.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/uploads.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/services/uploadService.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/services/notificationService.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/services/realtimeService.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/orderPayments.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/modules/orderPayments/orderPaymentService.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/modules/orderPayments/quoteService.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/modules/platformBilling/platformBillingService.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/platformBilling.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/registration.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/webhooks.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/src/routes/payments.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/prisma/schema.prisma`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/prisma/seed.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/api/prisma/migrations`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/web/src/App.jsx`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/web/src/lib/api.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/web/src/shared/auth.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/web/src/apps/driver`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/web/src/data/demo.js`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/apps/web/vercel.json`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/render.yaml`
- `/Users/rudrabishwokarma/Documents/SaaS_Platform/scripts`

Material symbols/functions/routes:

- `requireAuth`
- `requireRole`
- `requireTenantAccess`
- `featureGuard`
- `planGuard`
- `assertFeatureForRestaurant`
- `assertUsageLimitForRestaurant`
- `sanitizeUser`
- `signAccessToken`
- `signRefreshToken`
- `verifyRefreshToken`
- `createPosQuote`
- `submitPosOrder`
- `holdPosOrder`
- `createCashPayment`
- `createCardPaymentIntent`
- `enableKioskMode`
- `exitKioskMode`
- `posMenu`
- `posConfig`
- `handleStripePlatformWebhook`
- `handleStripeConnectWebhook`
- `createPlatformCheckout`
- `activatePaidRegistration`
- `createOrderPayment`
- `createOrderQuote`
- `processRefund`
- `sendPasswordResetEmail`
- `sendWelcomeEmail`
- `uploadRestaurantImage`
- `recordAudit`

## 17. Unknowns requiring external verification

The following cannot be proven from repository evidence:

- Real Stripe account configuration.
- Stripe product and price IDs.
- Stripe Connect platform approval.
- Stripe webhook endpoint delivery and retry behavior.
- Card-reader/terminal certification.
- PCI scope assessment and formal PCI compliance.
- Real Supabase production database state.
- Supabase RLS policy state.
- Supabase Storage bucket configuration and access policy.
- Production DNS, Vercel, Render, CORS, firewall, and rewrite settings.
- Real Resend/SendGrid deliverability.
- Real SMS delivery.
- Real push notification delivery.
- Physical printer compatibility.
- Physical cash drawer compatibility.
- Barcode scanner, customer display, handheld, and tablet behavior.
- Offline POS behavior after browser/device restart.
- Load behavior under peak Friday-night restaurant volume.
- Backup restoration.
- Disaster recovery.
- Formal SOC 2, GDPR, CCPA, or other compliance certification.
- Restaurant pilot history.
- Support staffing and escalation coverage.
- Training material effectiveness.
- Real user accessibility feedback.

Final audit note: this report is the only file created by the audit. No application source code, schema, dependency, environment, deployment, database, or product configuration was changed.

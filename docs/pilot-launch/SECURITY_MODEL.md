# Loohar Security Model (current)

Describes controls present in code at candidate `1d30522`. Anything listed under "Gaps" is
not yet guaranteed.

## Identity and sessions
- JWT access tokens (15 min) with refresh sessions (`AuthSession`, session version
  revocation) — `apps/api/src/utils/tokens.js`, `services/authSessionService.js`.
- POS session tokens bound to user, restaurant, staff, device, location
  (`signPosSessionToken`, `middleware/posSession.js`).
- Production refuses to start without `JWT_SECRET` / `REFRESH_TOKEN_SECRET`.

## Authorization
- Roles (`UserRole`): SUPER_ADMIN, TENANT_OWNER, RESTAURANT_ADMIN, RESTAURANT_OWNER,
  RESTAURANT_MANAGER, CASHIER, KITCHEN_STAFF, DRIVER, CUSTOMER — enforced with
  `requireAuth`/`requireRole` and POS permission checks (`assertPosPermission`).
- Plan entitlements enforced server-side (`middleware/entitlements.js`, `config/entitlements.js`).

## Tenant isolation
- Restaurant is the tenant; routes compare the authenticated `restaurantId` with the target
  record. Suites: `test:tenant-isolation`, `test:tax-tenant-isolation`,
  `test:receipt-tenant-isolation`, `test:billing-isolation`.
- Realtime sockets authenticate in `authorizeSocket` and join restaurant/location/driver rooms.
- Gap: no database-level policy (RLS); isolation depends on application code (audit P0-07).

## Public customer access
- Order status/receipt require either an authenticated reader with tenant access or a
  tracking token; only its SHA-256 hash is stored (L-01).
- Checkout tracking tokens are derived per checkout attempt with HMAC over the idempotency
  key hash (L-03); staff reissue rotates the stored hash.
- Global response sanitizer strips password hashes, token hashes, provider client secrets,
  checkout idempotency hashes (`utils/sanitize.js`).

## Payments
- Loohar SaaS billing (platform Stripe account) is separate from restaurant order payments
  (Stripe Connect direct charges on the restaurant account).
- Monetary truth: quotes computed server-side; modifiers validated against the menu (L-02);
  PaymentIntent amounts come from the persisted payment row (L-03).
- Idempotency: checkout creation requires `Idempotency-Key`; PaymentIntents use a Stripe
  idempotency key bound to the payment id; Connect account creation idempotent.
- Live-key guard: Stripe live keys refused outside production (`assertStripeConnectModeAllowed`).

## Webhooks
- All Stripe webhooks verify HMAC signatures, fail closed when the secret is missing (503),
  and reject timestamps outside ±300 s (L-04).
- Event ledger (`RestaurantPaymentEvent`): recorded before processing, marked processed after
  success; processed redeliveries acknowledged as duplicates.
- Settlement is a conditional, transactional claim so concurrent deliveries apply side effects
  once and settled payments are never downgraded.
- Gap: platform billing webhook still reprocesses redeliveries (L-09).

## Network
- CORS: explicit allowlist from env plus production origins; wildcard refused in production;
  requests from unlisted origins get `403 CORS_ORIGIN_DENIED`. Tenant subdomain CORS only
  when `ALLOW_TENANT_SUBDOMAIN_CORS=true`.
- Gap: allowlist always merges production origins, including on staging (L-12).
- Rate limiting via `express-rate-limit`; Render trust proxy configured.

## Secrets
- Secrets only in platform environment variables; `.env` files git-ignored; `security:scan`
  checks for hardcoded secret assignments and sensitive logging.
- Stripe error messages are redacted of secret-like values before surfacing.

## Rules for changes
1. New tenant-scoped query → prove the tenant check with a test.
2. New sensitive column → add to the response sanitizer.
3. New money path → server-computed amounts, idempotency, reviewer sign-off
   (`loohar-payment-reviewer`).
4. New webhook → shared verifier, event ledger, conditional state transitions.
5. Never weaken Vercel Deployment Protection, CORS wildcard rules, or live-key guards.

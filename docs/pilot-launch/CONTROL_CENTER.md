# Loohar Pilot Control Center

Last updated: 2026-09-17 06:31 UTC · Machine-readable twin: `.pilot/state.json`

Status vocabulary: NOT STARTED · IN PROGRESS · IMPLEMENTED (local) · PUSHED · STAGED ·
STAGING CERTIFIED · PRODUCTION · BLOCKED. No readiness percentages are used.

## 1. Identity (verified from live endpoints and git)

| Item | Value | Evidence |
| --- | --- | --- |
| Production API | `0526862` | `https://loohar-api.onrender.com/version` → production |
| Production web | `0526862` | `https://loohar.com/version.json` → production |
| origin/main | `0526862` | `git fetch origin` |
| Staging API | `4c48815` | `https://loohar-api-staging.onrender.com/version` → staging |
| Staging web | UNKNOWN | Vercel Deployment Protection; no authorised tooling |
| Pilot candidate | `1d30522` on `fix/launch-legacy-stripe-webhook-v01` (pushed) | worktree `SaaS_Platform-l04-legacy-webhook-v01` |
| Frozen | `feature/loohar-national-tax-provider-v01` @ `1e0562b` | do not modify/merge |

Candidate chain on top of production `0526862`:
`2d85007` L-01 → `b291ddd` L-01 → `cfec6a4` L-01 → `a3262dc` L-01 → `4c48815` L-02 →
`0e69db3` L-05 → `7e0833a` L-03 → `47fa9cc` L-04 → `1d30522` L-03/L-04 review fixes.

## 2. Current P0

| ID | Item | Status | Certification | Notes |
| --- | --- | --- | --- | --- |
| L-05 | Online checkout order creation fails Prisma validation | PUSHED (`0e69db3`) | not staged | **Every online card checkout fails before creating an order at 4c48815, and the same code is on production.** Reproduced on a disposable DB. Production impact not exercised (would mutate). |
| L-01 | Public order/payment access security | STAGED (API @ 4c48815) | BLOCKED | L-01C browser certification blocked: staging web SHA unverifiable, CORS denied; must be re-run on candidate 1d30522 because of L-05. |
| L-02 | Server-authoritative modifier validation | STAGED (API @ 4c48815) | pending L-01C | |
| L-03 | Checkout idempotency | PUSHED (`7e0833a`, `1d30522`) | not staged | Adds migration `20260916090000_checkout_idempotency` (additive). Web must deploy with or before API. |
| L-04 | Stripe webhook hardening | PUSHED (`47fa9cc`, `1d30522`) | not staged | Prerequisite: `STRIPE_WEBHOOK_SECRET` set wherever the legacy endpoint is registered. |
| L-11 | Monitoring, alerting, backup/restore proof, incident runbooks | BLOCKED | — | Needs owner access to Render/Supabase/alerting; no evidence in repo. |
| L-15 | Cash drawers can only be created by the development setup script | NOT STARTED | — | Verified: only `cashDrawer.upsert` is in `apps/api/prisma/setup-development-pos.js`; no API route or UI. A real restaurant cannot open a drawer to take cash. |

## 3. Current P1 (verified gaps, not yet started)

| ID | Item | Evidence |
| --- | --- | --- |
| L-06 | Driver delivery claim race | `apps/api/src/routes/driver.js` `/orders/:orderId/claim` checks `delivery.driverId` then upserts without a conditional write; two drivers can both succeed (last write wins). |
| L-07 | Refund idempotency | `refundOrderPayment` calls Stripe `/refunds` without an idempotency key and does not subtract prior refunds; double submit can issue two refunds. |
| L-08 | Delivery zone enforcement at quote | `quoteService.js` has no delivery-zone check; zones only feed readiness (`restaurant.js`). |
| L-09 | Platform billing webhook event ledger | `platformBillingService.js` upserts events with `processedAt` and reprocesses redeliveries (same pattern L-04 fixed for Connect). |
| L-10 | Prisma schema vs migration drift | Fresh DB from migrations differs from `schema.prisma` (e.g. `PaymentQuote`, `PaymentReconciliationRecord`, `RestaurantRefund_idempotencyKey_key`). Running `prisma migrate dev`/`db push` would drop them. |
| L-16 | Refunds have no restaurant UI | Verified: web app never calls the refund API (depends on L-07). |
| L-17 | POS cashier workflow gaps (reported, to verify) | PIN self-setup, cashier receipt printing, paying an order after send-to-kitchen. |
| L-18 | Driver app shows sample deliveries while offline (reported, to verify) | Manual drafting review. |

P2 / decisions: L-13 checkout replay may return a cancelled/expired PaymentIntent client secret;
L-14 client-supplied service fee/tips accepted (non-negative) — owner to confirm intent;
Starter plan has 0 employee seats (`config/entitlements.js`) — pricing decision.

P2: L-12 API CORS allowlist always merges production origins, so staging API accepts `https://loohar.com`.

Earlier audit (`docs/LOOHAR_IMPLEMENTATION_READINESS_AUDIT.md`, 2026-07-29) items since
addressed in code: P0-01 socket auth (`authorizeSocket`), P0-02 tokenless status (L-01),
P0-08 webhook signature (L-04). Still open from that audit and relevant to pilot scope:
P0-03 live payment certification, P0-06 safe smoke suite, P0-07 DB-level tenant policy,
P0-09 operations, P1-01 printers, P1-06 manager approvals, P1-11 CI.

## 4. Blockers requiring a human

| Blocker | Evidence | Human action |
| --- | --- | --- |
| Staging deploy of candidate | No Render CLI/API key on this machine; Vercel CLI login is account `ssunuwar`, preview lives in team `subashsunar-8870s-projects` | Deploy `fix/launch-legacy-stripe-webhook-v01` @ `1d30522` to staging API and staging web, **or** provide a staging-scoped Render API key and Vercel team access for automation |
| Staging web identity | Preview returns 302 to Vercel SSO | Open `<preview>/version.json` while signed in and record `commitSha` in state |
| Staging CORS | `GET /health` with preview Origin → `403 CORS_ORIGIN_DENIED` | On `loohar-api-staging` only, append the exact preview origin of the deployed branch to `CORS_ORIGINS` (not first entry), restart. The Vercel branch alias changes with the branch name. |
| Legacy webhook secret | L-04 fails closed without it | Confirm `STRIPE_WEBHOOK_SECRET` exists on staging/production or that `/api/payments/webhook` is not registered in Stripe |
| Operations proof (L-11) | No monitoring/backup evidence in repo | Provide access or confirm Supabase PITR/backup plan, alert routing, on-call contact |
| Starter plan employee seats | `USAGE_LIMIT.STAFF_MEMBERS` is 0 for Starter | Decide the pilot restaurant's plan / seat policy |
| `.claude/settings.json` refinement | Auto-mode classifier blocked edits to Claude settings | Owner may edit: replace deny `Read(./apps/api/.env.*)` with explicit files so `.env.example` stays readable |

## 5. Test status (candidate `1d30522`, 2026-09-17)

`npm test` PASS (66 suites) · lint PASS · web build PASS · security scan PASS ·
`npm audit` 0 high/critical (5 moderate) · `prisma validate` PASS · all 32 migrations apply
to fresh Postgres 16 · `test:checkout-idempotency-db` PASS (9) ·
`test:stripe-webhook-hardening-db` PASS (10). Additional suites passing: stripe-connect,
stripe-connect-accounts-v2, order-payment-modifier-authority, refunds, payment-capabilities,
subscription, stripe-billing, reconciliation, tips, financial-separation, pos-checkout,
modifier-quotes.

Security review (adversarial, 2026-09-17): no cross-customer data access or client monetary
authority found; 2 medium + 3 low findings fixed in `1d30522`; remaining low items tracked
as L-13, L-14 and release notes (deploy order, index build lock).

## 6. Staging status

Staging API runs `4c48815` (healthy, schema ok). The candidate is **not** staged. No staging
checkout has succeeded; L-01C created 0 orders/PaymentIntents/refunds.

## 7. Restaurant #1 readiness (Loohar Restaurant, `loohar-restaurant`)

NOT READY. Required: candidate staged and identity-verified; one controlled Stripe TEST
checkout certified end to end (quote → order → PaymentIntent → payment → webhook → status →
receipt → KDS); refund certification; operations proof (L-11); owner/staff onboarding using
the manuals.

## 8. Approvals

| Decision | Status |
| --- | --- |
| Production release | NOT REQUESTED |
| Merge to main | NOT REQUESTED |
| Staging deploy of `1d30522` | Autonomously authorised, blocked on access |

## 9. Next autonomous task

L-15 restaurant-managed cash drawer setup (P0 for cash POS pilot) in a worktree based on
`1d30522`, then L-06 driver claim race, L-07 refund idempotency (before L-16 refund UI),
L-09 platform billing event ledger. Re-check staging identity at the start of each cycle;
resume L-01C immediately when the candidate is staged and CORS allows the preview origin.
